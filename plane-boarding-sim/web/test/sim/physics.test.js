/**
 * Aisle invariants, checked frame by frame against a full-resolution replay.
 *
 * Recording at `frameInterval == dt` gives one frame per simulation step, so
 * these assertions see exactly what the engine saw.
 * Mirrors `python/tests/test_physics.py`.
 */
import { describe, expect, it } from 'vitest'
import { getAircraft } from '../../src/sim/aircraft.js'
import { BODY_DEPTH, SEATED, SHUFFLING, STOWING, WALKING } from '../../src/sim/config.js'
import { run } from '../../src/sim/engine.js'
import { generate } from '../../src/sim/passengers.js'
import { PCG32 } from '../../src/sim/rng.js'
import { buildOrder } from '../../src/sim/strategies.js'
import '../../src/sim/replay.js'
import { cfgFor } from './helpers.js'

const IN_AISLE = new Set([WALKING, STOWING, SHUFFLING])
const SOLID = new Set([WALKING, SHUFFLING])

/**
 * Assert a per-(frame, passenger) invariant over a whole replay.
 *
 * These sweeps visit 400,000-1,600,000 (frame, passenger) pairs. Calling
 * `expect()` at each one costs about ten microseconds of matcher machinery --
 * several seconds in total, against a simulation that takes 75 ms -- which is
 * enough to push a test past vitest's 5 s default when the suite is running 43
 * files in parallel and the machine is loaded. That failure looks exactly like
 * a nondeterministic engine and is not one: the run is bit-identical every
 * time, it is the assertion loop that is slow.
 *
 * So scan in plain JS and raise ONE assertion, naming the first offending
 * (frame, passenger) so a real violation is still diagnosable.
 *
 * @param {number} frames   frame count
 * @param {number} n        passengers per frame
 * @param {(f:number,i:number)=>string|null} check  message if violated, else null
 */
function everyFrame(frames, n, check) {
  for (let f = 1; f < frames; f++) {
    for (let i = 0; i < n; i++) {
      const bad = check(f, i)
      if (bad !== null) return `frame ${f}, passenger ${i}: ${bad}`
    }
  }
  return null
}

/** One run recorded at full resolution, plus per-passenger walk speed and lane. */
function trace(aid = 'a320neo', strategy = 'random', seed = 3, overrides = {}) {
  const cfg = cfgFor(aid, strategy, seed, overrides)
  const ac = getAircraft(cfg.aircraftId)
  const { result, replay } = run(cfg, ac, true, cfg.dt)
  const pax = generate(new PCG32(cfg.seed, 1), ac, cfg)
  const queue = buildOrder(pax, ac, cfg, new PCG32(cfg.seed, 2))
  const speed = new Array(queue.length).fill(0)
  for (const p of queue) speed[p.boardingIndex] = p.walkSpeed
  const lanes = replay.passengers.map((p) => p.lane)
  return { cfg, ac, result, replay, speed, lanes }
}

/** Closest approach, in metres, between any two passengers in `kinds`. */
function closestApproach(states, xs, lanes, kinds) {
  let worst = 1e9
  for (let f = 0; f < states.length; f++) {
    const st = states[f]
    const row = xs[f]
    const byLane = new Map()
    for (let i = 0; i < st.length; i++) {
      if (!kinds.has(st[i])) continue
      let list = byLane.get(lanes[i])
      if (list === undefined) byLane.set(lanes[i], (list = []))
      list.push(row[i])
    }
    for (const occupants of byLane.values()) {
      occupants.sort((a, b) => a - b)
      for (let k = 1; k < occupants.length; k++) {
        const gap = occupants[k] - occupants[k - 1]
        if (gap < worst) worst = gap
      }
    }
  }
  return worst
}

/**
 * Every `[frame, a, b]` where two people in the same lane swapped places.
 *
 * With `ignoreStowing` the pair is skipped when either was STOWING in the frame
 * before or after the swap, which is exactly the squeeze exemption.
 */
