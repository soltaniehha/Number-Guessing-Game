"""The cross-language digest contract (ENGINE_SPEC 9).

These tests guard the *shape* and the *stability* of what the parity harness
compares. They cannot check that JavaScript agrees -- that is
`parity/compare.py`'s job -- but they catch the half of the failure mode that
lives on this side: a fixture that stops running, a digest field that changes
type, or a hash that starts depending on something it should not.
"""

from __future__ import annotations

import importlib.util
import json
import os

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
PARITY = os.path.normpath(os.path.join(HERE, "..", "..", "parity"))


def _load_emitter():
    spec = importlib.util.spec_from_file_location(
        "emit_py", os.path.join(PARITY, "emit_py.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def emit():
    return _load_emitter()


@pytest.fixture(scope="module")
def fixtures():
    with open(os.path.join(PARITY, "fixtures.json"), encoding="utf-8") as fh:
        return json.load(fh)["fixtures"]


def test_fixture_set_covers_every_aircraft_and_the_awkward_corners(fixtures):
    from plane_boarding.aircraft import aircraft_ids
    configs = [f["config"] for f in fixtures]
    assert len(fixtures) >= 12
    assert {f["name"] for f in fixtures} == {f["name"] for f in fixtures}
    covered = {c["aircraftId"] for c in configs}
    assert covered == set(aircraft_ids()), f"aircraft not covered: {set(aircraft_ids()) - covered}"
    strategies = {c["strategy"] for c in configs}
    assert len(strategies) >= 8
    assert any(c.get("doorAssignment") == "split_by_aisle" for c in configs)
    assert any(c.get("doorAssignment") == "single" for c in configs)
    assert any(c.get("doors") == ["1L"] for c in configs), "a one-door fixture"
    assert any(c["strategy"] == "open_seating" for c in configs)
    assert any(c["loadFactor"] == 0.0 for c in configs)
    assert any(c["loadFactor"] == 1.0 for c in configs)
    assert any(c.get("walkSpeedSd") == 0 for c in configs), "the schultz_reference fixture"
    assert any(c["aircraftId"] in ("b777_300er", "b787_9") for c in configs), "twin aisle"


def test_digest_has_the_contracted_fields_and_types(emit, fixtures):
    d = emit.digest_for(fixtures[0])
    assert set(d) == {
        "config_hash", "geometry_hash", "totalSeconds", "paxCount", "seatCount",
        "doors", "timeBreakdown", "interference", "gateChecks", "binSearches",
        "aisleBlockEvents", "seatedCurve", "first20SitTimes"}
    assert isinstance(d["config_hash"], str) and len(d["config_hash"]) == 8
    assert isinstance(d["geometry_hash"], str) and len(d["geometry_hash"]) == 8
    assert set(d["timeBreakdown"]) == {"walk", "stow", "shuffle", "blocked"}
    assert set(d["interference"]) == {"none", "one", "two", "sameParty"}
    assert all(isinstance(v, int) for v in d["interference"].values())
    assert len(d["first20SitTimes"]) == min(20, d["paxCount"])


def test_every_float_is_rounded_to_nine_places(emit, fixtures):
    for f in fixtures:
        d = emit.digest_for(f)
        floats = list(d["timeBreakdown"].values()) + d["first20SitTimes"] + [d["totalSeconds"]]
        floats += [t for t, _ in d["seatedCurve"]]
        for v in floats:
            assert v == round(v, 9)
            assert str(v) != "-0.0"


def test_seated_curve_is_a_ten_second_grid_ending_full(emit, fixtures):
    f = next(x for x in fixtures if x["config"]["loadFactor"] > 0)
    d = emit.digest_for(f)
    ts = [t for t, _ in d["seatedCurve"]]
    assert ts[0] == 0.0
    assert all(round(b - a, 9) == 10.0 for a, b in zip(ts, ts[1:]))
    counts = [c for _, c in d["seatedCurve"]]
    assert counts == sorted(counts)
    assert counts[-1] == d["paxCount"]
    assert counts[0] == 0


def test_the_digest_is_deterministic(emit, fixtures):
    for f in fixtures[:4]:
        assert emit.digest_for(f) == emit.digest_for(f)


def test_config_hash_depends_only_on_the_config_values(emit):
    a = {"name": "x", "config": {"aircraftId": "e175", "strategy": "random",
                                 "seed": 1, "loadFactor": 0.5}}
    b = {"name": "renamed", "config": {"loadFactor": 0.5, "seed": 1,
                                       "strategy": "random", "aircraftId": "e175"}}
    c = {"name": "x", "config": {"aircraftId": "e175", "strategy": "random",
                                 "seed": 2, "loadFactor": 0.5}}
    assert emit.digest_for(a)["config_hash"] == emit.digest_for(b)["config_hash"]
    assert emit.digest_for(a)["config_hash"] != emit.digest_for(c)["config_hash"]


def test_fnv1a_matches_known_vectors(emit):
    # The reference FNV-1a/32 test vectors, so a JS mirror can be checked
    # against the same three values.
    assert emit.fnv1a32("") == "811c9dc5"
    assert emit.fnv1a32("a") == "e40c292c"
    assert emit.fnv1a32("foobar") == "bf9cf968"


def test_the_whole_fixture_set_emits_valid_json(emit):
    out = {f["name"]: emit.digest_for(f)
           for f in json.load(open(os.path.join(PARITY, "fixtures.json"),
                                   encoding="utf-8"))["fixtures"]}
    text = json.dumps(out, sort_keys=True)
    assert json.loads(text) == out
    assert len(out) >= 12


def test_empty_cabin_fixture_degrades_gracefully(emit, fixtures):
    f = next(x for x in fixtures if x["config"]["loadFactor"] == 0.0)
    d = emit.digest_for(f)
    assert d["paxCount"] == 0
    assert d["totalSeconds"] == 0.0
    assert d["first20SitTimes"] == []
    assert sum(d["interference"].values()) == 0


def test_geometry_hash_covers_the_resolved_geometry(emit, fixtures):
    """The digest used to stop at the cabin door: nothing in it depended on
    `geometry_payload`, so a rounding disagreement there could ship undetected.

    It is a HASH rather than a list of numbers on purpose. `parity/compare.py`
    compares numerically with a 1e-6 tolerance, and the disagreement being
    looked for -- `round(x, 6)` against a hand-rolled `Math.round(v*1e6)/1e6` at
    a tie -- is exactly 1e-6 wide, so only an exact string comparison can see it.
    """
    from plane_boarding.aircraft import aircraft_ids, get_aircraft
    by_aircraft = {}
    for f in fixtures:
        d = emit.digest_for(f)
        aid = f["config"]["aircraftId"]
        # Same aircraft, same hash, whatever the scenario around it.
        assert by_aircraft.setdefault(aid, d["geometry_hash"]) == d["geometry_hash"]
    assert set(by_aircraft) == set(aircraft_ids()), "every airframe must be hashed"
    # Different aircraft, different hash -- otherwise it is not covering anything.
    assert len(set(by_aircraft.values())) == len(by_aircraft)

    # And it must actually be sensitive to a 6-dp change in a coordinate, which
    # is the failure mode it exists for.
    ac = get_aircraft("a320neo")
    before = emit.geometry_fingerprint(ac)
    seat = ac.seats[0]
    original = seat.x
    try:
        object.__setattr__(seat, "x", original + 1e-6)
        assert emit.geometry_fingerprint(ac) != before
    finally:
        object.__setattr__(seat, "x", original)
    assert emit.geometry_fingerprint(ac) == before


def test_geometry_fingerprint_formats_floats_language_neutrally(emit):
    """`%.6f` on both sides, with -0.0 normalised: Python prints an integral
    float as `1.0` and JavaScript prints it as `1`, so the fingerprint must not
    go anywhere near either language's own float repr."""
    assert emit.f6(0.0) == "0.000000"
    assert emit.f6(-0.0) == "0.000000"
    assert emit.f6(1.0) == "1.000000"
    assert emit.f6(12.3456785) == "12.345678" or emit.f6(12.3456785) == "12.345679"
    assert emit.f6(round(0.0000005, 6)) == "0.000000"
