/**
 * Determinism is the load-bearing property: this engine must match the Python
 * one bit for bit, which it cannot do if it does not first match itself.
 * Mirrors `python/tests/test_determinism.py`.
 */
import { describe, expect, it } from 'vitest'
import { runBatch } from '../../src/sim/batch.js'
import { DOOR_STREAM_BASE, ticksFor } from '../../src/sim/config.js'
import { PCG32 } from '../../src/sim/rng.js'
import { pyRound } from '../../src/sim/pyutil.js'
import { run, simulate } from '../../src/sim/engine.js'
import { STRATEGIES } from '../../src/sim/strategies.js'
import '../../src/sim/replay.js'
import { ALL_AIRCRAFT, cfgFor } from './helpers.js'

/** Structural deep-equality, so a mismatch reports a path rather than a diff of
 *  two 400 KB strings. Mirrors what `assert a == b` gives you in Python. */
function deepEq(a, b, path = '') {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} != ${b.length}`
    for (let i = 0; i < a.length; i++) {
      const d = deepEq(a[i], b[i], `${path}[${i}]`)
      if (d) return d
    }
    return null
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort()
    const kb = Object.keys(b).sort()
    if (ka.join(',') !== kb.join(',')) return `${path}: keys ${ka} != ${kb}`
    for (const k of ka) {
      const d = deepEq(a[k], b[k], `${path}.${k}`)
      if (d) return d
    }
    return null
  }
  return Object.is(a, b) ? null : `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`
}

const ALL = Object.keys(STRATEGIES).sort()

describe.each(ALL)('%s', (strategy) => {
  it('gives byte-identical output for the same config and seed', () => {
    const cfg = cfgFor('a220_300', strategy, 12345, { loadFactor: 0.8 })
    expect(JSON.stringify(simulate(cfg))).toBe(JSON.stringify(simulate(cfg)))
  })
})

it('depends on the config VALUES, not on object identity or cached state', () => {
  const one = JSON.stringify(simulate(cfgFor('e175', 'wilma', 9)))
  const two = JSON.stringify(simulate(cfgFor('e175', 'wilma', 9)))
  expect(one).toBe(two)
})

it('gives different results for different seeds', () => {
  const times = new Set()
  for (let s = 1; s < 9; s++) times.add(simulate(cfgFor('a320neo', 'random', s)).totalSeconds)
  expect(times.size).toBeGreaterThanOrEqual(7)
})

it('keeps the manifest fixed when only the strategy changes', () => {
  // The `pax` stream is seeded separately from `order`, so two strategies at
  // the same seed face an identical manifest. This is what makes the Monte
  // Carlo comparison paired.
  const a = simulate(cfgFor('a320neo', 'random', 4))
  const b = simulate(cfgFor('a320neo', 'wilma', 4))
  const key = (r) =>
    r.perPassenger
      .map((p) => `${p.id}:${p.bags}:${p.seat}`)
      .sort()
      .join('|')
  expect(key(a)).toBe(key(b))
  expect(a.totalSeconds).not.toBe(b.totalSeconds)
})

it('is not perturbed by recording a replay', () => {
  const cfg = cfgFor('b787_9', 'reverse_pyramid', 77)
  const plain = simulate(cfg)
  const { result, replay } = run(cfg, null, true, 0.25)
  expect(JSON.stringify(result)).toBe(JSON.stringify(plain))
  expect(replay).not.toBeNull()
  expect(replay.frameCount).toBe(replay.frames.state.length)
  expect(replay.frames.x.length).toBe(replay.frameCount)
})

it('treats SimConfig.replace as a pure copy', () => {
  const base = cfgFor('a320neo', 'random', 1)
  const derived = base.replace({ seed: 2 })
  expect(base.seed).toBe(1)
  expect(derived.seed).toBe(2)
  expect(simulate(base).totalSeconds).toBe(simulate(cfgFor('a320neo', 'random', 1)).totalSeconds)
})

it('separates the RNG streams, so a strategy cannot move a service time', () => {
  // Same manifest AND same per-passenger service draws: only the ORDER differs.
  const a = simulate(cfgFor('b737_max8', 'random', 31))
  const b = simulate(cfgFor('b737_max8', 'back_to_front', 31))
  const bagsOf = (r) => r.perPassenger.map((p) => p.bags).join(',')
  expect(bagsOf(a)).toBe(bagsOf(b))
})

// ---------------------------------------------------------------------------
// Complete common random numbers (ENGINE_SPEC 1.3).
// Mirrors the CRN tests in `python/tests/test_paired_stats.py`.
// ---------------------------------------------------------------------------

it('gives a passenger the same stow draw whenever they board', () => {
  // With the bin-congestion term removed and the bins roomy enough that nobody
  // searches or gate-checks, stow time is exactly `base * multiplier` -- a pure
  // draw from the passenger's own sub-stream -- so it must be identical under
  // every boarding order. This is the clean proof that service draws follow the
  // passenger and not the event order.
  const clean = { loadFactor: 0.9, doors: ['1L'], binCongestionWeight: 0.0, binBagsPerRowSide: 9 }
  const a = simulate(cfgFor('a320neo', 'random', 5, clean))
  const b = simulate(cfgFor('a320neo', 'front_to_back', 5, clean))
  const stows = (r) => r.perPassenger.map((p) => `${p.id}:${p.stowTime}`).join(',')
  expect(stows(a)).toBe(stows(b))
})

it('keeps most stow times across a change of order even with bin congestion on', () => {
  // Under shipped defaults the match rate sits around two thirds. The third
  // that differs is not RNG bookkeeping: stow duration carries a
  // `(1 + w * fill^2)` term and how full the bin above your row is when you
  // reach it genuinely depends on who boarded first. That is the effect being
  // measured, not noise to cancel.
  const over = { loadFactor: 0.9, doors: ['1L'] }
  const a = simulate(cfgFor('a320neo', 'random', 5, over))
  const b = simulate(cfgFor('a320neo', 'wilma', 5, over))
  const sa = new Map(a.perPassenger.map((p) => [p.id, p.stowTime]))
  let same = 0
  for (const p of b.perPassenger) if (Math.abs(sa.get(p.id) - p.stowTime) < 1e-9) same += 1
  expect(same).toBeGreaterThanOrEqual(a.perPassenger.length * 0.55)
})

it('draws the door arrival schedule from a per-door stream', () => {
  // Door arrivals belong to the DOOR, not the passenger: the k-th person to
  // reach a door waits the k-th drawn gap, whatever order the queue is in.
  // Compared against a reconstruction rather than between strategies, because
  // the REALISED entry times may slip later than the drawn ones -- nobody can
  // step through a doorway somebody is still standing in. This scenario is
  // deliberately uncongested so that slip is bounded at a couple of ticks.
  const over = { loadFactor: 0.3, doors: ['1L'], doorArrivalMean: 60.0 }
  const cfg = cfgFor('a320neo', 'random', 6, over)
  const n = simulate(cfg).paxCount

  const rng = new PCG32(cfg.seed, DOOR_STREAM_BASE + 0)
  const scheduled = []
  let tick = 0
  for (let i = 0; i < n; i++) {
    scheduled.push(pyRound(tick * cfg.dt, 6))
    tick += ticksFor(rng.exponential(cfg.doorArrivalMean), cfg.dt)
  }

  for (const strategy of ['random', 'wilma', 'front_to_back', 'southwest_2026', 'by_bags']) {
    const r = simulate(cfgFor('a320neo', strategy, 6, over))
    expect(r.completed).toBe(true)
    const entries = r.perPassenger.map((p) => pyRound(p.enterTime, 6)).sort((x, y) => x - y)
    for (let k = 0; k < n; k++) {
      expect(entries[k]).toBeGreaterThanOrEqual(scheduled[k] - 1e-9)
      expect(entries[k] - scheduled[k]).toBeLessThanOrEqual(2.0)
    }
  }
})


// ---------------------------------------------------------------------------
// The general guard. Mirrors `python/tests/test_determinism.py`.
// ---------------------------------------------------------------------------

/**
 * A spread of scenarios that between them exercise every source of state the
 * engine carries across a run: the open-seating picker's incremental
 * nearest-neighbour cache, the per-door arrival streams on a two-door aircraft,
 * the twin-aisle lane bookkeeping, the bin capacity tables, and the cached
 * `Aircraft` objects (memoised module-wide, and the most likely place for state
 * to leak between runs).
 */
const GUARD_SCENARIOS = [
  ['a320neo', 'random', 1, {}],
  ['e175', 'open_seating', 7, { openSeatingPolicy: 'avoid_neighbours' }],
  ['b777_300er', 'southwest_2026', 3, { doorAssignment: 'split_by_aisle' }],
  ['b787_9', 'common_sense_5tier', 11, {}],
  ['b737_max8', 'steffen_perfect', 5, { loadFactor: 1.0 }],
  ['a220_300', 'priority_5tier', 9, { loadFactor: 0.55 }],
]

describe.each(GUARD_SCENARIOS)('%s / %s / seed %i', (aid, strategy, seed, over) => {
  /**
   * The whole project rests on one claim: a given (config, seed) has exactly one
   * outcome, in both languages. That is normally checked indirectly -- parity
   * would go red, a digest would move -- but nothing asserted it head-on, which
   * meant an intermittently non-deterministic engine would look like a flaky
   * test rather than a broken guarantee.
   *
   * So: run it twice in the same process and compare everything, per-passenger
   * records included.
   *
   * Twice in ONE process matters. A fresh process would also catch a dependence
   * on the clock, but it would miss the likelier failure: state surviving in a
   * module-level cache from the previous run.
   */
  it('running the same scenario twice in one process is deeply equal', () => {
    const cfg = cfgFor(aid, strategy, seed, over)
    expect(deepEq(simulate(cfg), simulate(cfg), 'result')).toBeNull()
  })
})

it('is reproducible run for run across a whole batch', () => {
  // The same guard one level up: `runBatch` walks a seed sequence and
  // aggregates, so it also catches a generator leaking state from one
  // replication into the next, which a per-run comparison cannot see.
  const cfg = cfgFor('a320neo', 'wilma_zoned', 31, { loadFactor: 0.88 })
  expect(deepEq(runBatch(cfg, 5).toDict(true), runBatch(cfg, 5).toDict(true), 'batch')).toBeNull()
})

it('does not contaminate either scenario when two are interleaved', () => {
  // Determinism has to survive interleaving, not just repetition. If any engine
  // state were module-global rather than per-run, A,B,A would give a different
  // A from A,A.
  const aCfg = cfgFor('b777_300er', 'reverse_pyramid', 44, { loadFactor: 0.9 })
  const bCfg = cfgFor('e175', 'by_bags', 45, { loadFactor: 1.0 })
  const a1 = simulate(aCfg)
  const b1 = simulate(bCfg)
  const a2 = simulate(aCfg)
  const b2 = simulate(bCfg)
  expect(deepEq(a1, a2, 'a')).toBeNull()
  expect(deepEq(b1, b2, 'b')).toBeNull()
})

describe.each(ALL_AIRCRAFT)('%s', (aid) => {
  it('is deterministic under the default strategy', () => {
    const cfg = cfgFor(aid, 'random', 2026)
    expect(deepEq(simulate(cfg), simulate(cfg), aid)).toBeNull()
  })
})
