/** The BatchResult contract the chart grid consumes. */
import { describe, expect, it } from 'vitest'
import { aggregateBatch, readSummaries, summariseStrategy } from '../../src/state/aggregate.js'
import { defaults, engine } from './fixtures.js'

const runsFor = (strategy, n) =>
  Array.from({ length: n }, (_, i) => engine.runSimulation({ ...defaults, strategy, seed: 100 + i }))

describe('aggregateBatch', () => {
  const batch = aggregateBatch({
    byStrategy: { wilma: runsFor('wilma', 6), back_to_front: runsFor('back_to_front', 6) },
    names: engine.STRATEGIES,
    config: { ...defaults, runs: 6 },
    done: 12,
    total: 12,
    complete: true,
  })

  it('emits byStrategy entries in the charts shape', () => {
    const entry = batch.byStrategy.wilma
    expect(entry.runs).toBe(6)
    expect(entry.name).toBe(engine.STRATEGIES.wilma.name)
    expect(entry.totalSeconds.values).toHaveLength(6)
    for (const k of ['mean', 'sd', 'min', 'max', 'p05', 'p50', 'p95']) {
      expect(typeof entry.totalSeconds[k]).toBe('number')
    }
    expect(entry.totalSeconds.p05).toBeLessThanOrEqual(entry.totalSeconds.p95)
  })

  it('averages the derived series', () => {
    const entry = batch.byStrategy.wilma
    expect(Object.keys(entry.meanBreakdown).sort()).toEqual(['blocked', 'shuffle', 'stow', 'walk'])
    expect(Object.keys(entry.meanInterference).sort()).toEqual(['none', 'one', 'sameParty', 'two'])
    expect(entry.seatedCurveMean.length).toBeGreaterThan(4)
    expect(entry.seatedCurveMean[0]).toHaveProperty('p25')
    expect(entry.seatedCurveMean.at(-1).seated).toBeGreaterThan(entry.seatedCurveMean[0].seated)
    expect(entry.congestionMean.length).toBeGreaterThan(10)
    expect(entry.perPassengerPooled.sample.length).toBeGreaterThan(10)
    expect(Object.keys(entry.seatTimeMean).length).toBeGreaterThan(50)
  })

  it('reports convergence one point per replication', () => {
    const c = batch.byStrategy.wilma.convergence
    expect(c).toHaveLength(6)
    expect(c[0].n).toBe(1)
    expect(c.at(-1).ciLow).toBeLessThanOrEqual(c.at(-1).mean)
    expect(c.at(-1).ciHigh).toBeGreaterThanOrEqual(c.at(-1).mean)
  })

  it('carries the meta block', () => {
    expect(batch.meta.runsRequested).toBe(6)
    expect(batch.meta.runsDone).toBe(12)
    expect(batch.meta.complete).toBe(true)
    expect(batch.meta.paxCount).toBeGreaterThan(0)
  })

  it('ranks outside-in ahead of back-to-front', () => {
    expect(batch.byStrategy.wilma.totalSeconds.mean).toBeLessThan(batch.byStrategy.back_to_front.totalSeconds.mean)
  })
})

describe('readSummaries', () => {
  it('reads the nested charts shape', () => {
    const batch = aggregateBatch({
      byStrategy: { wilma: runsFor('wilma', 3) },
      config: defaults,
      done: 3,
      total: 3,
      complete: true,
    })
    const [row] = readSummaries(batch)
    expect(row.key).toBe('wilma')
    expect(row.n).toBe(3)
    expect(row.mean).toBeGreaterThan(0)
  })

  it('also reads a flat shape, in case the worker sends one', () => {
    const rows = readSummaries({ strategies: { wilma: { n: 4, mean: 900, sd: 40, p05: 850, p50: 900, p95: 960, min: 840, max: 970 } } })
    expect(rows).toEqual([
      expect.objectContaining({ key: 'wilma', n: 4, mean: 900, sd: 40 }),
    ])
    // t(n-1), not a flat 1.96: at n=4 the difference is 62%, and the chart
    // layer has always used the t form.
    expect(rows[0].ci95).toBeCloseTo(3.182 * (40 / 2), 5)
  })

  it('ignores strategies with no completed runs', () => {
    expect(readSummaries({ byStrategy: { wilma: { runs: 0, totalSeconds: { mean: 0 } } } })).toEqual([])
    expect(readSummaries(null)).toEqual([])
  })
})

describe('summariseStrategy', () => {
  it('handles a single run without dividing by zero', () => {
    const entry = summariseStrategy('wilma', runsFor('wilma', 1), 'WilMA')
    expect(entry.totalSeconds.sd).toBe(0)
    expect(entry.totalSeconds.ci95).toBe(0)
    expect(entry.convergence).toHaveLength(1)
  })
})