function orderFlips(states, xs, lanes, ignoreStowing) {
  const flips = []
  let prevRank = new Map()
  let prevState = null
  for (let f = 0; f < states.length; f++) {
    const st = states[f]
    const byLane = new Map()
    for (let i = 0; i < st.length; i++) {
      if (!IN_AISLE.has(st[i])) continue
      let list = byLane.get(lanes[i])
      if (list === undefined) byLane.set(lanes[i], (list = []))
      list.push([xs[f][i], i])
    }
    const rank = new Map()
    for (const [lane, occ] of byLane) {
      occ.sort((a, b) => a[0] - b[0] || a[1] - b[1])
      occ.forEach(([, pid], k) => rank.set(pid, [lane, k]))
    }
    for (const [pid, [lane, k]] of rank) {
      for (const [other, [lane2, k2]] of rank) {
        if (pid >= other || lane !== lane2) continue
        const a = prevRank.get(pid)
        const b = prevRank.get(other)
        if (!a || !b || a[0] !== lane) continue
        if (a[1] < b[1] === k < k2) continue
        if (
          ignoreStowing &&
          (st[pid] === STOWING ||
            st[other] === STOWING ||
            prevState[pid] === STOWING ||
            prevState[other] === STOWING)
        ) {
          continue
        }
        flips.push([f, pid, other])
      }
    }
    prevRank = rank
    prevState = st
  }
  return flips
}

describe.each([
  ['a320neo', 'random'],
  ['b737_max8', 'random'],
  ['b777_300er', 'wilma'],
])('%s / %s', (aid, strategy) => {
  it('keeps solid bodies at least one body depth apart', () => {
    // Exclusion applies to everyone standing IN the aisle: walkers and, above
    // all, shuffling passengers. A STOWING passenger is deliberately excluded
    // -- they have stepped into the seat-row gap and a follower is allowed to
    // edge past (ENGINE_SPEC 6.3). That exemption is checked separately below.
    const { replay, lanes } = trace(aid, strategy, 3, { loadFactor: 0.9 })
    const worst = closestApproach(replay.frames.state, replay.frames.x, lanes, SOLID)
    // The replay rounds x to 0.1 mm, so allow that much slack and no more.
    expect(worst).toBeGreaterThanOrEqual(BODY_DEPTH - 1e-3)
  })
})

describe.each(['a320neo', 'b777_300er'])('%s with the squeeze off', (aid) => {
  it('excludes stowing passengers too, i.e. plain single file', () => {
    const { replay, lanes } = trace(aid, 'random', 3, {
      loadFactor: 0.9,
      stowPassSpeedFactor: 0.0,
    })
    const worst = closestApproach(replay.frames.state, replay.frames.x, lanes, IN_AISLE)
    expect(worst).toBeGreaterThanOrEqual(BODY_DEPTH - 1e-3)
  })
})

it('never puts two passengers in the same half of a stower squeeze gap', () => {
  // The squeeze is one-at-a-time. Two passengers can both be within a body
  // depth of the same stower, but only on OPPOSITE sides -- one has finished
  // crossing and the next has started. That is a handover, not a double
  // squeeze, and they are still 0.4 m from each other.
  const { result, replay, lanes } = trace('a320neo', 'random', 3, { loadFactor: 0.95 })
  const { state: states, x: xs } = replay.frames
  expect(result.completed).toBe(true)

  let crossings = 0
  for (let f = 1; f < states.length; f++) {
    const st = states[f]
    const row = xs[f]
    const prow = xs[f - 1]
    for (let i = 0; i < st.length; i++) {
      if (st[i] !== STOWING) continue
      let ahead = 0
      let behind = 0
      let crossingNow = 0
      for (let j = 0; j < st.length; j++) {
        if (j === i || lanes[j] !== lanes[i] || !SOLID.has(st[j])) continue
        const d = row[j] - row[i]
        if (Math.abs(d) < BODY_DEPTH - 1e-3) {
          if (d > 0) ahead += 1
          else behind += 1
        }
        // Only a real step counts as a crossing. A passenger released from the
        // gate jumps from the queue position to the door, which is a teleport.
        if (!SOLID.has(states[f - 1][j])) continue
        const pd = prow[j] - prow[i]
        if (pd !== 0 && d !== 0 && pd < 0 !== d < 0) {
          crossingNow += 1
          crossings += 1
        }
      }
      expect(ahead).toBeLessThanOrEqual(1)
      expect(behind).toBeLessThanOrEqual(1)
      expect(crossingNow).toBeLessThanOrEqual(1)
    }
  }
  expect(crossings).toBeGreaterThan(0)
})

