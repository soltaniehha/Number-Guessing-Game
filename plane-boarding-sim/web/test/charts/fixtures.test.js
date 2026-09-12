import { describe, it, expect } from 'vitest'
import {
  makeBatch,
  makePartialBatch,
  makeStreamingBatch,
  makeEmptyBatch,
  makeRun,
  DEFAULT_STRATEGY_KEYS,
} from '../../src/charts/__fixtures__/makeBatch.js'

describe('makeBatch fixtures', () => {
  it('is deterministic for a given seed', () => {
    expect(JSON.stringify(makeBatch())).toBe(JSON.stringify(makeBatch()))
    expect(JSON.stringify(makeBatch({ seed: 1 }))).not.toBe(JSON.stringify(makeBatch({ seed: 2 })))
  })

  it('produces the six default strategies with the ENGINE_SPEC §7 shape', () => {
    const batch = makeBatch({ runs: 25 })
    expect(Object.keys(batch.byStrategy)).toEqual(DEFAULT_STRATEGY_KEYS)
    for (const entry of Object.values(batch.byStrategy)) {
      expect(entry.runs).toBe(25)
      expect(entry.name).toBeTruthy()
      expect(entry.totalSeconds.values).toHaveLength(25)
      expect(entry.totalSeconds.min).toBeLessThanOrEqual(entry.totalSeconds.mean)
      expect(entry.totalSeconds.max).toBeGreaterThanOrEqual(entry.totalSeconds.mean)
      expect(entry.totalSeconds.p05).toBeLessThanOrEqual(entry.totalSeconds.p95)
      expect(Object.keys(entry.meanBreakdown).sort()).toEqual(['blocked', 'shuffle', 'stow', 'walk'])
      expect(Object.keys(entry.meanInterference).sort()).toEqual(['none', 'one', 'sameParty', 'two'])
      expect(entry.seatedCurveMean.length).toBeGreaterThan(4)
      expect(entry.congestionMean.length).toBeGreaterThan(4)
      expect(Object.keys(entry.seatTimeMean).length).toBe(180)
      expect(entry.convergence).toHaveLength(25)
      expect(entry.perPassengerPooled.p50).toBeGreaterThan(0)
    }
  })

  it('has a monotone seated curve that reaches the passenger count', () => {
    const batch = makeBatch({ runs: 5 })
    const curve = batch.byStrategy.wilma.seatedCurveMean
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].seated).toBeGreaterThanOrEqual(curve[i - 1].seated)
      expect(curve[i].p25).toBeLessThanOrEqual(curve[i].seated)
      expect(curve[i].p75).toBeGreaterThanOrEqual(curve[i].seated)
    }
    expect(curve[curve.length - 1].seated).toBe(batch.meta.paxCount)
  })

  it('ranks the known-bad strategies slower than the known-good ones', () => {
    const batch = makeBatch({ runs: 50 })
    expect(batch.byStrategy.steffen_modified.totalSeconds.mean)
      .toBeLessThan(batch.byStrategy.back_to_front.totalSeconds.mean)
    expect(batch.byStrategy.wilma.meanInterference.one)
      .toBeLessThan(batch.byStrategy.random.meanInterference.one)
  })

  it('includes a sweep that grows with load factor', () => {
    const batch = makeBatch({ runs: 5 })
    expect(batch.sweep.loadFactors).toEqual([0.5, 0.6, 0.7, 0.8, 0.9, 1])
    for (const key of DEFAULT_STRATEGY_KEYS) {
      const series = batch.sweep.byStrategy[key]
      expect(series).toHaveLength(6)
      for (let i = 1; i < series.length; i++) expect(series[i]).toBeGreaterThan(series[i - 1])
    }
  })

  it('omits the sweep on request', () => {
    expect(makeBatch({ runs: 2, sweep: false }).sweep).toBeUndefined()
  })
})

describe('partial and streaming fixtures', () => {
  it('a one-run partial batch has a zero standard deviation and no sweep', () => {
    const batch = makePartialBatch()
    expect(batch.meta.complete).toBe(false)
    expect(batch.sweep).toBeUndefined()
    for (const entry of Object.values(batch.byStrategy)) {
      expect(entry.runs).toBe(1)
      expect(entry.totalSeconds.sd).toBe(0)
      expect(entry.totalSeconds.values).toHaveLength(1)
      expect(entry.convergence).toHaveLength(1)
    }
  })

  it('a streaming batch has uneven run counts', () => {
    const counts = Object.values(makeStreamingBatch().byStrategy).map((e) => e.runs)
    expect(new Set(counts).size).toBeGreaterThan(1)
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(1)
  })

  it('an empty batch has no strategies', () => {
    const batch = makeEmptyBatch()
    expect(Object.keys(batch.byStrategy)).toHaveLength(0)
    expect(batch.meta.runsDone).toBe(0)
  })
})

describe('makeRun', () => {
  it('produces a RunResult-shaped object', () => {
    const run = makeRun()
    expect(run.totalSeconds).toBeGreaterThan(0)
    expect(run.paxCount).toBeGreaterThan(0)
    expect(run.seatedCurve[0]).toHaveProperty('t')
    expect(run.timeBreakdown).toHaveProperty('blocked')
    expect(run.p50TimeToSeat).toBeLessThanOrEqual(run.p90TimeToSeat)
    expect(run.throughputPaxPerMin).toBeGreaterThan(0)
  })

  it('is deterministic', () => {
    expect(JSON.stringify(makeRun({ seed: 9 }))).toBe(JSON.stringify(makeRun({ seed: 9 })))
  })
})
