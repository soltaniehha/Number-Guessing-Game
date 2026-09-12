/**
 * The load-factor sweep (chart 7): the option, the arithmetic shown for it,
 * and the message that actually asks the worker for one.
 *
 * The bug this covers: the shell never sent `sweep`, so chart 7 could not draw
 * anything however long you ran the batch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SWEEP_LOAD_FACTORS,
  autoSweepRuns,
  describeBatchCost,
  describeSweepCost,
  runCounts,
  sanitizeLoadFactors,
  sweepRunsFor,
  sweepSpecFor,
} from '../../src/state/sweep.js'
import { makeConfigReducer, sanitizeConfig } from '../../src/state/configReducer.js'
import { CONTROLS, presentControls } from '../../src/app/controlSchema.js'
import { planJobs } from '../../src/sim/batchWorker.js'
import { defaults, engine, a320 } from './fixtures.js'

/* The worker is constructed through the bridge, so a fake one slots in here. */
let posted = []
let fakeWorker = null
vi.mock('../../src/lib/engineBridge.js', () => ({
  createBatchWorker: () => globalThis.__fakeWorker ?? null,
}))
const { startBatch } = await import('../../src/state/batchRunner.js')

beforeEach(() => {
  posted = []
  fakeWorker = {
    postMessage: (msg) => posted.push(msg),
    terminate: () => {},
    onmessage: null,
    onerror: null,
  }
  globalThis.__fakeWorker = fakeWorker
})

describe('sweep options', () => {
  it('is off by default, with the spec\'s six load factors ready to go', () => {
    expect(defaults.sweepEnabled).toBe(false)
    expect(defaults.sweepLoadFactors).toEqual([0.5, 0.6, 0.7, 0.8, 0.9, 1])
    expect(defaults.sweepRuns).toBe(null)
    expect(sweepSpecFor(defaults, 'analytics')).toBe(null)
  })

  it('is only offered where there are charts to receive it', () => {
    const keys = (mode) => presentControls('scenario', engine.DEFAULTS, mode).map((c) => c.key)
    expect(keys('analytics')).toContain('sweepEnabled')
    expect(keys('compare')).toContain('sweepLoadFactors')
    expect(keys('cabin')).not.toContain('sweepEnabled')
    expect(keys('cabin')).not.toContain('sweepLoadFactors')
    expect(keys('cabin')).not.toContain('sweepRuns')
    expect(sweepSpecFor({ ...defaults, sweepEnabled: true }, 'cabin')).toBe(null)
  })

  it('derives sweep replications the way the worker documents, and lets them be overridden', () => {
    expect(autoSweepRuns(200)).toBe(12) // round(50) clamped to 12
    expect(autoSweepRuns(20)).toBe(5)
    expect(autoSweepRuns(10)).toBe(3) // floor of 3
    expect(sweepRunsFor({ runs: 200, sweepRuns: null })).toBe(12)
    expect(sweepRunsFor({ runs: 200, sweepRuns: 4 })).toBe(4)
  })

  it('agrees with the worker: the spec it builds plans exactly the jobs it promised', () => {
    const config = { ...defaults, sweepEnabled: true, runs: 40 }
    const strategies = ['wilma', 'random', 'back_to_front']
    const spec = sweepSpecFor(config, 'compare')
    const counts = runCounts({ strategies: strategies.length, runs: config.runs, sweep: spec })
    const jobs = planJobs(config, strategies, config.runs, spec)
    expect(jobs).toHaveLength(counts.total)
    expect(jobs.filter((j) => j.kind === 'sweep')).toHaveLength(counts.sweep)
    // ...and with no explicit runs the worker's own default is the same number.
    const implicit = planJobs(config, strategies, config.runs, { loadFactors: spec.loadFactors })
    expect(implicit).toHaveLength(jobs.length)
  })

  it('spells out the cost before anything starts', () => {
    const config = { ...defaults, sweepEnabled: true, runs: 48 }
    const counts = runCounts({ strategies: 3, runs: config.runs, sweep: sweepSpecFor(config, 'compare') })
    expect(counts.points).toBe(6)
    expect(counts.sweepRuns).toBe(12)
    expect(counts.main).toBe(144)
    expect(counts.sweep).toBe(216)
    expect(counts.total).toBe(360)
    expect(describeSweepCost(counts)).toBe('6 load factors × 3 strategies × 12 replications = 216 runs')
    expect(describeBatchCost(counts)).toBe('3 strategies × 48 replications = 144 runs')
  })

  it('gets the singulars right', () => {
    const counts = runCounts({ strategies: 1, runs: 10, sweep: { loadFactors: [0.9], runs: 1 } })
    expect(describeSweepCost(counts)).toBe('1 load factor × 1 strategy × 1 replication = 1 run')
  })

  it('says where an automatic value comes from, per control', () => {
    const nullable = CONTROLS.filter((c) => c.kind === 'nullable-slider')
    expect(nullable.length).toBeGreaterThan(1)
    for (const c of nullable) {
      expect(typeof c.autoSpoken, `${c.key} has no spoken source for its auto value`).toBe('string')
      expect(typeof c.autoLabel).toBe('string')
    }
    expect(CONTROLS.find((c) => c.key === 'sweepRuns').autoSpoken).toBe('derived from the replication count')
  })

  it('gives every new control a label and a plain-English explanation', () => {
    for (const key of ['sweepEnabled', 'sweepLoadFactors', 'sweepRuns']) {
      const c = CONTROLS.find((x) => x.key === key)
      expect(c.label.length).toBeGreaterThan(3)
      expect(c.explain.length).toBeGreaterThan(20)
    }
  })

  it('refuses junk load factors from a pasted config or a link', () => {
    expect(sanitizeLoadFactors(['banana', 0.5, 2, -1, null, 0.5, 0.9])).toEqual([0.5, 0.9])
    expect(sanitizeLoadFactors([])).toEqual(DEFAULT_SWEEP_LOAD_FACTORS)
    expect(sanitizeLoadFactors('0.5')).toEqual(DEFAULT_SWEEP_LOAD_FACTORS)
    const cleaned = sanitizeConfig({ ...defaults, sweepLoadFactors: [1.5, 0.8] }, a320, defaults)
    expect(cleaned.sweepLoadFactors).toEqual([0.8])
  })

  it('keeps the sweep choice through a preset, a reset and an aircraft change', () => {
    const reducer = makeConfigReducer(defaults)
    const on = reducer(defaults, { type: 'SET_FIELD', field: 'sweepEnabled', value: true, aircraft: a320 })
    const moved = reducer(on, {
      type: 'SET_FIELD',
      field: 'aircraftId',
      value: 'e175',
      aircraft: engine.resolveAircraft('e175'),
      prevAircraft: a320,
    })
    expect(moved.sweepEnabled).toBe(true)
    const back = reducer(moved, { type: 'RESET', aircraft: a320 })
    expect(back.sweepEnabled).toBe(false)
  })
})

