"""Geometry resolution: does the declarative roster turn into the right cabin?"""

from __future__ import annotations

import pytest

from plane_boarding.aircraft import (
    AISLE_SEAT, MIDDLE, WINDOW, aircraft_ids, geometry_payload, get_aircraft,
)
from plane_boarding.config import ConfigError

from helpers import cfg_for

#: Declared totals from the cabin research. These are the numbers the roster has
#: to reproduce exactly -- a seat-count drift means a layout or a missingSeats
#: entry has been edited without redoing the arithmetic.
DECLARED_SEATS = {
    "e175": 76, "a320neo": 186, "b737_max8": 197,
    "a220_300": 130, "b777_300er": 354, "b787_9": 257,
}


@pytest.mark.parametrize("aid", sorted(DECLARED_SEATS))
def test_every_aircraft_loads_with_the_declared_seat_count(aid):
    ac = get_aircraft(aid)
    assert ac.seatCount == DECLARED_SEATS[aid]


def test_roster_ids_match_the_test_table():
    assert sorted(aircraft_ids()) == sorted(DECLARED_SEATS)


@pytest.mark.parametrize("aid", sorted(DECLARED_SEATS))
def test_seat_ids_are_unique_and_letters_never_use_I(aid):
    ac = get_aircraft(aid)
    ids = [s.id for s in ac.seats]
    assert len(set(ids)) == len(ids)
    assert all(s.letter != "I" for s in ac.seats), "the letter I is never used in a cabin"


@pytest.mark.parametrize("aid", sorted(DECLARED_SEATS))
def test_every_seat_maps_to_a_real_aisle_and_a_sane_depth(aid):
    ac = get_aircraft(aid)
    for s in ac.seats:
        assert 0 <= s.aisleIndex < ac.aisleCount
        assert 1 <= s.depth <= 3
        assert 0 <= s.blockId < ac.blockCount
        assert 0 <= s.rowSlot < len(ac.rowSlots)


def test_depths_2_2():
    """E175 first cabin is 1-2 (A | C,D); premium/main are 2-2 (A,B | C,D)."""
    ac = get_aircraft("e175")
    row2 = {s.letter: s for s in ac.seats if s.rowNumber == 2}
    assert {k: v.depth for k, v in row2.items()} == {"A": 1, "C": 1, "D": 2}
    row10 = {s.letter: s for s in ac.seats if s.rowNumber == 10}
    assert {k: v.depth for k, v in row10.items()} == {"A": 2, "B": 1, "C": 1, "D": 2}
    # In a 2-2 cabin the deepest seat is 2, so the worst shuffle is the
    # 4-movement "aisle blocked" case and never the 9-movement one.
    assert ac.maxDepth == 2


def test_depths_2_3_asymmetric():
    """The A220's off-centre aisle: port side maxes at depth 2, starboard at 3."""
    ac = get_aircraft("a220_300")
    row = {s.letter: s for s in ac.seats if s.rowNumber == 20}
    assert {k: v.depth for k, v in row.items()} == {"A": 2, "C": 1, "D": 1, "E": 2, "F": 3}
    port = [s for s in ac.seats if s.rowNumber == 20 and s.letter in "AC"]
    assert max(s.depth for s in port) == 2


def test_depths_3_3():
    ac = get_aircraft("a320neo")
    row = {s.letter: s for s in ac.seats if s.rowNumber == 5}
    assert {k: v.depth for k, v in row.items()} == {
        "A": 3, "B": 2, "C": 1, "D": 1, "E": 2, "F": 3}


def test_depths_3_4_3():
    """The centre block is served from BOTH aisles: D,E from aisle 0 and G,F
    from aisle 1, so nobody in a 3-4-3 is ever more than 3 deep."""
    ac = get_aircraft("b777_300er")
    row = {s.letter: s for s in ac.seats if s.rowNumber == 24}
    assert {k: v.depth for k, v in row.items()} == {
        "A": 3, "B": 2, "C": 1, "D": 1, "E": 2, "F": 2, "G": 1, "H": 1, "J": 2, "K": 3}
    assert {k: v.aisleIndex for k, v in row.items()} == {
        "A": 0, "B": 0, "C": 0, "D": 0, "E": 0, "F": 1, "G": 1, "H": 1, "J": 1, "K": 1}
    # D/E and F/G are on opposite sides of the centre block, so a D passenger
    # never blocks an F passenger.
    assert row["E"].blockId != row["F"].blockId


def test_depths_3_3_3():
    """787 centre block D,E,F: E is equidistant from both aisles, so the
    tie-to-lower-aisle rule makes it a depth-2 middle served by aisle 0."""
    ac = get_aircraft("b787_9")
    row = {s.letter: s for s in ac.seats if s.rowNumber == 43}
    assert {k: v.depth for k, v in row.items()} == {
        "A": 3, "B": 2, "C": 1, "D": 1, "E": 2, "F": 1, "J": 1, "K": 2, "L": 3}
    assert row["E"].aisleIndex == 0 and row["E"].kind == MIDDLE


def test_seat_kinds():
    ac = get_aircraft("a320neo")
    row = {s.letter: s.kind for s in ac.seats if s.rowNumber == 5}
    assert row == {"A": WINDOW, "B": MIDDLE, "C": AISLE_SEAT,
                   "D": AISLE_SEAT, "E": MIDDLE, "F": WINDOW}
    # A 1-2-1 business suite is a window seat that also has direct aisle access.
    b = get_aircraft("b787_9")
    r1 = {s.letter: (s.kind, s.depth) for s in b.seats if s.rowNumber == 1}
    assert r1["A"] == (WINDOW, 1) and r1["L"] == (WINDOW, 1)


