/**
 * Aisle invariants, checked frame by frame against a full-resolution replay.
 *
 * Recording at `frameInterval == dt` gives one frame per simulation step, so
 * these assertions see exactly what the engine saw.
 * Mirrors `python/tests/test_physics.py`.
 */
import { describe, expect, it } from 'vitest'
import { getAircraft } from '../../src/sim/aircraft.js'
import { BODY_DEPTH, SHUFFLING, STOWING, WALKING } from '../../src/sim/config.js'
import { run } from '../../src/sim/engine.js'
import { generate } from '../../src/sim/passengers.js'
import { PCG32 } from '../../src/sim/rng.js'
import { buildOrder } from '../../src/sim/strategies.js'
import '../../src/sim/replay.js'
import { cfgFor } from './helpers.js'

const IN_AISLE = new Set([WALKING, STOWING, SHUFFLING])

/** One run recorded at full resolution, plus the per-passenger walk speeds. */
function trace(aid = 'a320neo', strategy = 'random', seed = 3, overrides = {}) {
  const cfg = cfgFor(aid, strategy, seed, overrides)
  const ac = getAircraft(cfg.aircraftId)
  const { result, replay } = run(cfg, ac, true, cfg.dt)
  // Recover walk speed and lane, indexed the way the frame arrays are.
  const pax = generate(new PCG32(cfg.seed, 1), ac, cfg)
  const queue = buildOrder(pax, ac, cfg, new PCG32(cfg.seed, 2))
  const speed = new Array(queue.length).fill(0)
  for (const p of queue) speed[p.boardingIndex] = p.walkSpeed
  const lanes = replay.passengers.map((p) => p.lane)
  return { cfg, ac, result, replay, speed, lanes }
}

describe.each([
  ['a320neo', 'random'],
  ['b737_max8', 'random'],
  ['b777_300er', 'wilma'],
])('%s / %s', (aid, strategy) => {
  it('never lets two people in a lane come closer than one body depth', () => {
    const { replay, lanes } = trace(aid, strategy, 3, { loadFactor: 0.9 })
    const { state: states, x: xs } = replay.frames
    let worst = 1e9
    for (let f = 0; f < states.length; f++) {
      const st = states[f]
      const row = xs[f]
      const byLane = new Map()
      for (let i = 0; i < st.length; i++) {
        if (!IN_AISLE.has(st[i])) continue
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
    // The replay rounds x to 0.1 mm, so allow that much slack and no more.
    expect(worst).toBeGreaterThanOrEqual(BODY_DEPTH - 1e-3)
  })
})

it('never lets anybody move faster than their own walk speed', () => {
  const { replay, speed } = trace('a320neo', 'random')
  const { state: states, x: xs } = replay.frames
  const dt = replay.frameInterval
  for (let f = 1; f < states.length; f++) {
    for (let i = 0; i < states[f].length; i++) {
      if (IN_AISLE.has(states[f][i]) && IN_AISLE.has(states[f - 1][i])) {
        const moved = Math.abs(xs[f][i] - xs[f - 1][i])
        expect(moved).toBeLessThanOrEqual(speed[i] * dt + 1e-3)
      }
    }
  }
})

it('does not let a stowing or shuffling passenger drift', () => {
  const { replay } = trace('a220_300', 'random')
  const { state: states, x: xs } = replay.frames
  for (let f = 1; f < states.length; f++) {
    for (let i = 0; i < states[f].length; i++) {
      const s = states[f][i]
      if ((s === STOWING || s === SHUFFLING) && states[f - 1][i] === s) {
        expect(xs[f][i]).toBeCloseTo(xs[f - 1][i], 6)
      }
    }
  }
})

it('allows no overtaking in a single-file aisle', () => {
  // A cabin aisle is strictly single file. If the relative order of two people
  // in the same lane ever flips, the exclusion model is broken.
  const { replay, lanes } = trace('a320neo', 'random', 3, { loadFactor: 0.95 })
  const { state: states, x: xs } = replay.frames
  const prevOrder = new Map()
  for (let f = 0; f < states.length; f++) {
    const st = states[f]
    const byLane = new Map()
    for (let i = 0; i < st.length; i++) {
      if (!IN_AISLE.has(st[i])) continue
      let list = byLane.get(lanes[i])
      if (list === undefined) byLane.set(lanes[i], (list = []))
      list.push([xs[f][i], i])
    }
    for (const [lane, occ] of byLane) {
      occ.sort((a, b) => a[0] - b[0] || a[1] - b[1])
      const rank = new Map()
      occ.forEach(([, pid], k) => rank.set(pid, k))
      const before = prevOrder.get(lane)
      if (before) {
        for (const [pid, k] of rank) {
          for (const [other, k2] of rank) {
            if (pid >= other) continue
            if (!before.has(pid) || !before.has(other)) continue
            expect(before.get(pid) < before.get(other)).toBe(k < k2)
          }
        }
      }
      prevOrder.set(lane, rank)
    }
  }
})

it('only ever moves a walker toward their own seat', () => {
  const { replay } = trace('b787_9', 'random', 3, { loadFactor: 0.85 })
  const { state: states, x: xs } = replay.frames
  const targets = replay.passengers.map((p) => p.seatX)
  for (let f = 1; f < states.length; f++) {
    for (let i = 0; i < states[f].length; i++) {
      if (states[f][i] === WALKING && states[f - 1][i] === WALKING) {
        const before = Math.abs(targets[i] - xs[f - 1][i])
        const after = Math.abs(targets[i] - xs[f][i])
        expect(after).toBeLessThanOrEqual(before + 1e-6)
      }
    }
  }
})

it('only ever advances the state machine', () => {
  // QUEUED -> WALKING -> STOWING -> SHUFFLING -> SEATED, never backwards.
  const { replay } = trace('e175', 'steffen_perfect')
  const states = replay.frames.state
  for (let f = 1; f < states.length; f++) {
    for (let i = 0; i < states[f].length; i++) {
      expect(states[f][i]).toBeGreaterThanOrEqual(states[f - 1][i])
    }
  }
})

it('skips stowing entirely for zero-bag passengers', () => {
  const r = run(cfgFor('a320neo', 'random', 2, { bagWeights: { 0: 1.0 } })).result
  expect(r.timeBreakdown.stow).toBe(0)
  expect(r.gateChecks).toBe(0)
  expect(r.binSearches).toBe(0)
})

it('closes the aisle outright when stowPassSpeedFactor is 0', () => {
  // Schultz's strict cellular model: with no squeeze, nobody may ever be found
  // on the far side of a stower they arrived behind.
  const { replay, lanes } = trace('a320neo', 'random', 4, {
    loadFactor: 0.9,
    stowPassSpeedFactor: 0,
  })
  const { state: states, x: xs } = replay.frames
  for (let f = 0; f < states.length; f++) {
    const byLane = new Map()
    for (let i = 0; i < states[f].length; i++) {
      if (!IN_AISLE.has(states[f][i])) continue
      let list = byLane.get(lanes[i])
      if (list === undefined) byLane.set(lanes[i], (list = []))
      list.push(xs[f][i])
    }
    for (const occ of byLane.values()) {
      occ.sort((a, b) => a - b)
      for (let k = 1; k < occ.length; k++) {
        expect(occ[k] - occ[k - 1]).toBeGreaterThanOrEqual(BODY_DEPTH - 1e-3)
      }
    }
  }
})