it('always resolves a squeeze rather than deadlocking', () => {
  // A pair stuck inside the exclusion distance forever is the failure mode this
  // mechanism introduces. Every stower must reach a frame with nobody
  // alongside, and the run must terminate.
  const { result, replay, lanes } = trace('a320neo', 'random', 3, { loadFactor: 0.95 })
  const { state: states, x: xs } = replay.frames
  expect(result.completed).toBe(true)
  const last = states.length - 1
  for (const s of states[last]) expect(s).toBe(SEATED)
  for (let i = 0; i < lanes.length; i++) {
    let lastStowFrame = -1
    for (let f = 0; f < states.length; f++) if (states[f][i] === STOWING) lastStowFrame = f
    if (lastStowFrame < 0) continue
    const f = lastStowFrame
    const alongside = []
    for (let j = 0; j < lanes.length; j++) {
      if (j === i || lanes[j] !== lanes[i]) continue
      if (SOLID.has(states[f][j]) && Math.abs(xs[f][j] - xs[f][i]) < BODY_DEPTH - 1e-3) {
        alongside.push(j)
      }
    }
    expect(alongside).toEqual([])
  }
})

/**
 * Audit the squeeze LOCK, which the replay format deliberately does not carry,
 * via `run(..., tickHook)`. Mirrors `squeeze_lock_audit` in
 * `python/tests/test_physics.py`.
 *
 * Splits every (STOWING i, WALKING/SHUFFLING j) pair inside `i`'s body-depth
 * zone where `j` does NOT hold `i`'s squeeze lock, by which side of `i` the
 * walker is on in its own direction of travel:
 *
 * - `exiting`     — `j` has already crossed `i`. Legal and expected: the lock
 *   hands over to the next stower as soon as the passer's obstruction changes
 *   rather than when it is fully clear, which is deliberate and is what stops a
 *   passer being stuck holding a lock it cannot release.
 * - `approaching` — `j` has NOT crossed `i` and sits inside its zone unowned.
 *   Must be zero. This is the deadlock: `stowDone[i]` shuts the squeeze to new
 *   entrants once `i`'s stow finishes, so `j` can never take the lock, its gap
 *   clamps to 0, and `stowerClear(i)` never comes true. Circular wait.
 */
function squeezeLockAudit(overrides = {}, seed = 3) {
  const cfg = cfgFor('a320neo', 'random', seed, overrides)
  const ac = getAircraft(cfg.aircraftId)
  let approaching = 0
  let exiting = 0
  let detail = ''
  const hook = (tick, t, pstate, px, plane, pdir, passing, passHolder) => {
    // One pass to collect the two short lists, rather than n^2 over the whole
    // manifest every tick.
    const stowers = []
    const movers = []
    for (let i = 0; i < pstate.length; i++) {
      if (pstate[i] === STOWING) stowers.push(i)
      else if (pstate[i] === WALKING || pstate[i] === SHUFFLING) movers.push(i)
    }
    if (!stowers.length) return
    for (const i of stowers) {
      const xi = px[i]
      const li = plane[i]
      const holder = passHolder[i]
      for (const j of movers) {
        if (plane[j] !== li || holder === j) continue
        const sep = Math.abs(px[j] - xi)
        if (sep >= BODY_DEPTH - 1e-9) continue
        if (pdir[j] * (px[j] - xi) > 0.0) exiting += 1
        else {
          approaching += 1
          if (!detail) {
            detail =
              `tick ${tick} (t=${t.toFixed(2)}s): passenger ${j} is ${sep.toFixed(3)} m ` +
              `behind stower ${i} (BODY_DEPTH=${BODY_DEPTH}) without holding its ` +
              `squeeze lock (held by ${holder})`
          }
        }
      }
    }
  }
  const { result } = run(cfg, ac, false, 0.25, hook)
  return { result, approaching, exiting, detail }
}