def test_skipped_row_numbers_cost_no_cabin_length():
    """E175 row 5 does not exist; rows 4 and 6 must still be one pitch apart."""
    ac = get_aircraft("e175")
    x = {r.number: r.x for r in ac.rowSlots}
    pitch4 = next(r.pitch for r in ac.rowSlots if r.number == 4)
    assert 5 not in x
    assert x[6] - x[4] == pytest.approx(pitch4)
    assert 13 in x, "row 13 IS present on the E175"


def test_monuments_do_cost_cabin_length():
    """The 787's galley/lav complexes are real metres of aisle, unlike a skipped
    number. Row 30 must sit a full monument beyond row 22."""
    ac = get_aircraft("b787_9")
    x = {r.number: r.x for r in ac.rowSlots}
    pitch22 = next(r.pitch for r in ac.rowSlots if r.number == 22)
    assert x[30] - x[22] == pytest.approx(pitch22 + 2.5)
    plain = get_aircraft("a220_300")
    px = {r.number: r.x for r in plain.rowSlots}
    p3 = next(r.pitch for r in plain.rowSlots if r.number == 3)
    assert px[10] - px[3] == pytest.approx(p3), "A220 rows 4-9 are numbering only"


def test_row_positions_are_monotonic_and_pitch_correct():
    for aid in DECLARED_SEATS:
        ac = get_aircraft(aid)
        xs = [r.x for r in ac.rowSlots]
        assert xs == sorted(xs)
        assert xs[0] == 0.0


def test_doors_resolve_fore_and_aft():
    ac = get_aircraft("a320neo")
    d = {x.id: x for x in ac.doors}
    assert d["1L"].x < 0.0, "1L sits forward of row 1"
    assert d["2L"].x > ac.rowSlots[-1].x, "2L sits aft of the last row"
    assert d["1L"].boardable and d["2L"].boardable
    assert not d["OW1"].boardable


def test_missing_seats_are_actually_missing():
    ac = get_aircraft("b737_max8")
    ids = {s.id for s in ac.seats}
    for gone in ("1A", "1D", "1E", "1F", "27F", "28A", "28F"):
        assert gone not in ids
    assert {s.letter for s in ac.seats if s.rowNumber == 1} == {"B", "C"}
    assert 13 not in {r.number for r in ac.rowSlots}
    a220 = get_aircraft("a220_300")
    assert {s.letter for s in a220.seats if s.rowNumber == 17} == {"C", "D", "E"}


def test_bin_capacity_is_zero_where_a_run_has_no_seats():
    """737 row 1 loses D/E/F to the forward galley, so there is no bin there."""
    ac = get_aircraft("b737_max8")
    slot = ac.rowSlotByNumber[1]
    caps = ac.rowSlots[slot].binCaps
    assert caps[0] > 0 and caps[1] == 0


def test_e175_cannot_board_through_two_doors():
    ac = get_aircraft("e175")
    assert [d.id for d in ac.boardable_doors()] == ["1L"]
    with pytest.raises(ConfigError, match="not boarding doors"):
        ac.resolve_doors(["1L", "2L"])


def test_no_doors_enabled_is_a_clear_error():
    ac = get_aircraft("a320neo")
    with pytest.raises(ConfigError, match="no boarding doors enabled"):
        ac.resolve_doors([])


def test_unknown_door_is_a_clear_error():
    ac = get_aircraft("a320neo")
    with pytest.raises(ConfigError, match="no such door"):
        ac.resolve_doors(["9Z"])


def test_geometry_payload_is_json_serialisable_and_complete():
    import json
    for aid in DECLARED_SEATS:
        payload = geometry_payload(get_aircraft(aid))
        json.loads(json.dumps(payload))
        assert len(payload["seats"]) == DECLARED_SEATS[aid]
        assert payload["rows"] and payload["doors"]


def test_a_layout_that_repeats_a_seat_letter_is_rejected_at_load():
    """The per-letter geometry map is keyed by letter, and `_resolve` looks each
    letter up again per row. A layout that used "D" twice would silently give
    both D seats whichever position came last -- same depth, same block, same bin
    run -- and the only symptom would be a boarding time that is quietly wrong.
    Nothing in the shipped roster does this; the point is that nothing can.
    """
    from plane_boarding.aircraft import _analyse_layout
    _analyse_layout(["A", "B", "C", "|", "D", "E", "F"])   # the control
    with pytest.raises(ConfigError, match="repeats seat letter 'D'"):
        _analyse_layout(["A", "B", "D", "|", "D", "E", "F"])
    with pytest.raises(ConfigError, match="repeats seat letter 'A'"):
        _analyse_layout(["A", "|", "A"])


def test_a_seat_whose_bin_run_does_not_exist_is_an_error_not_a_full_bin():
    """`arrive()` used to read a missing bin run as `fill = 1.0`, i.e. as a bin
    that happens to be completely full, and charge the passenger the whole
    `binCongestionWeight` penalty for it. A bin run that is absent above its own
    row is not congestion, it is a seat map and a capacity table that disagree,
    and the two can only disagree because of a bug. It must say so.

    Constructed by hand because no shipped airframe can produce it -- which is
    exactly why the branch was never noticed.
    """
    from plane_boarding.engine import simulate as sim
    ac = get_aircraft("a320neo")
    seat = ac.seats[10]
    original = seat.binRun
    try:
        seat.binRun = 99
        with pytest.raises(ConfigError, match="declares binRun 99"):
            sim(cfg_for("a320neo", "random", seed=1, loadFactor=1.0,
                        bagWeights={"0": 0, "1": 1, "2": 0}), ac)
    finally:
        seat.binRun = original
