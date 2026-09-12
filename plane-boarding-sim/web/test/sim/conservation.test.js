/**
 * Nothing may be created or destroyed: every passenger boards, exactly once,
 * into a seat that exists. Mirrors `python/tests/test_conservation.py`.
 */
import { describe, expect, it } from 'vitest'
import { getAircraft } from '../../src/sim/aircraft.js'
import { SEATED } from '../../src/sim/config.js'
import { run, simulate } from '../../src/sim/engine.js'
import { percentile } from '../../src/sim/metrics.js'
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


// ---------------------------------------------------------------------------
// The reported wait statistics (ENGINE_SPEC 7)
// ---------------------------------------------------------------------------

describe.each(ALL_AIRCRAFT)('%s', (aid) => {
  /**
   * These were all computed off `sitTime`, so every one of them silently
   * reported "seconds since boarding started" -- which made `maxTimeToSeat`
   * identically `totalSeconds` on any completed run, and made the passenger
   * wait chart show the wrong quantity entirely.
   *
   * There are two honest questions here and the field names now say which is
   * which: `*AisleSeconds` is the time from stepping through the door to
   * sitting down, and `*BoardingWaitSeconds` adds the jetbridge queue in front.
   */
  it('reports time-to-seat statistics that measure what they are named', () => {
    const r = simulate(cfgFor(aid, 'random', 3))
    const aisle = r.perPassenger.map((p) => p.timeInAisle).sort((a, b) => a - b)
    const sits = r.perPassenger.map((p) => p.sitTime).sort((a, b) => a - b)

    expect(r.maxAisleSeconds).toBeCloseTo(aisle[aisle.length - 1], 6)
    expect(r.p50AisleSeconds).toBeCloseTo(percentile(aisle, 0.5), 6)
    expect(r.p90AisleSeconds).toBeCloseTo(percentile(aisle, 0.9), 6)

    expect(r.p50BoardingWaitSeconds).toBeCloseTo(percentile(sits, 0.5), 6)
    expect(r.p90BoardingWaitSeconds).toBeCloseTo(percentile(sits, 0.9), 6)

    // The deprecated aliases now carry the aisle quantity.
    expect(r.p50TimeToSeat).toBe(r.p50AisleSeconds)
    expect(r.p90TimeToSeat).toBe(r.p90AisleSeconds)
    expect(r.maxTimeToSeat).toBe(r.maxAisleSeconds)
  })
})

/**
 * Why `maxTimeToSeat` was worth fixing rather than deleting. As a maximum over
 * `sitTime` it was definitionally `totalSeconds` for any completed run and
 * carried no information. As a maximum over time-in-aisle it is the worst
 * individual experience, and a small fraction of the run length.
 *
 * There is deliberately no `maxBoardingWaitSeconds`: the last passenger to sit
 * down sits at `totalSeconds` by construction, so that maximum really is
 * redundant and is not reported.
 */
it('reports a worst aisle wait that is a statistic, not the run length', () => {
  const r = simulate(cfgFor('a320neo', 'random', 1, { doors: ['1L'] }))
  expect(r.completed).toBe(true)
  expect(r.maxAisleSeconds).toBeLessThan(r.totalSeconds * 0.6)
  expect(Math.max(...r.perPassenger.map((p) => p.sitTime))).toBeCloseTo(r.totalSeconds, 6)
  expect(r.maxBoardingWaitSeconds).toBeUndefined()
})

/**
 * On a run that hits MAX_SIM_SECONDS the closing sample used to report
 * `paxCount - seated`, which counts everyone still queued on the jetbridge as
 * though they were standing in the aisle. It is the real lane occupancy now, so
 * the aisle-occupancy chart no longer ends on a spike that never happened.
 */
it('counts the aisle, not the jetbridge, in the final occupancy sample', () => {
  const done = simulate(cfgFor('a320neo', 'random', 1, { doors: ['1L'] }))
  expect(done.completed).toBe(true)
  expect(done.aisleOccupancy[done.aisleOccupancy.length - 1].count).toBe(0)

  const stuck = simulate(
    cfgFor('b777_300er', 'random', 1, { loadFactor: 1.0, doors: ['1L'], doorArrivalMean: 60.0 }),
  )
  expect(stuck.completed).toBe(false)
  const stillQueued = stuck.paxCount - stuck.seatedCurve[stuck.seatedCurve.length - 1].seated
  const finalInAisle = stuck.aisleOccupancy[stuck.aisleOccupancy.length - 1].count
  expect(finalInAisle).toBeLessThan(stillQueued)
  expect(Math.abs(finalInAisle - stuck.aisleOccupancy[stuck.aisleOccupancy.length - 2].count)).toBeLessThanOrEqual(5)
})