// The corners that used to wedge. `dt` (max 0.5) and `stowPassSpeedFactor`
// (max 1.0) are both plain sliders in the shipped UI, so every one of these is
// reachable by a user dragging two controls.
const SQUEEZE_GRID = [
  [0.1, 0.4],
  [0.3, 0.6],
  [0.4, 0.8],
  [0.4, 1.0],
  [0.5, 0.8],
  [0.5, 1.0],
]

describe.each([1, 3])('seed %i', (seed) => {
  it.each(SQUEEZE_GRID)(
    'keeps a walker inside a stower’s zone holding that stower’s lock (dt %f, factor %f)',
    (dt, factor) => {
      // THE assertion that would have caught the squeeze-past deadlock. The step
      // of a squeezing passenger is bounded by the very next body beyond the
      // stower it owns; it used to be bounded by the first NON-STOWING body,
      // skipping intervening stowers, so a passer could come to rest inside a
      // second stower's exclusion zone holding no lock on it and the pair could
      // never separate.
      //
      // The ownership assertion comes FIRST because it is strictly stronger than
      // "the run finished": before the fix, dt 0.5 / factor 0.8 / seed 3
      // completed normally and still put a walker inside an unowned stower's
      // zone once.
      const { result, approaching, detail } = squeezeLockAudit(
        { dt, stowPassSpeedFactor: factor },
        seed,
      )
      expect(
        approaching,
        `dt=${dt} factor=${factor} seed=${seed}: walker inside an unowned stower’s ` +
          `zone on the APPROACH side -- ${detail}`,
      ).toBe(0)
      expect(result.completed, `dt=${dt} factor=${factor} seed=${seed}`).toBe(true)
    },
  )
})

it('sees real squeezes, so the lock audit is not vacuous', () => {
  // Anti-vacuity guard: at the shipped default the audit must observe the
  // handover transient it exists to permit. If this hits zero, the ownership
  // assertion has stopped proving anything.
  const { result, approaching, exiting } = squeezeLockAudit({ loadFactor: 0.9 })
  expect(result.completed).toBe(true)
  expect(approaching).toBe(0)
  expect(exiting).toBeGreaterThan(0)
})

it('never lets anybody move faster than their own walk speed', () => {
  const { replay, speed } = trace('a320neo', 'random')
  const { state: states, x: xs } = replay.frames
  const dt = replay.frameInterval
  const bad = everyFrame(states.length, states[0].length, (f, i) => {
    if (!IN_AISLE.has(states[f][i]) || !IN_AISLE.has(states[f - 1][i])) return null
    const moved = Math.abs(xs[f][i] - xs[f - 1][i])
    const cap = speed[i] * dt + 1e-3
    return moved <= cap ? null : `moved ${moved.toFixed(4)}m in one tick, cap ${cap.toFixed(4)}m`
  })
  expect(bad).toBeNull()
})

it('does not let a stowing or shuffling passenger drift', () => {
  const { replay } = trace('a220_300', 'random')
  const { state: states, x: xs } = replay.frames
  const bad = everyFrame(states.length, states[0].length, (f, i) => {
    const s = states[f][i]
    if (!(s === STOWING || s === SHUFFLING) || states[f - 1][i] !== s) return null
    const drift = Math.abs(xs[f][i] - xs[f - 1][i])
    return drift < 5e-7 ? null : `drifted ${drift}m while state ${s}`
  })
  expect(bad).toBeNull()
})

