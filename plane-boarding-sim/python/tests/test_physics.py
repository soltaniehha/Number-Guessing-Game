"""Aisle invariants, checked frame by frame against a full-resolution replay.

Recording at `frameInterval == dt` gives one frame per simulation step, so these
assertions see exactly what the engine saw.
"""

from __future__ import annotations

import pytest

from plane_boarding.aircraft import get_aircraft
from plane_boarding.config import BODY_DEPTH, WALKING, SHUFFLING, STOWING
from plane_boarding.engine import run
from plane_boarding.passengers import generate
from plane_boarding.rng import PCG32
from plane_boarding.strategies import build_order

from helpers import cfg_for

IN_AISLE = (WALKING, STOWING, SHUFFLING)
EPS = 1e-6


def trace(aid="a320neo", strategy="random", seed=3, **ov):
    cfg = cfg_for(aid, strategy, seed=seed, **ov)
    ac = get_aircraft(cfg.aircraftId)
    result, replay = run(cfg, ac, record_replay=True, frame_interval=cfg.dt)
    # Recover per-passenger walk speed and lane, indexed the same way the frame
    # arrays are (by boardingIndex).
    pax = generate(PCG32(cfg.seed, 1), ac, cfg)
    queue = build_order(pax, ac, cfg, PCG32(cfg.seed, 2))
    speed = [0.0] * len(queue)
    for p in queue:
        speed[p.boardingIndex] = p.walkSpeed
    lanes = [p["lane"] for p in replay["passengers"]]
    return cfg, ac, result, replay, speed, lanes


@pytest.mark.parametrize("aid,strategy", [
    ("a320neo", "random"), ("b737_max8", "random"), ("b777_300er", "wilma"),
])
def test_two_people_are_never_closer_than_one_body_depth(aid, strategy):
    cfg, ac, result, replay, speed, lanes = trace(aid, strategy, loadFactor=0.9)
    states, xs = replay["frames"]["state"], replay["frames"]["x"]
    worst = 1e9
    for f, st in enumerate(states):
        row = xs[f]
        by_lane = {}
        for i, s in enumerate(st):
            if s in IN_AISLE:
                by_lane.setdefault(lanes[i], []).append(row[i])
        for occupants in by_lane.values():
            occupants.sort()
            for a, b in zip(occupants, occupants[1:]):
                worst = min(worst, b - a)
    # The replay rounds x to 0.1 mm, so allow that much slack and no more.
    assert worst >= BODY_DEPTH - 1e-3, f"closest approach was {worst:.4f} m"


def test_nobody_moves_faster_than_their_own_walk_speed():
    cfg, ac, result, replay, speed, lanes = trace("a320neo", "random")
    states, xs = replay["frames"]["state"], replay["frames"]["x"]
    dt = replay["frameInterval"]
    for f in range(1, len(states)):
        prev_st, st = states[f - 1], states[f]
        prev_x, x = xs[f - 1], xs[f]
        for i, s in enumerate(st):
            if s in IN_AISLE and prev_st[i] in IN_AISLE:
                moved = abs(x[i] - prev_x[i])
                assert moved <= speed[i] * dt + 1e-3, (
                    f"pax {i} moved {moved:.4f} m in one step at {speed[i]:.3f} m/s")


def test_a_stowing_or_seated_passenger_does_not_drift():
    cfg, ac, result, replay, speed, lanes = trace("a220_300", "random")
    states, xs = replay["frames"]["state"], replay["frames"]["x"]
    for f in range(1, len(states)):
        for i, s in enumerate(states[f]):
            if s in (STOWING, SHUFFLING) and states[f - 1][i] == s:
                assert xs[f][i] == pytest.approx(xs[f - 1][i], abs=1e-6)


def test_nobody_overtakes_in_a_single_aisle_lane():
    """A cabin aisle is strictly single file. If the relative order of two people
    in the same lane ever flips, the exclusion model is broken."""
    cfg, ac, result, replay, speed, lanes = trace("a320neo", "random", loadFactor=0.95)
    states, xs = replay["frames"]["state"], replay["frames"]["x"]
    prev_order = {}
    for f, st in enumerate(states):
        by_lane = {}
        for i, s in enumerate(st):
            if s in IN_AISLE:
                by_lane.setdefault(lanes[i], []).append((xs[f][i], i))
        for lane, occ in by_lane.items():
            occ.sort()
            order = [i for _, i in occ]
            rank = {pid: k for k, pid in enumerate(order)}
            for pid, k in rank.items():
                for other, k2 in rank.items():
                    if pid < other and pid in prev_order.get(lane, {}) and other in prev_order[lane]:
                        was = prev_order[lane][pid] < prev_order[lane][other]
                        now = k < k2
                        assert was == now, (
                            f"pax {pid} and {other} swapped places in lane {lane} at frame {f}")
            prev_order.setdefault(lane, {})
            prev_order[lane] = rank


def test_passengers_only_ever_move_toward_their_own_seat():
    cfg, ac, result, replay, speed, lanes = trace("b787_9", "random", loadFactor=0.85)
    states, xs = replay["frames"]["state"], replay["frames"]["x"]
    targets = [p["seatX"] for p in replay["passengers"]]
    for f in range(1, len(states)):
        for i, s in enumerate(states[f]):
            if s == WALKING and states[f - 1][i] == WALKING:
                before = abs(targets[i] - xs[f - 1][i])
                after = abs(targets[i] - xs[f][i])
                assert after <= before + 1e-6, f"pax {i} walked away from their seat"


def test_state_machine_only_advances():
    """QUEUED -> WALKING -> STOWING -> SHUFFLING -> SEATED, never backwards."""
    cfg, ac, result, replay, speed, lanes = trace("e175", "steffen_perfect")
    states = replay["frames"]["state"]
    for f in range(1, len(states)):
        for a, b in zip(states[f - 1], states[f]):
            assert b >= a, "a passenger regressed to an earlier state"


def test_zero_bag_passengers_skip_stowing_entirely():
    r, _ = run(cfg_for("a320neo", "random", seed=2, bagWeights={"0": 1.0}))
    assert r.timeBreakdown["stow"] == 0.0
    assert r.gateChecks == 0 and r.binSearches == 0
