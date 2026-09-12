"""Aisle invariants, checked frame by frame against a full-resolution replay.

Recording at `frameInterval == dt` gives one frame per simulation step, so these
assertions see exactly what the engine saw.
"""

from __future__ import annotations

import pytest

from plane_boarding.aircraft import get_aircraft
from plane_boarding.config import (
    BODY_DEPTH, SEATED, SHUFFLING, STOWING, WALKING,
)
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


def test_only_one_passenger_is_ever_in_a_stower_squeeze_gap():
    """The squeeze is one-at-a-time, stated as what is actually guaranteed.

    Two passengers can both be within a body depth of the same stower, but only
    on OPPOSITE sides of them -- one has finished crossing and the next has
    started. That is a handover, not a double squeeze, and it is bounded by
    solid-body exclusion (they are still 0.4 m from each other). The lock hands
    over when the outgoing passer's next obstruction changes rather than when it
    is fully clear, deliberately: holding on until clear can leave a passer
    unable to advance and the stower unable to stand up, which is a deadlock.

    So the crisp invariants are: at most one body in the gap on each side, and
    no two passengers crossing the stower's position in the same step.
    """
    cfg, ac, result, replay, speed, lanes = trace("a320neo", "random", loadFactor=0.95)
    states, xs = replay["frames"]["state"], replay["frames"]["x"]
    n_frames = len(states)
    assert result.completed, "the run did not finish -- something is deadlocked"

    crossings = 0
    for f in range(1, n_frames):
        st, row, prow = states[f], xs[f], xs[f - 1]
        for i, si in enumerate(st):
            if si != STOWING:
                continue
            ahead = behind = 0
            crossing_now = 0
            for j, sj in enumerate(st):
                if j == i or lanes[j] != lanes[i] or sj not in (WALKING, SHUFFLING):
                    continue
                d = row[j] - row[i]
                if abs(d) < BODY_DEPTH - 1e-3:
                    if d > 0:
                        ahead += 1
                    else:
                        behind += 1
                # Only a real step counts as a crossing. A passenger released
                # from the gate jumps from the queue position to the door, which
                # is a teleport, not an overtake.
                if states[f - 1][j] not in (WALKING, SHUFFLING):
                    continue
                pd = prow[j] - prow[i]
                if pd != 0 and d != 0 and (pd < 0) != (d < 0):
                    crossing_now += 1
                    crossings += 1
            assert ahead <= 1 and behind <= 1, (
                f"frame {f}: {ahead} ahead / {behind} behind stower {i} -- "
                f"two bodies in the same half of the squeeze gap")
            assert crossing_now <= 1, (
                f"frame {f}: {crossing_now} passengers crossed stower {i} at once")
    assert crossings > 0, "no squeeze ever happened -- this test proves nothing"


def test_a_squeeze_always_resolves():
    """A pair stuck inside the exclusion distance forever is the deadlock this
    mechanism introduced twice during development. Every stower must reach a
    frame where nobody is alongside them, and the run must terminate."""
    cfg, ac, result, replay, speed, lanes = trace("a320neo", "random", loadFactor=0.95)
    states, xs = replay["frames"]["state"], replay["frames"]["x"]
    assert result.completed
    last = len(states) - 1
    for i, si in enumerate(states[last]):
        assert si == SEATED
    # No stower may still have company in the final frame of its own stow.
    for i in range(len(lanes)):
        fs = [f for f in range(len(states)) if states[f][i] == STOWING]
        if not fs:
            continue
        f = fs[-1]
        alongside = [
            j for j in range(len(lanes))
            if j != i and lanes[j] == lanes[i]
            and states[f][j] in (WALKING, SHUFFLING)
            and abs(xs[f][j] - xs[f][i]) < BODY_DEPTH - 1e-3
        ]
        assert not alongside, (
            f"stower {i} still had {alongside} alongside on its last stowing frame")


def squeeze_lock_audit(aid="a320neo", strategy="random", seed=3, **ov):
    """Audit the squeeze LOCK, which the replay format deliberately does not
    carry, via `engine.run(tick_hook=...)`.

    Returns `(result, approaching, exiting)` where the two counters split every
    (STOWING i, WALKING/SHUFFLING j) pair that is inside `i`'s body-depth zone
    while `j` does NOT hold `i`'s squeeze lock, by which side of `i` the walker
    is on **in its own direction of travel**:

    * `exiting`     -- `j` has already crossed `i`. Legal and expected: the lock
      hands over to the next stower as soon as the passer's obstruction changes
      rather than when it is fully clear, which is deliberate (see
      `test_only_one_passenger_is_ever_in_a_stower_squeeze_gap`) and is what
      keeps a passer from being stuck holding a lock it cannot release.
    * `approaching` -- `j` has NOT crossed `i` and is sitting inside its zone
      unowned. **Must be zero.** This is the deadlock: `stow_done[i]` shuts the
      squeeze to new entrants once `i`'s stow finishes, so `j` can never acquire
      the lock, `j`'s gap clamps to 0, and `stower_clear(i)` never comes true
      because `j` is inside BODY_DEPTH. Circular wait.
    """
    cfg = cfg_for(aid, strategy, seed=seed, **ov)
    ac = get_aircraft(cfg.aircraftId)
    counts = [0, 0]          # [approaching, exiting]
    first_bad: list = []

    def hook(tick, t, pstate, px, plane, pdir, passing, pass_holder):
        # One pass to collect the two short lists, rather than n^2 over the
        # whole manifest every tick: at 180 passengers this is the difference
        # between a two-second test and a two-minute one.
        stowers = [i for i, s in enumerate(pstate) if s == STOWING]
        if not stowers:
            return
        movers = [i for i, s in enumerate(pstate) if s == WALKING or s == SHUFFLING]
        for i in stowers:
            xi, li, holder = px[i], plane[i], pass_holder[i]
            for j in movers:
                if plane[j] != li or holder == j:
                    continue
                if abs(px[j] - xi) >= BODY_DEPTH - 1e-9:
                    continue
                if pdir[j] * (px[j] - xi) > 0.0:
                    counts[1] += 1
                else:
                    counts[0] += 1
                    if not first_bad:
                        first_bad.append(
                            f"tick {tick} (t={t:.2f}s): passenger {j} is {abs(px[j] - xi):.3f} m "
                            f"behind stower {i} (BODY_DEPTH={BODY_DEPTH}) without holding "
                            f"its squeeze lock (held by {holder})")

    result, _ = run(cfg, ac, tick_hook=hook)
    return result, counts[0], counts[1], (first_bad[0] if first_bad else "")