it('permits an overtake only past a STOWING passenger', () => {
  // A cabin aisle is single file. The one exception the model allows is edging
  // past somebody who has stepped aside to load a bin.
  const { replay, lanes } = trace('a320neo', 'random', 3, { loadFactor: 0.95 })
  const { state: states, x: xs } = replay.frames
  expect(orderFlips(states, xs, lanes, true)).toEqual([])
  expect(orderFlips(states, xs, lanes, false).length).toBeGreaterThan(0)
})

it('permits no overtaking at all with strict blocking', () => {
  const { replay, lanes } = trace('a320neo', 'random', 3, {
    loadFactor: 0.95,
    stowPassSpeedFactor: 0.0,
  })
  expect(orderFlips(replay.frames.state, replay.frames.x, lanes, false)).toEqual([])
})

it('only ever moves a walker toward their own seat', () => {
  const { replay } = trace('b787_9', 'random', 3, { loadFactor: 0.85 })
  const { state: states, x: xs } = replay.frames
  const targets = replay.passengers.map((p) => p.seatX)
  const bad = everyFrame(states.length, states[0].length, (f, i) => {
    if (states[f][i] !== WALKING || states[f - 1][i] !== WALKING) return null
    const before = Math.abs(targets[i] - xs[f - 1][i])
    const after = Math.abs(targets[i] - xs[f][i])
    return after <= before + 1e-6 ? null : `moved away from seat, ${before} -> ${after}`
  })
  expect(bad).toBeNull()
})

it('only ever advances the state machine', () => {
  // QUEUED -> WALKING -> STOWING -> SHUFFLING -> SEATED, never backwards.
  const { replay } = trace('e175', 'steffen_perfect')
  const states = replay.frames.state
  const bad = everyFrame(states.length, states[0].length, (f, i) =>
    states[f][i] >= states[f - 1][i]
      ? null
      : `state went backwards ${states[f - 1][i]} -> ${states[f][i]}`,
  )
  expect(bad).toBeNull()
})

it('skips stowing entirely for zero-bag passengers', () => {
  const r = run(cfgFor('a320neo', 'random', 2, { bagWeights: { 0: 1.0 } })).result
  expect(r.timeBreakdown.stow).toBe(0)
  expect(r.gateChecks).toBe(0)
  expect(r.binSearches).toBe(0)
})

describe.each([0.0, 0.4, 0.6])('squeeze factor %s', (factor) => {
  it('never lets anybody pass or crowd a SHUFFLING passenger', () => {
    // The asymmetry that makes the mechanism physical rather than a fudge. A
    // STOWING passenger has stepped into the seat-row gap. A SHUFFLING one is
    // standing IN the aisle with the row's other occupants so a window
    // passenger can get in -- walking through them is not a thing.
    const { replay, lanes } = trace('a320neo', 'random', 3, {
      loadFactor: 0.9,
      stowPassSpeedFactor: factor,
    })
    const { state: states, x: xs } = replay.frames

    let worst = 1e9
    let pairs = 0
    for (let f = 0; f < states.length; f++) {
      const st = states[f]
      const row = xs[f]
      for (let i = 0; i < st.length; i++) {
        if (st[i] !== SHUFFLING) continue
        for (let j = 0; j < st.length; j++) {
          if (j !== i && IN_AISLE.has(st[j]) && lanes[j] === lanes[i]) {
            pairs += 1
            const gap = Math.abs(row[j] - row[i])
            if (gap < worst) worst = gap
          }
        }
      }
    }
    // Anti-vacuity, as this test's siblings already do with `crossings > 0`:
    // `worst` starts at 1e9 and the assertion below is a lower bound, so with no
    // shuffler ever sharing a lane it passes while proving nothing at all.
    expect(pairs, 'no shuffler ever shared a lane -- this test proves nothing').toBeGreaterThan(0)
    expect(worst).toBeGreaterThanOrEqual(BODY_DEPTH - 1e-3)
    expect(orderFlips(states, xs, lanes, true)).toEqual([])
  })
})