describe('the sweep reaches the worker', () => {
  const startWith = (config, extra = {}) =>
    startBatch({
      engine,
      config,
      strategies: ['wilma', 'random'],
      runs: config.runs,
      sweep: sweepSpecFor(config, 'analytics'),
      onProgress: () => {},
      onDone: () => {},
      onError: () => {},
      ...extra,
    })

  it('sends no sweep block when nobody asked for one', () => {
    startWith({ ...defaults, runs: 20 })
    expect(posted).toHaveLength(1)
    expect(posted[0].type).toBe('start')
    expect(posted[0].sweep).toBeUndefined()
  })

  it('sends the load factors and an explicit replication count when it is on', () => {
    startWith({ ...defaults, runs: 20, sweepEnabled: true })
    expect(posted[0].sweep).toEqual({ loadFactors: [0.5, 0.6, 0.7, 0.8, 0.9, 1], runs: 5 })
    expect(posted[0].strategies).toEqual(['wilma', 'random'])
  })

  it('sends the overridden replication count instead when there is one', () => {
    startWith({ ...defaults, runs: 20, sweepEnabled: true, sweepRuns: 2, sweepLoadFactors: [0.7, 1] })
    expect(posted[0].sweep).toEqual({ loadFactors: [0.7, 1], runs: 2 })
  })
})

describe('the main-thread fallback', () => {
  beforeEach(() => {
    globalThis.__fakeWorker = null
  })

  it('runs the sweep too, and counts it into the total', async () => {
    const config = { ...defaults, runs: 2, sweepEnabled: true, sweepLoadFactors: [0.6, 1], sweepRuns: 1 }
    const result = await new Promise((resolve, reject) => {
      const handle = startBatch({
        engine,
        config,
        strategies: ['wilma', 'random'],
        runs: config.runs,
        sweep: sweepSpecFor(config, 'analytics'),
        names: engine.STRATEGIES,
        onProgress: () => {},
        onDone: resolve,
        onError: reject,
      })
      expect(handle.viaWorker).toBe(false)
    })
    // 2 strategies x 2 runs, plus 2 strategies x 2 load factors x 1 run.
    expect(result.total).toBe(8)
    expect(result.done).toBe(8)
    expect(result.sweep.loadFactors).toEqual([0.6, 1])
    for (const key of ['wilma', 'random']) {
      expect(result.sweep.byStrategy[key]).toHaveLength(2)
      for (const seconds of result.sweep.byStrategy[key]) expect(seconds).toBeGreaterThan(0)
    }
  })
})
