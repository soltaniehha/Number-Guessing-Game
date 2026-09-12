/**
 * The Monte Carlo worker.
 *
 * The load-bearing test is the first one: the worker folds each run into an
 * accumulator and drops it, rather than holding 1400 complete RunResults, so
 * this asserts that what it produces is what `state/aggregate.js` would have
 * produced from the full set. If that ever stops being true, the charts start
 * lying and nothing else would notice.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { aggregateBatch } from '../../src/state/aggregate.js'
import { STRATEGIES, runSimulation } from '../../src/sim/index.js'

const posted = []
globalThis.postMessage = (msg) => posted.push(msg)

const { StrategyAccumulator, assemble, planJobs, handleMessage } = await import(
  '../../src/sim/batchWorker.js'
)

const CONFIG = {
  aircraftId: 'e175',
  strategy: 'random',
  seed: 4242,
  loadFactor: 0.7,
  runs: 4,
}

const runsFor = (key, n, seed = CONFIG.seed) =>
  Array.from({ length: n }, (_, i) => runSimulation({ ...CONFIG, strategy: key, seed: seed + i }))

beforeEach(() => {
  posted.length = 0
})

describe('StrategyAccumulator', () => {
  it('reproduces aggregateBatch exactly, from folded runs', () => {
    const keys = ['random', 'wilma']
    const byStrategy = Object.fromEntries(keys.map((k) => [k, runsFor(k, 5)]))

    const expected = aggregateBatch({
      byStrategy,
      names: STRATEGIES,
      config: CONFIG,
      done: 10,
      total: 10,
      complete: true,
    })

    const accs = new Map(keys.map((k) => [k, new StrategyAccumulator(k)]))
    for (const k of keys) for (const r of byStrategy[k]) accs.get(k).add(r)
    const got = assemble(accs, STRATEGIES, CONFIG, 10, 10, true, null)

    for (const k of keys) {
      const a = expected.byStrategy[k]
      const b = got.byStrategy[k]
      expect(b.totalSeconds).toEqual(a.totalSeconds)
      expect(b.meanBreakdown).toEqual(a.meanBreakdown)
      expect(b.meanInterference).toEqual(a.meanInterference)
      expect(b.meanGateChecks).toEqual(a.meanGateChecks)
      expect(b.meanBinSearches).toEqual(a.meanBinSearches)
      expect(b.seatedCurveMean).toEqual(a.seatedCurveMean)
      expect(b.congestionMean).toEqual(a.congestionMean)
      expect(b.perPassengerPooled).toEqual(a.perPassengerPooled)
      expect(b.seatTimeMean).toEqual(a.seatTimeMean)
      expect(b.convergence).toEqual(a.convergence)
      expect(b.runs).toBe(a.runs)
    }
    expect(got.meta).toEqual(expected.meta)
  })

  it('truncates the congestion accumulator to the shortest run, as aggregate.js does', () => {
    // Runs of different lengths produce different numbers of time buckets;
    // the mean is taken over the columns every run has.
    const runs = [...runsFor('random', 2), ...runsFor('back_to_front', 2, 99)]
    const acc = new StrategyAccumulator('mixed')
    for (const r of runs) acc.add(r)
    const expected = aggregateBatch({
      byStrategy: { mixed: runs },
      names: {},
      config: CONFIG,
      done: 4,
      total: 4,
      complete: true,
    }).byStrategy.mixed
    expect(acc.congestionMean()).toEqual(expected.congestionMean)
    const cols = new Set(runs.map((r) => r.congestion[0].length))
    expect(cols.size).toBeGreaterThan(1) // the test is actually exercising it
  })

  it('keeps at most two whole runs as the documented sample', () => {
    const acc = new StrategyAccumulator('random')
    for (const r of runsFor('random', 5)) acc.add(r)
    expect(acc.sample).toHaveLength(2)
    expect(acc.sample[0].perPassenger.length).toBeGreaterThan(0)
    // ...and does not retain per-passenger detail for the rest.
    expect(acc.lean.every((r) => r.perPassenger.length === 0)).toBe(true)
  })
})

describe('planJobs', () => {
  it('runs every strategy over the SAME seed sequence', () => {
    const jobs = planJobs({ seed: 100 }, ['random', 'wilma'], 3, null)
    expect(jobs).toHaveLength(6)
    expect(jobs.filter((j) => j.key === 'random').map((j) => j.seed)).toEqual([100, 101, 102])
    expect(jobs.filter((j) => j.key === 'wilma').map((j) => j.seed)).toEqual([100, 101, 102])
  })

  it('appends sweep jobs only when sweep points are asked for', () => {
    expect(planJobs({ seed: 0 }, ['random'], 2, null)).toHaveLength(2)
    const jobs = planJobs({ seed: 0 }, ['random'], 2, {
      param: 'loadFactor',
      values: [0.5, 1.0],
      runs: 3,
    })
    const sweep = jobs.filter((j) => j.kind === 'sweep')
    expect(sweep).toHaveLength(6)
    expect(sweep.map((j) => j.value)).toEqual([0.5, 0.5, 0.5, 1.0, 1.0, 1.0])
    expect(sweep.map((j) => j.li)).toEqual([0, 0, 0, 1, 1, 1])
  })
})

describe('the worker protocol', () => {
  const settle = async () => {
    for (let i = 0; i < 400 && !posted.some((m) => m.type === 'done' || m.type === 'error'); i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
  }

  it('emits progress then done, and the result carries every field the charts read', async () => {
    handleMessage({
      data: { type: 'start', config: CONFIG, strategies: ['random', 'wilma'], runs: 6 },
    })
    await settle()

    const done = posted.find((m) => m.type === 'done')
    expect(done).toBeDefined()
    expect(done.done).toBe(12)
    expect(done.total).toBe(12)
    for (const m of posted.filter((x) => x.type === 'progress')) {
      expect(m.partial).toBeDefined()
      expect(m.total).toBe(12)
      expect(m.done).toBeGreaterThan(0)
      expect(m.done).toBeLessThan(12)
    }

    const batch = done.result
    expect(Object.keys(batch.byStrategy).sort()).toEqual(['random', 'wilma'])
    expect(batch.strategies).toBe(batch.byStrategy)
    expect(batch.complete).toBe(true)
    expect(batch.meta).toMatchObject({
      aircraftId: 'e175',
      loadFactor: 0.7,
      runsRequested: 4,
      runsDone: 12,
      complete: true,
    })
    expect(batch.meta.paxCount).toBeGreaterThan(0)
    expect(batch.meta.seatCount).toBe(76)

    const entry = batch.byStrategy.random
    expect(entry.runs).toBe(6)
    expect(entry.name).toBe(STRATEGIES.random.name)
    for (const k of ['mean', 'sd', 'ci95', 'min', 'max', 'p05', 'p50', 'p95', 'values']) {
      expect(entry.totalSeconds[k]).toBeDefined()
    }
    expect(entry.totalSeconds.values).toHaveLength(6)
    expect(Object.keys(entry.meanBreakdown).sort()).toEqual(['blocked', 'shuffle', 'stow', 'walk'])
    expect(Object.keys(entry.meanInterference).sort()).toEqual(['none', 'one', 'sameParty', 'two'])
    expect(entry.seatedCurveMean[0]).toHaveProperty('p25')
    expect(entry.seatedCurveMean[0]).toHaveProperty('p75')
    expect(Array.isArray(entry.congestionMean)).toBe(true)
    expect(entry.perPassengerPooled.sample.length).toBeGreaterThan(0)
    expect(Object.keys(entry.seatTimeMean).length).toBeGreaterThan(0)
    expect(entry.convergence).toHaveLength(6)
    expect(entry.convergence[5]).toMatchObject({ n: 6 })
  })

  it('emits a sweep the LoadFactorSweep chart can plot', async () => {
    handleMessage({
      data: {
        type: 'start',
        config: CONFIG,
        strategies: ['random', 'wilma'],
        runs: 2,
        sweep: { loadFactors: [0.4, 0.7, 1.0], runs: 2 },
      },
    })
    await settle()

    const { sweep } = posted.find((m) => m.type === 'done').result
    expect(sweep.loadFactors).toEqual([0.4, 0.7, 1.0])
    for (const key of ['random', 'wilma']) {
      expect(sweep.byStrategy[key]).toHaveLength(3)
      expect(sweep.byStrategy[key].every((v) => Number.isFinite(v))).toBe(true)
      // Boarding gets slower as the aircraft fills.
      expect(sweep.byStrategy[key][2]).toBeGreaterThan(sweep.byStrategy[key][0])
    }
  })

  it('stops promptly and emits nothing further', async () => {
    handleMessage({
      data: { type: 'start', config: CONFIG, strategies: ['random'], runs: 4000 },
    })
    await new Promise((r) => setTimeout(r, 60))
    handleMessage({ data: { type: 'stop' } })
    await new Promise((r) => setTimeout(r, 120))
    const after = posted.length
    await new Promise((r) => setTimeout(r, 120))
    expect(posted.length).toBe(after)
    expect(posted.some((m) => m.type === 'done')).toBe(false)
  })

  it('reports a bad config as an error message rather than throwing', async () => {
    handleMessage({
      data: {
        type: 'start',
        config: { ...CONFIG, aircraftId: 'concorde' },
        strategies: ['random'],
        runs: 1,
      },
    })
    await settle()
    const err = posted.find((m) => m.type === 'error')
    expect(err).toBeDefined()
    expect(err.message).toMatch(/concorde/)
  })
})
