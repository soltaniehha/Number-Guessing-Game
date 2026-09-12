"""Nothing may be created or destroyed: every passenger boards, exactly once,
into a seat that exists."""

from __future__ import annotations

import pytest

from plane_boarding.aircraft import get_aircraft
from plane_boarding.config import SEATED
from plane_boarding.engine import run, simulate
from plane_boarding.metrics import percentile
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


# ---------------------------------------------------------------------------
# The reported wait statistics (ENGINE_SPEC 7)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("aid", AIRCRAFT)
def test_time_to_seat_statistics_measure_what_they_are_named(aid):
    """These were all computed off `sitTime`, so every one of them silently
    reported "seconds since boarding started" -- which made `maxTimeToSeat`
    identically `totalSeconds` on any completed run, and made the passenger wait
    chart show the wrong quantity entirely.

    There are two honest questions here and the field names now say which is
    which: `*AisleSeconds` is the time from stepping through the door to sitting
    down, and `*BoardingWaitSeconds` adds the jetbridge queue in front of it.
    """
    r = simulate(cfg_for(aid, "random", seed=3))
    aisle = sorted(p.timeInAisle for p in r.perPassenger)
    sits = sorted(p.sitTime for p in r.perPassenger)

    # The aisle family is exactly the percentiles of `perPassenger.timeInAisle`,
    # which already held the right quantity.
    assert r.maxAisleSeconds == pytest.approx(aisle[-1], abs=1e-6)
    assert r.p50AisleSeconds == pytest.approx(percentile(aisle, 0.50), abs=1e-6)
    assert r.p90AisleSeconds == pytest.approx(percentile(aisle, 0.90), abs=1e-6)

    # The boarding-wait family is the percentiles of `sitTime`.
    assert r.p50BoardingWaitSeconds == pytest.approx(percentile(sits, 0.50), abs=1e-6)
    assert r.p90BoardingWaitSeconds == pytest.approx(percentile(sits, 0.90), abs=1e-6)

    # The deprecated aliases now carry the aisle quantity.
    assert r.p50TimeToSeat == r.p50AisleSeconds
    assert r.p90TimeToSeat == r.p90AisleSeconds
    assert r.maxTimeToSeat == r.maxAisleSeconds


def test_the_worst_aisle_wait_is_a_real_statistic_not_the_run_length():
    """Why `maxTimeToSeat` was worth fixing rather than deleting.

    As a maximum over `sitTime` it was definitionally `totalSeconds` for any
    completed run -- it carried no information at all. As a maximum over
    time-in-aisle it is the thing the metric was always supposed to be: the
    worst individual experience, and a small fraction of the run length.

    There is deliberately no `maxBoardingWaitSeconds`: the last passenger to sit
    down sits at `totalSeconds` by construction, so that maximum really is
    redundant and is not reported.
    """
    r = simulate(cfg_for("a320neo", "random", seed=1, doors=["1L"]))
    assert r.completed
    assert r.maxAisleSeconds < r.totalSeconds * 0.6, (
        "the worst time in the aisle should be a fraction of the whole boarding; "
        "if it equals totalSeconds the old sitTime bug is back")
    assert max(p.sitTime for p in r.perPassenger) == pytest.approx(
        r.totalSeconds, abs=1e-6), (
        "and this is why there is no maxBoardingWaitSeconds: it would be the "
        "run length every time")
    assert not hasattr(r, "maxBoardingWaitSeconds")


def test_the_final_aisle_sample_counts_the_aisle_not_the_jetbridge():
    """On a run that hits MAX_SIM_SECONDS the closing sample used to report
    `paxCount - seated`, which counts everyone still queued on the jetbridge as
    though they were standing in the aisle. It is the real lane occupancy now,
    so the aisle-occupancy chart no longer ends on a spike that never happened.
    """
    # A completed run closes at zero either way.
    done = simulate(cfg_for("a320neo", "random", seed=1, doors=["1L"]))
    assert done.completed
    assert done.aisleOccupancy[-1][1] == 0

    # A run that cannot finish: one door, a huge cabin, glacial arrivals.
    stuck = simulate(cfg_for("b777_300er", "random", seed=1, loadFactor=1.0,
                             doors=["1L"], doorArrivalMean=60.0))
    assert not stuck.completed
    still_queued = stuck.paxCount - stuck.seatedCurve[-1][1]
    final_in_aisle = stuck.aisleOccupancy[-1][1]
    assert final_in_aisle < still_queued, (
        f"{final_in_aisle} in the aisle out of {still_queued} unseated -- the "
        f"rest are on the jetbridge and must not be counted as aisle occupancy")
    # And it has to agree with the last regular sample rather than jumping.
    assert abs(final_in_aisle - stuck.aisleOccupancy[-2][1]) <= 5
