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
def test_solid_bodies_are_never_closer_than_one_body_depth(aid, strategy):
    """Exclusion applies to everyone standing IN the aisle: walkers and, above
    all, shuffling passengers. A STOWING passenger is deliberately excluded --
    they have stepped into the seat-row gap and a follower is allowed to edge
    past them (ENGINE_SPEC 6.3). That exemption is checked separately below."""
    cfg, ac, result, replay, speed, lanes = trace(aid, strategy, loadFactor=0.9)
    states, xs = replay["frames"]["state"], replay["frames"]["x"]
    worst = 1e9
    for f, st in enumerate(states):
        row = xs[f]
        by_lane = {}
        for i, s in enumerate(st):
            if s in (WALKING, SHUFFLING):
                by_lane.setdefault(lanes[i], []).append(row[i])
        for occupants in by_lane.values():
            occupants.sort()
            for a, b in zip(occupants, occupants[1:]):
                worst = min(worst, b - a)
    # The replay rounds x to 0.1 mm, so allow that much slack and no more.
    assert worst >= BODY_DEPTH - 1e-3, f"closest approach was {worst:.4f} m"


@pytest.mark.parametrize("aid", ["a320neo", "b777_300er"])
def test_strict_blocking_excludes_stowing_passengers_too(aid):
    """With the squeeze switched off the model must be a plain single-file
    exclusion process again: nobody within a body depth of ANYBODY."""
    cfg, ac, result, replay, speed, lanes = trace(
        aid, "random", loadFactor=0.9, stowPassSpeedFactor=0.0)
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
    assert worst >= BODY_DEPTH - 1e-3, f"closest approach was {worst:.4f} m"


def test_only_one_passenger_squeezes_past_a_stower_at_a_time():
    """The squeeze is a one-at-a-time mutual exclusion. If two followers were
    ever alongside the same stowing passenger, the lock is broken."""
    cfg, ac, result, replay, speed, lanes = trace("a320neo", "random", loadFactor=0.95)
    states, xs = replay["frames"]["state"], replay["frames"]["x"]
    for f, st in enumerate(states):
        row = xs[f]
        for i, s in enumerate(st):
            if s != STOWING:
                continue
            close = sum(
                1 for j, s2 in enumerate(st)
                if j != i and s2 in (WALKING, SHUFFLING) and lanes[j] == lanes[i]
                and abs(row[j] - row[i]) < BODY_DEPTH - 1e-6
            )
            assert close <= 1, (
                f"{close} passengers alongside stower {i} at frame {f}")


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


def test_the_only_legal_overtake_is_past_a_stowing_passenger():
    """A cabin aisle is single file. The one exception the model allows is
    edging past somebody who has stepped aside to load a bin -- so an order flip
    is legal if and only if a STOWING passenger is one of the two."""
    cfg, ac, result, replay, speed, lanes = trace("a320neo", "random", loadFactor=0.95)
    states, xs = replay["frames"]["state"], replay["frames"]["x"]
    illegal = _order_flips(states, xs, lanes, ignore_stowing=True)
    assert not illegal, f"illegal overtakes: {illegal[:5]}"
    legal = _order_flips(states, xs, lanes, ignore_stowing=False)
    assert legal, "no squeeze ever happened -- this test is not exercising anything"


def test_strict_blocking_permits_no_overtaking_at_all():
    cfg, ac, result, replay, speed, lanes = trace(
        "a320neo", "random", loadFactor=0.95, stowPassSpeedFactor=0.0)
    states, xs = replay["frames"]["state"], replay["frames"]["x"]
    assert not _order_flips(states, xs, lanes, ignore_stowing=False)


def _order_flips(states, xs, lanes, ignore_stowing):
    """Every (frame, a, b) where two people in the same lane swapped places.

    With `ignore_stowing` the pair is skipped when either was STOWING in the
    frame before or after the swap, which is exactly the squeeze exemption.
    """
    flips = []
    prev_rank = {}
    prev_state = None
    for f, st in enumerate(states):
        by_lane = {}
        for i, s in enumerate(st):
            if s in IN_AISLE:
                by_lane.setdefault(lanes[i], []).append((xs[f][i], i))
        rank = {}
        for lane, occ in by_lane.items():
            occ.sort()
            for k, (_, pid) in enumerate(occ):
                rank[pid] = (lane, k)
        for pid, (lane, k) in rank.items():
            for other, (lane2, k2) in rank.items():
                if pid >= other or lane != lane2:
                    continue
                before = prev_rank.get(pid), prev_rank.get(other)
                if before[0] is None or before[1] is None or before[0][0] != lane:
                    continue
                if (before[0][1] < before[1][1]) == (k < k2):
                    continue
                if ignore_stowing and (
                    st[pid] == STOWING or st[other] == STOWING
                    or prev_state[pid] == STOWING or prev_state[other] == STOWING
                ):
                    continue
                flips.append((f, pid, other))
        prev_rank, prev_state = rank, st
    return flips


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
