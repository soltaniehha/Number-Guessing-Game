"""Degenerate scenarios. Each of these has broken a boarding model at some point."""

from __future__ import annotations

import pytest

from plane_boarding.aircraft import get_aircraft
from plane_boarding.config import ConfigError, build_config
from plane_boarding.engine import simulate

from helpers import cfg_for


def test_empty_aircraft_boards_instantly():
    r = simulate(cfg_for("a320neo", "random", seed=1, loadFactor=0.0))
    assert r.paxCount == 0
    assert r.totalSeconds == 0.0
    assert r.perPassenger == []
    assert r.throughputPaxPerMin == 0.0
    assert r.completed


def test_completely_full_aircraft_still_completes():
    ac = get_aircraft("b737_max8")
    r = simulate(cfg_for("b737_max8", "random", seed=1, loadFactor=1.0))
    assert r.paxCount == ac.seatCount == 197
    assert r.completed


def test_single_passenger_walks_straight_on():
    ac = get_aircraft("a320neo")
    r = simulate(cfg_for("a320neo", "random", seed=1, loadFactor=1.0 / ac.seatCount))
    assert r.paxCount == 1
    p = r.perPassenger[0]
    assert p.blockedTime == 0.0
    assert p.blockers == 0
    assert r.interference["none"] == 1
    # Nothing to queue behind, so the whole run is one walk plus one service.
    assert r.totalSeconds == pytest.approx(p.sitTime, abs=1e-6)


def test_all_doors_disabled_errors_clearly():
    with pytest.raises(ConfigError, match="no boarding doors enabled"):
        simulate(cfg_for("a320neo", "random", seed=1, doors=[]))


def test_a_service_door_cannot_be_used_to_board():
    with pytest.raises(ConfigError, match="not boarding doors"):
        simulate(cfg_for("a320neo", "random", seed=1, doors=["1R"]))


def test_everyone_carries_two_bags():
    r = simulate(cfg_for("a320neo", "random", seed=1,
                         bagWeights={"0": 0.0, "1": 0.0, "2": 1.0}))
    assert all(p.bags == 2 for p in r.perPassenger)
    assert r.completed
    baseline = simulate(cfg_for("a320neo", "random", seed=1,
                                bagWeights={"0": 1.0, "1": 0.0, "2": 0.0}))
    assert r.totalSeconds > baseline.totalSeconds * 1.5


def test_nobody_carries_a_bag():
    r = simulate(cfg_for("a320neo", "random", seed=1,
                         bagWeights={"0": 1.0, "1": 0.0, "2": 0.0}))
    assert all(p.bags == 0 for p in r.perPassenger)
    assert r.timeBreakdown["stow"] == 0.0
    # Everyone still pays one elementary movement to sit down.
    assert r.timeBreakdown["shuffle"] > 0.0
    assert r.completed


def test_bin_capacity_override_forces_mass_gate_checking():
    starved = simulate(cfg_for("a320neo", "random", seed=1, binBagsPerRowSide=1,
                               bagWeights={"0": 0.0, "1": 0.0, "2": 1.0}))
    roomy = simulate(cfg_for("a320neo", "random", seed=1, binBagsPerRowSide=8,
                             bagWeights={"0": 0.0, "1": 0.0, "2": 1.0}))
    assert starved.gateChecks > roomy.gateChecks
    assert roomy.gateChecks == 0


def test_invalid_load_factor_is_rejected():
    with pytest.raises(ConfigError, match="loadFactor"):
        cfg_for("a320neo", "random", seed=1, loadFactor=1.4)


def test_unknown_config_key_is_rejected():
    with pytest.raises(ConfigError, match="unknown config keys"):
        build_config(None, {"aircraftId": "a320neo", "strategy": "random",
                            "seed": 1, "stowBaseMean": 12.5})


def test_unknown_aircraft_is_rejected():
    from plane_boarding.aircraft import get_aircraft as g
    with pytest.raises(ConfigError, match="unknown aircraft"):
        g("concorde")


def test_invalid_door_assignment_is_rejected():
    with pytest.raises(ConfigError, match="doorAssignment"):
        cfg_for("a320neo", "random", seed=1, doorAssignment="teleporter")


@pytest.mark.parametrize("policy", ["aisle_first", "window_first",
                                    "front_first", "avoid_neighbours"])
def test_every_open_seating_policy_fills_the_cabin(policy):
    r = simulate(cfg_for("e175", "open_seating", seed=4, openSeatingPolicy=policy))
    assert r.completed
    assert len({p.seat for p in r.perPassenger}) == r.paxCount


def test_open_seating_at_100_percent_load_leaves_nobody_standing():
    r = simulate(cfg_for("e175", "open_seating", seed=4, loadFactor=1.0))
    ac = get_aircraft("e175")
    assert {p.seat for p in r.perPassenger} == {s.id for s in ac.seats}


@pytest.mark.parametrize("assignment", ["single", "split_by_row", "split_by_aisle"])
def test_every_door_assignment_policy_works_on_a_twin_aisle(assignment):
    r = simulate(cfg_for("b777_300er", "random", seed=2, doorAssignment=assignment,
                         doors=["1L", "2L"], loadFactor=0.7))
    assert r.completed
    used = {p.doorId for p in r.perPassenger}
    assert used <= {"1L", "2L"}
    if assignment == "single":
        assert used == {"1L"}
    else:
        assert used == {"1L", "2L"}


