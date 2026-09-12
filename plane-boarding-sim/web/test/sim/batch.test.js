/**
 * The Monte Carlo driver and the paired comparison.
 * Mirrors `python/plane_boarding/batch.py` and `metrics.PairedDifference`.
 */
import { describe, expect, it } from 'vitest'
import { BatchResult, compareStrategies, loadSweep, runBatch } from '../../src/sim/batch.js'
import { Aggregate, PairedDifference, percentile } from '../../src/sim/metrics.js'
import { cfgFor } from './helpers.js'

const cfg = cfgFor('e175', 'random', 1, { loadFactor: 0.8 })

describe('percentile', () => {
  it('interpolates linearly on an already-sorted sequence', () => {
    expect(percentile([], 0.5)).toBe(0)
    expect(percentile([7], 0.9)).toBe(7)
    expect(percentile([0, 10], 0.5)).toBe(5)
    expect(percentile([0, 10, 20, 30], 0.5)).toBe(15)
    expect(percentile([0, 10, 20, 30], 0.05)).toBeCloseTo(1.5, 12)
    expect(percentile([0, 10, 20, 30], 1.0)).toBe(30)
  })
})

describe('Aggregate', () => {
  it('uses the sample standard deviation and keeps values in order', () => {
    const a = new Aggregate([2, 4, 4, 4, 5, 5, 7, 9])
    expect(a.n).toBe(8)
    expect(a.mean).toBe(5)
    expect(a.sd).toBeCloseTo(Math.sqrt(32 / 7), 12) // n-1 denominator
    expect(a.min).toBe(2)
    expect(a.max).toBe(9)
    expect(a.values).toEqual([2, 4, 4, 4, 5, 5, 7, 9])
    expect(a.ci95).toBeCloseTo((1.96 * a.sd) / Math.sqrt(8), 12)
  })

  it('degrades to zeroes on an empty or single sample', () => {
    const e = new Aggregate([])
    expect([e.n, e.mean, e.sd, e.ci95]).toEqual([0, 0, 0, 0])
    const one = new Aggregate([42])
    expect([one.mean, one.sd, one.ci95, one.p05, one.p95]).toEqual([42, 0, 0, 42, 42])
  })
})

describe('runBatch', () => {
  it('walks the seed sequence and reports progress', () => {
    const seen = []
    const b = runBatch(cfg, 5, 100, (i, total) => seen.push([i, total]))
    expect(b.runs).toBe(5)
    expect(b.seeds).toEqual([100, 101, 102, 103, 104])
    expect(b.totalSeconds.values).toHaveLength(5)
    expect(seen).toEqual([[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]])
    expect(b.mean).toBe(b.totalSeconds.mean)
  })

  it('averages the interference counts over the replications', () => {
    const b = runBatch(cfg, 4, 1)
    const total = Object.values(b.interference).reduce((a, x) => a + x, 0)
    expect(total).toBeCloseTo(b.paxCount, 6)
  })

  it('refuses a run count below one', () => {
    expect(() => runBatch(cfg, 0)).toThrow(/runs must be >= 1/)
  })
})

describe('compareStrategies', () => {
  // A 3-3 cabin, where outside-in has interference to eliminate and the paired
  // test therefore has something to find. (On the E175's 2-2 cabin at eight
  // replications it correctly reports no separation.)
  const wide = cfgFor('a320neo', 'random', 1, { loadFactor: 0.92 })
  const out = compareStrategies(wide, ['random', 'wilma', 'steffen_perfect'], 12)

  it('ranks fastest first', () => {
    const means = out.map((b) => b.mean)
    expect(means).toEqual([...means].sort((a, b) => a - b))
    expect(out[0].strategy).not.toBe('random')
  })

  it('gives every strategy the same seed sequence, so the pairing is real', () => {
    for (const b of out) expect(b.seeds).toEqual(out[0].seeds)
  })

  it('attaches a paired difference against the random baseline', () => {
    for (const b of out) {
      expect(b.pairedVsBaseline).toBeInstanceOf(PairedDifference)
      expect(b.pairedVsBaseline.baseline).toBe('random')
      expect(b.pairedVsBaseline.n).toBe(12)
    }
    const baseline = out.find((b) => b.strategy === 'random')
    expect(baseline.pairedVsBaseline.mean).toBe(0)
    expect(baseline.pairedVsBaseline.significant).toBe(false)
    // Outside-in really is faster than random, and the paired test says so.
    const wilma = out.find((b) => b.strategy === 'wilma')
    expect(wilma.pairedVsBaseline.mean).toBeLessThan(0)
    expect(wilma.pairedVsBaseline.hi).toBeLessThan(0)
    expect(wilma.pairedVsBaseline.significant).toBe(true)
    expect(wilma.pairedVsBaseline.meanRatio).toBeLessThan(1)
  })

  it('serialises to the documented dict', () => {
    const d = out[0].toDict(true)
    expect(Object.keys(d).sort()).toEqual([
      'aircraftId',
      'doorSequencing',
      'gateChecks',
      'interference',
      'loadFactor',
      'name',
      'p90TimeToSeat',
      'pairedVsBaseline',
      'paxCount',
      'runs',
      'strategy',
      'throughputPaxPerMin',
      'totalSeconds',
    ])
    expect(d.totalSeconds.values).toHaveLength(12)
  })

  it('rejects an unknown strategy', () => {
    expect(() => compareStrategies(wide, ['random', 'teleport'], 2)).toThrow(/unknown strategies/)
  })
})

describe('PairedDifference', () => {
  it('refuses to pair batches of different lengths', () => {
    expect(() => new PairedDifference([1, 2, 3], [1, 2])).toThrow(/cannot pair/)
  })

  it('refuses to pair batches run on different seeds', () => {
    const a = runBatch(cfg.replace({ strategy: 'random' }), 3, 10)
    const b = runBatch(cfg.replace({ strategy: 'wilma' }), 3, 500)
    expect(() => a.pairedAgainst(b)).toThrow(/seed sequences differ/)
  })

  it('calls a difference significant exactly when the interval excludes zero', () => {
    const tight = new PairedDifference([10, 10, 10, 10], [12, 12, 12, 12])
    expect(tight.mean).toBe(-2)
    expect(tight.significant).toBe(true)
    const noisy = new PairedDifference([10, 30, 10, 30], [20, 20, 20, 20])
    expect(noisy.mean).toBe(0)
    expect(noisy.significant).toBe(false)
  })
})

describe('loadSweep', () => {
  it('runs each strategy across each load factor', () => {
    const out = loadSweep(cfg, [0.5, 1.0], ['random', 'wilma'], 3, 7)
    expect(Object.keys(out).sort()).toEqual(['random', 'wilma'])
    for (const key of ['random', 'wilma']) {
      expect(out[key]).toHaveLength(2)
      for (const b of out[key]) expect(b).toBeInstanceOf(BatchResult)
      expect(out[key][0].loadFactor).toBe(0.5)
      expect(out[key][1].loadFactor).toBe(1.0)
      // A fuller aeroplane takes longer to board.
      expect(out[key][1].mean).toBeGreaterThan(out[key][0].mean)
    }
  })
})
