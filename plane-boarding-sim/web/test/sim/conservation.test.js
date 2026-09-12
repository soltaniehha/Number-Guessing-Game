/**
 * Nothing may be created or destroyed: every passenger boards, exactly once,
 * into a seat that exists. Mirrors `python/tests/test_conservation.py`.
 */
import { describe, expect, it } from 'vitest'
import { getAircraft } from '../../src/sim/aircraft.js'
import { SEATED } from '../../src/sim/config.js'
import { run, simulate } from '../../src/sim/engine.js'
import { pyRoundInt } from '../../src/sim/pyutil.js'
import { STRATEGIES } from '../../src/sim/strategies.js'
import '../../src/sim/replay.js'
import { ALL_AIRCRAFT, cfgFor } from './helpers.js'

describe.each(ALL_AIRCRAFT)('%s', (aid) => {
  it('boards round(loadFactor * seats) passengers, banker-rounded', () => {
    const ac = getAircraft(aid)
    for (const lf of [0.0, 0.31, 0.5, 0.855, 1.0]) {
      const r = simulate(cfgFor(aid, 'random', 3, { loadFactor: lf }))
      expect(r.paxCount).toBe(pyRoundInt(lf * ac.seatCount))
    }
  })

  it('ends with everybody seated in a unique, existing seat', () => {
    const ac = getAircraft(aid)
    const valid = new Set(ac.seats.map((s) => s.id))
    const r = simulate(cfgFor(aid, 'random', 5))
    expect(r.completed).toBe(true)
    const seats = r.perPassenger.map((p) => p.seat)
    expect(new Set(seats).size).toBe(seats.length)
    expect(seats.every((s) => valid.has(s))).toBe(true)
    expect(r.perPassenger.every((p) => p.sitTime >= p.enterTime)).toBe(true)
    expect(r.perPassenger.every((p) => p.sitTime <= r.totalSeconds + 1e-9)).toBe(true)
  })

  it('counts every passenger exactly once in the interference tally', () => {
    const r = simulate(cfgFor(aid, 'random', 6))
    const total = Object.values(r.interference).reduce((a, b) => a + b, 0)
    expect(total).toBe(r.paxCount)
  })
})

describe.each(Object.keys(STRATEGIES).sort())('%s', (strategy) => {
  it('conserves passengers under both open and assigned seating', () => {
    const ac = getAircraft('a220_300')
    const r = simulate(cfgFor('a220_300', strategy, 8, { loadFactor: 0.75 }))
    expect(r.paxCount).toBe(pyRoundInt(0.75 * ac.seatCount))
    expect(r.perPassenger.map((p) => p.id)).toEqual([...Array(r.paxCount).keys()])
    expect(new Set(r.perPassenger.map((p) => p.seat)).size).toBe(r.paxCount)
  })
})

it('has everybody seated in the final replay frame', () => {
  const { replay } = run(cfgFor('a320neo', 'wilma', 2), null, true, 0.25)
  const last = replay.frames.state[replay.frames.state.length - 1]
  expect(new Set(last)).toEqual(new Set([SEATED]))
})

it('reconciles the time breakdown with the per-passenger records', () => {
  const r = simulate(cfgFor('b737_max8', 'random', 6))
  for (const [key, attr] of [
    ['walk', 'walkTime'],
    ['stow', 'stowTime'],
    ['shuffle', 'shuffleTime'],
    ['blocked', 'blockedTime'],
  ]) {
    const total = r.perPassenger.reduce((a, p) => a + p[attr], 0)
    expect(r.timeBreakdown[key]).toBeCloseTo(total, 3)
  }
})

it('never gate-checks more bags than a passenger carried', () => {
  const r = simulate(cfgFor('e175', 'random', 11))
  for (const p of r.perPassenger) {
    expect(p.gateChecked).toBeGreaterThanOrEqual(0)
    expect(p.gateChecked).toBeLessThanOrEqual(p.bags)
  }
  expect(r.gateChecks).toBe(r.perPassenger.reduce((a, p) => a + p.gateChecked, 0))
})

it('produces a well-formed zero-length result for an empty cabin', () => {
  const r = simulate(cfgFor('a220_300', 'random', 12, { loadFactor: 0 }))
  expect(r.paxCount).toBe(0)
  expect(r.perPassenger).toEqual([])
  expect(r.completed).toBe(true)
  expect(r.throughputPaxPerMin).toBe(0)
  expect(Number.isFinite(r.totalSeconds)).toBe(true)
})