#: The corners that used to wedge. `dt` (max 0.5) and `stowPassSpeedFactor`
#: (max 1.0) are both plain sliders in the shipped UI, so every one of these is
#: reachable by a user dragging two controls.
SQUEEZE_GRID = [(0.1, 0.4), (0.3, 0.6), (0.4, 0.8), (0.4, 1.0), (0.5, 0.8), (0.5, 1.0)]


@pytest.mark.parametrize("dt,factor", SQUEEZE_GRID)
@pytest.mark.parametrize("seed", [1, 3])
def test_a_walker_inside_a_stowers_zone_holds_that_stowers_lock(dt, factor, seed):
    """THE assertion that would have caught the squeeze-past deadlock.

    The step of a squeezing passenger is bounded by the very next body beyond
    the stower it owns. It used to be bounded by the first NON-STOWING body,
    skipping any intervening stowers -- so a passer could come to rest inside a
    second stower's exclusion zone holding no lock on it, and once that stow
    finished the pair could never separate. Measured before the fix: 4
    permanently wedged pairs at dt 0.5 / factor 1.0 and a run that never
    completed; one violation even on a seed that did complete, which is why
    "did it finish" is not a sufficient test.

    Exiting-side company is permitted and does occur at the shipped default --
    that is the documented lock handover, not a violation.

    The ownership assertion comes FIRST because it is strictly stronger than
    "the run finished": before the fix, dt 0.5 / factor 0.8 / seed 3 completed
    normally and still put a walker inside an unowned stower's zone once.
    """
    result, approaching, exiting, detail = squeeze_lock_audit(
        seed=seed, dt=dt, stowPassSpeedFactor=factor)
    assert approaching == 0, (
        f"dt={dt} factor={factor} seed={seed}: {approaching} tick(s) with a walker "
        f"inside an unowned stower's zone on the APPROACH side -- {detail}")
    assert result.completed, (
        f"dt={dt} factor={factor} seed={seed}: run hit MAX_SIM_SECONDS")


def test_the_squeeze_lock_audit_sees_real_squeezes():
    """Anti-vacuity guard for the test above: at the shipped default the audit
    must observe the handover transient it exists to permit. If this ever hits
    zero, the ownership assertion has stopped proving anything."""
    result, approaching, exiting, _ = squeeze_lock_audit(seed=3, loadFactor=0.9)
    assert result.completed
    assert approaching == 0
    assert exiting > 0, "no lock handover ever observed -- the audit proves nothing"


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


@pytest.mark.parametrize("factor", [0.0, 0.4, 0.6])
def test_a_shuffling_passenger_is_never_passed_at_any_squeeze_setting(factor):
    """The asymmetry that makes the mechanism physical rather than a fudge.

    A STOWING passenger has stepped into the seat-row gap, so you can edge past.
    A SHUFFLING passenger is standing IN the aisle with the row's other
    occupants so that a window passenger can get in -- walking through them is
    not a thing, at any squeeze setting including the most permissive.
    """
    cfg, ac, result, replay, speed, lanes = trace(
        "a320neo", "random", loadFactor=0.9, stowPassSpeedFactor=factor)
    states, xs = replay["frames"]["state"], replay["frames"]["x"]

    # (a) Nobody comes within a body depth of a shuffler.
    worst = 1e9
    pairs = 0
    for f, st in enumerate(states):
        row = xs[f]
        for i, si in enumerate(st):
            if si != SHUFFLING:
                continue
            for j, sj in enumerate(st):
                if j != i and sj in IN_AISLE and lanes[j] == lanes[i]:
                    pairs += 1
                    worst = min(worst, abs(row[j] - row[i]))
    # Anti-vacuity, as this test's siblings already do with `crossings > 0`:
    # `worst` starts at 1e9 and the assertion below is a lower bound, so with no
    # shuffler ever sharing a lane it passes while proving nothing at all.
    assert pairs > 0, (
        f"factor={factor}: no shuffler ever shared a lane with anybody -- "
        f"this test proves nothing")
    assert worst >= BODY_DEPTH - 1e-3, (
        f"factor={factor}: somebody got within {worst:.4f} m of a shuffler")

    # (b) And nobody ever gets past one.
    flips = _order_flips(states, xs, lanes, ignore_stowing=True)
    assert not flips, f"factor={factor}: illegal overtakes {flips[:5]}"
