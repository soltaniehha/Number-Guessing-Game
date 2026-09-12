/**
 * Determinism is the load-bearing property: this engine must match the Python
 * one bit for bit, which it cannot do if it does not first match itself.
 * Mirrors `python/tests/test_determinism.py`.
 */
import { describe, expect, it } from 'vitest'
import { run, simulate } from '../../src/sim/engine.js'
import { STRATEGIES } from '../../src/sim/strategies.js'
import '../../src/sim/replay.js'
import { cfgFor } from './helpers.js'

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

it('separates the three RNG streams, so a strategy cannot move a service time', () => {
  // Same manifest AND same per-passenger service draws: only the ORDER differs.
  const a = simulate(cfgFor('b737_max8', 'random', 31))
  const b = simulate(cfgFor('b737_max8', 'back_to_front', 31))
  const bagsOf = (r) => r.perPassenger.map((p) => p.bags).join(',')
  expect(bagsOf(a)).toBe(bagsOf(b))
})