def test_two_doors_beat_one_door():
    one = simulate(cfg_for("b737_max8", "random", seed=9, doors=["1L"]))
    two = simulate(cfg_for("b737_max8", "random", seed=9, doors=["1L", "2L"]))
    assert two.totalSeconds < one.totalSeconds * 0.85


@pytest.mark.parametrize("aid", ["e175", "a320neo", "b737_max8", "a220_300",
                                 "b777_300er", "b787_9"])
def test_every_strategy_completes_on_every_aircraft_at_its_default_config(aid):
    """The broad guard. Two-door open seating used to deadlock here: passengers
    from the forward and aft doors chose seats on each other's side of the
    cabin, walked head-on down a single-file aisle and neither could yield.
    Nothing else in the suite exercised that combination."""
    from plane_boarding.strategies import STRATEGIES
    for strategy in STRATEGIES:
        r = simulate(cfg_for(aid, strategy, seed=2))
        assert r.completed, f"{aid}/{strategy} hit MAX_SIM_SECONDS"
        assert r.totalSeconds < 3600, f"{aid}/{strategy} took {r.totalSeconds:.0f}s"


def test_two_streams_never_walk_into_each_other():
    """Structural invariant behind the deadlock fix: within one aisle lane, all
    passengers fed by a given door must travel the same way, and no two doors
    may send opposing traffic through the same stretch of aisle."""
    from plane_boarding.aircraft import get_aircraft as g
    from plane_boarding.engine import run as engine_run
    for strategy in ("random", "open_seating", "back_to_front"):
        cfg = cfg_for("b737_max8", strategy, seed=3)
        ac = g("b737_max8")
        _, rep = engine_run(cfg, ac, record_replay=True, frame_interval=cfg.dt)
        doors = {d.id: d.x for d in ac.doors}
        spans = {}
        for p in rep["passengers"]:
            dx, sx = doors[p["doorId"]], p["seatX"]
            lo, hi = min(dx, sx), max(dx, sx)
            key = (p["lane"], p["doorId"])
            prev = spans.get(key)
            spans[key] = (min(prev[0], lo), max(prev[1], hi)) if prev else (lo, hi)
        by_lane = {}
        for (lane, door), span in spans.items():
            by_lane.setdefault(lane, []).append((doors[door], span))
        for lane, entries in by_lane.items():
            for i in range(len(entries)):
                for j in range(i + 1, len(entries)):
                    (_, a), (_, b) = entries[i], entries[j]
                    overlap = min(a[1], b[1]) - max(a[0], b[0])
                    assert overlap <= 1e-9, (
                        f"lane {lane}: two doors' traffic overlaps by {overlap:.2f} m")


@pytest.mark.parametrize("aid", ["e175", "a320neo", "b737_max8", "a220_300",
                                 "b777_300er", "b787_9"])
def test_no_strategy_door_combination_hits_the_time_limit(aid):
    """The deadlock sweep. Partial aisle blocking changed the interaction rules
    exactly where two deadlocks already lived (two-door open seating; a gate
    release landing inside a squeeze zone), so every strategy is run against
    every boardable door configuration on every aircraft."""
    from itertools import combinations
    from plane_boarding.aircraft import get_aircraft as g
    from plane_boarding.strategies import STRATEGIES
    ac = g(aid)
    boardable = [d.id for d in ac.boardable_doors()]
    combos = [list(c) for r in range(1, len(boardable) + 1)
              for c in combinations(boardable, r)]
    for strategy in STRATEGIES:
        for doors in combos:
            r = simulate(cfg_for(aid, strategy, seed=2, doors=doors))
            assert r.completed, f"{aid}/{strategy}/{doors} hit MAX_SIM_SECONDS"
            assert r.totalSeconds < 3600, (
                f"{aid}/{strategy}/{doors} took {r.totalSeconds:.0f}s")


#: The second axis of the deadlock sweep. `dt` and `stowPassSpeedFactor` are
#: both plain sliders in the shipped UI (max 0.5 and 1.0), and their product is
#: what governs how far a squeezing passenger travels in one step -- which is
#: exactly the quantity the squeeze-past wedge was a function of. Every pair
#: below was verified to reproduce that wedge before the fix; dt 0.5 x factor
#: 1.0 failed on 3 of 5 seeds and dt 0.4 x factor 1.0 on 1 of 5.
SQUEEZE_STEP_GRID = [(dt, f) for dt in (0.3, 0.4, 0.5) for f in (0.6, 0.8, 1.0)]


@pytest.mark.parametrize("aid", ["e175", "a320neo", "b737_max8", "a220_300",
                                 "b777_300er", "b787_9"])
def test_no_strategy_time_step_squeeze_combination_hits_the_time_limit(aid):
    """The deadlock sweep, second axis: strategy x dt x stowPassSpeedFactor.

    Sweeping strategies against doors alone could not have caught the
    squeeze-past deadlock, because the default `dt` of 0.1 never advances a
    passer far enough in one step to land inside a second stower's zone. The
    combination is reachable from the shipped UI by dragging two sliders, so it
    is swept here rather than left to a user to discover.
    """
    from plane_boarding.strategies import STRATEGIES
    for strategy in STRATEGIES:
        for dt, factor in SQUEEZE_STEP_GRID:
            r = simulate(cfg_for(aid, strategy, seed=2, dt=dt,
                                 stowPassSpeedFactor=factor))
            assert r.completed, (
                f"{aid}/{strategy}/dt={dt}/factor={factor} hit MAX_SIM_SECONDS")
            assert r.totalSeconds < 3600, (
                f"{aid}/{strategy}/dt={dt}/factor={factor} took {r.totalSeconds:.0f}s")
