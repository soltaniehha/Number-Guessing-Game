"""Calibration gates against the boarding literature.

These are the tests that stop the model drifting away from reality. They are
slower than the rest of the suite on purpose: a mean over enough replications is
the only thing that can be compared to a field measurement.

Provenance for every number here is docs/RESEARCH_PARAMETERS.md.
"""

from __future__ import annotations

from plane_boarding.batch import compare_strategies, run_batch

from helpers import cfg_for

#: Schultz's field regression over 282 measured single-aisle boardings:
#:     T_board ~= 4.5 s * N_pax + 138 s
SCHULTZ_SLOPE, SCHULTZ_OFFSET = 4.5, 138.0

#: 180 passengers => 948 s. The accepted band is +/-15%, NOT Schultz's own <5%
#: model-vs-field deviation, for two reasons documented in RESEARCH_PARAMETERS
#: 11.1: (a) the regression is a linear fit across a 29-190 pax range rather
#: than a point measurement, and (b) we sample per-passenger walk speed, which
#: Schultz does not, and heterogeneous-speed queues run a little slower at the
#: same mean speed. Do not widen this band without reading that section.
TARGET_180 = SCHULTZ_SLOPE * 180 + SCHULTZ_OFFSET
BAND_LO, BAND_HI = TARGET_180 * 0.85, TARGET_180 * 1.15


def a320_at_180(**overrides):
    """The A320neo has 186 seats, so 180 passengers is a 96.8% load factor."""
    return cfg_for("a320neo", "random", seed=1, loadFactor=180 / 186, **overrides)


def test_absolute_boarding_time_matches_the_field_regression():
    """Random boarding, 180 passengers, the aircraft's AS-OPERATED door
    configuration (easyJet boards 1L + 2L as standard). That is the
    configuration the field dataset averages over -- see the companion test
    below for the single-door figure, which is deliberately not the gate."""
    b = run_batch(a320_at_180(), runs=30)
    assert b.paxCount == 180
    assert BAND_LO <= b.mean <= BAND_HI, (
        f"mean {b.mean:.0f}s is outside {BAND_LO:.0f}-{BAND_HI:.0f}s "
        f"(target {TARGET_180:.0f}s from T = 4.5N + 138)")


def test_single_door_boarding_is_slower_and_stays_in_its_known_range():
    """DOCUMENTED DEVIATION, pinned so it cannot drift silently.

    Forcing the same 180 passengers through 1L alone lands ~50% above the
    Schultz regression. Our aisle is a strict single-file exclusion process in
    which a stowing passenger blocks everyone behind for the whole stow, and
    that yields roughly 3 simultaneous stowers where the regression implies
    about 7. The relative ordering of strategies is unaffected (see below), so
    this is a level offset in the single-door regime, not a shape error.
    """
    b = run_batch(a320_at_180(doors=["1L"]), runs=25)
    assert 1250 <= b.mean <= 1600, f"single-door mean drifted to {b.mean:.0f}s"


def test_schultz_reference_configuration_is_stable():
    """With walkSpeedSd = 0 the model reduces exactly to Schultz's deterministic
    0.8 m/s configuration. Kept as a regression canary: if this moves,
    something structural changed, not just a distribution parameter."""
    b = run_batch(a320_at_180(walkSpeedSd=0.0), runs=25)
    assert BAND_LO <= b.mean <= BAND_HI
    varied = run_batch(a320_at_180(), runs=25)
    assert b.totalSeconds.sd <= varied.totalSeconds.sd * 1.35, (
        "removing speed variance must not widen the boarding-time distribution")


def test_strategy_ordering_matches_the_literature():
    """front-to-back > back-to-front > random > WilMA > reverse pyramid > Steffen.

    An ordering assertion, not a magnitude one: the experiment (Steffen &
    Hotchkiss) and the simulation consensus disagree about magnitudes by a wide
    margin, but every source agrees on the order. RESEARCH_PARAMETERS 11.2.

    Note this is asserted on the SINGLE-DOOR configuration. Zone schemes behave
    quite differently through two doors -- see the test below -- and the
    literature ordering is a single-door finding.
    """
    cfg = a320_at_180(doors=["1L"])
    keys = ["front_to_back", "back_to_front", "random", "wilma",
            "reverse_pyramid", "wilma_zoned", "steffen_perfect"]
    res = {b.strategy: b.mean for b in compare_strategies(cfg, keys, runs=30)}
    assert res["front_to_back"] > res["back_to_front"] > res["random"]
    assert res["random"] > res["wilma"] > res["reverse_pyramid"] > res["steffen_perfect"]
    assert res["wilma_zoned"] < res["wilma"], (
        "adding aisle-spreading to outside-in should help")


