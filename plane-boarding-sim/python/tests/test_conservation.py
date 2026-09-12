"""Nothing may be created or destroyed: every passenger boards, exactly once,
into a seat that exists."""

from __future__ import annotations

import pytest

from plane_boarding.aircraft import get_aircraft
from plane_boarding.config import SEATED
from plane_boarding.engine import run, simulate
from plane_boarding.strategies import STRATEGIES

from helpers import cfg_for

AIRCRAFT = ["e175", "a320neo", "b737_max8", "a220_300", "b777_300er", "b787_9"]


@pytest.mark.parametrize("aid", AIRCRAFT)
def test_pax_count_is_round_of_load_factor_times_seats(aid):
    ac = get_aircraft(aid)
    for lf in (0.0, 0.31, 0.5, 0.855, 1.0):
        r = simulate(cfg_for(aid, "random", seed=3, loadFactor=lf))
        assert r.paxCount == round(lf * ac.seatCount)


@pytest.mark.parametrize("aid", AIRCRAFT)
def test_every_passenger_ends_seated_in_a_unique_existing_seat(aid):
    ac = get_aircraft(aid)
    valid = {s.id for s in ac.seats}
    r = simulate(cfg_for(aid, "random", seed=5))
    assert r.completed
    seats = [p.seat for p in r.perPassenger]
    assert len(set(seats)) == len(seats), "two passengers in one seat"
    assert set(seats) <= valid, "somebody sat in a seat that does not exist"
    assert all(p.sitTime >= p.enterTime for p in r.perPassenger)
    assert all(p.sitTime <= r.totalSeconds + 1e-9 for p in r.perPassenger)


@pytest.mark.parametrize("strategy", sorted(STRATEGIES))
def test_open_and_assigned_seating_both_conserve_passengers(strategy):
    ac = get_aircraft("a220_300")
    r = simulate(cfg_for("a220_300", strategy, seed=8, loadFactor=0.75))
    assert r.paxCount == round(0.75 * ac.seatCount)
    assert sorted(p.id for p in r.perPassenger) == list(range(r.paxCount))
    assert len({p.seat for p in r.perPassenger}) == r.paxCount


def test_final_replay_frame_has_everybody_seated():
    _, replay = run(cfg_for("a320neo", "wilma", seed=2), record_replay=True)
    assert set(replay["frames"]["state"][-1]) == {SEATED}


def test_interference_counts_add_up_to_the_passenger_count():
    for aid in AIRCRAFT:
        r = simulate(cfg_for(aid, "random", seed=6))
        assert sum(r.interference.values()) == r.paxCount


def test_time_breakdown_is_consistent_with_per_passenger_records():
    r = simulate(cfg_for("b737_max8", "random", seed=6))
    for key, attr in (("walk", "walkTime"), ("stow", "stowTime"),
                      ("shuffle", "shuffleTime"), ("blocked", "blockedTime")):
        total = sum(getattr(p, attr) for p in r.perPassenger)
        assert r.timeBreakdown[key] == pytest.approx(total, abs=1e-3)


def test_gate_checked_bags_never_exceed_bags_carried():
    r = simulate(cfg_for("e175", "random", seed=11))
    for p in r.perPassenger:
        assert 0 <= p.gateChecked <= p.bags
    assert r.gateChecks == sum(p.gateChecked for p in r.perPassenger)