def test_zone_boarding_wastes_a_second_door():
    """A finding worth pinning, because it is counter-intuitive and it falls out
    of the model rather than being put in: rear-first zone schemes are WORSE
    than random through two doors, even though they are better through one.
    Calling the rear zone first sends every one of those passengers to the aft
    door while the forward door stands idle, so a scheme designed to spread the
    aisle ends up serialising the doors instead."""
    one = {b.strategy: b.mean for b in compare_strategies(
        a320_at_180(doors=["1L"]), ["random", "back_to_front"], runs=20)}
    two = {b.strategy: b.mean for b in compare_strategies(
        a320_at_180(doors=["1L", "2L"]), ["random", "back_to_front"], runs=20)}
    assert one["back_to_front"] / one["random"] > 1.0
    assert two["back_to_front"] / two["random"] > one["back_to_front"] / one["random"]


def test_relative_speedups_are_in_the_published_ballpark():
    cfg = a320_at_180(doors=["1L"])
    keys = ["front_to_back", "random", "wilma", "steffen_perfect"]
    res = {b.strategy: b.mean for b in compare_strategies(cfg, keys, runs=18)}
    base = res["random"]
    assert 1.20 <= res["front_to_back"] / base <= 1.60      # published 1.30-1.50
    assert 0.85 <= res["wilma"] / base <= 0.95              # published 0.85-0.92
    # Steffen's theoretical 2x is eroded to ~20-30% by party cohesion, 15%
    # non-compliance and the door arrival process. If this drops below 0.65,
    # check those frictions are actually switched on before touching anything.
    assert 0.65 <= res["steffen_perfect"] / base <= 0.85


def test_boarding_time_is_linear_in_load_factor():
    """Schultz finds the relationship is linear for both one- and two-door
    aircraft. A bend would mean something in the model saturates."""
    for doors in (["1L"], ["1L", "2L"]):
        xs, ys = [], []
        for lf in (0.45, 0.6, 0.7, 0.85, 1.0):
            b = run_batch(cfg_for("a320neo", "random", seed=1, loadFactor=lf,
                                  doors=doors), runs=16)
            xs.append(b.paxCount)
            ys.append(b.mean)
        n = len(xs)
        mx, my = sum(xs) / n, sum(ys) / n
        sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        sxx = sum((x - mx) ** 2 for x in xs)
        syy = sum((y - my) ** 2 for y in ys)
        r2 = (sxy * sxy) / (sxx * syy)
        assert r2 > 0.97, f"doors={doors}: load-factor response is not linear (R2={r2:.3f})"
        assert ys == sorted(ys), "more passengers must take longer"


def test_e175_gate_check_rate_matches_the_reported_field_figure():
    """United report ~6.7 gate-checked bags per E175 departure, about 9% of the
    cabin. With only ~36 bin slots for 76 seats this is the end-to-end check on
    the whole bin model -- capacity, outward search and the gate-check fallback.
    """
    b = run_batch(cfg_for("e175", "random", seed=1), runs=25)
    rate = b.gateChecks.mean / b.paxCount
    assert 0.05 <= rate <= 0.15, f"gate-check rate {100 * rate:.1f}% of the cabin"


def test_roomier_bins_gate_check_less():
    tight = run_batch(cfg_for("e175", "random", seed=1), runs=10)
    retrofit = run_batch(cfg_for("e175", "random", seed=1, binBagsPerRowSide=2), runs=10)
    assert retrofit.gateChecks.mean < tight.gateChecks.mean


def test_a_full_narrowbody_boards_in_a_plausible_wall_clock_time():
    for aid in ("a320neo", "b737_max8", "a220_300"):
        b = run_batch(cfg_for(aid, "random", seed=2, loadFactor=1.0), runs=6)
        minutes = b.mean / 60.0
        assert 12.0 <= minutes <= 45.0, f"{aid} boards in {minutes:.1f} min"


def test_a_second_door_buys_roughly_a_third_off():
    one = run_batch(cfg_for("a320neo", "random", seed=1, doors=["1L"]), runs=12)
    two = run_batch(cfg_for("a320neo", "random", seed=1, doors=["1L", "2L"]), runs=12)
    saving = 1.0 - two.mean / one.mean
    assert 0.20 <= saving <= 0.50, f"second door saved {100 * saving:.0f}%"


def test_twin_aisle_reverses_the_narrowbody_wisdom():
    """Two published findings that our model has to reproduce, both about what
    happens when you add a second aisle:

    * Schmidt et al. compared six methods on a B777 and found the **reverse
      pyramid** best there, not Steffen.
    * Ryd, Khandelwal, So & Steffen (2024) find the Steffen advantage
      **collapses** as aisles are added -- congestion, not sequencing, is what
      the clever orders were fixing, and a second aisle fixes it for free.
    """
    cfg = cfg_for("b777_300er", "random", seed=1)
    keys = ["random", "reverse_pyramid", "steffen_perfect", "front_to_back"]
    res = {b.strategy: b.mean for b in compare_strategies(cfg, keys, runs=14)}
    base = res["random"]
    assert res["reverse_pyramid"] < base, "reverse pyramid should win on a twin aisle"
    assert res["steffen_perfect"] / base > 0.90, (
        "Steffen's narrowbody advantage must collapse on a twin aisle")
    assert res["front_to_back"] > base, "front-to-back is bad everywhere"
