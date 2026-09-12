/**
 * The parameter sweep (chart 7): the axis, the points, the arithmetic shown
 * for it, and the message that actually asks the worker for one.
 *
 * The bug this covers: the shell never sent `sweep`, so chart 7 could not draw
 * anything however long you ran the batch. The second one: the axis was wired
 * to load factor, so the engine's other seven sweepable parameters — above all
 * `eliteForwardBias` — could not be reached from the UI at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SWEEP_LOAD_FACTORS,
  SWEEP_AXES,
  autoSweepRuns,
  describeBatchCost,
  describeSweepCost,
  runCounts,
  sanitizeLoadFactors,
  sanitizeSweepValues,
  sweepAxesFor,
  sweepParamOf,
  sweepPointsOf,
  sweepRunsFor,
  sweepSpecFor,
  sweepValuesKey,
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
    expect(defaults.sweepParam).toBe('loadFactor')
    expect(defaults.sweepLoadFactors).toEqual([0.5, 0.6, 0.7, 0.8, 0.9, 1])
    expect(defaults.sweepRuns).toBe(null)
    expect(sweepSpecFor(defaults, 'analytics')).toBe(null)
  })

  it('is only offered where there are charts to receive it', () => {
    const keys = (mode) => presentControls('scenario', engine.DEFAULTS, mode).map((c) => c.key)
    expect(keys('analytics')).toContain('sweepEnabled')
    expect(keys('compare')).toContain('sweepPoints')
    expect(keys('compare')).toContain('sweepParam')
    expect(keys('cabin')).not.toContain('sweepEnabled')
    expect(keys('cabin')).not.toContain('sweepPoints')
    expect(keys('cabin')).not.toContain('sweepParam')
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
    expect(describeSweepCost(counts)).toBe('6 sweep points × 3 strategies × 12 replications = 216 runs')
    expect(describeBatchCost(counts)).toBe('3 strategies × 48 replications = 144 runs')
  })

  it('gets the singulars right', () => {
    const counts = runCounts({ strategies: 1, runs: 10, sweep: { loadFactors: [0.9], runs: 1 } })
    expect(describeSweepCost(counts)).toBe('1 sweep point × 1 strategy × 1 replication = 1 run')
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
    for (const key of ['sweepEnabled', 'sweepParam', 'sweepPoints', 'sweepRuns']) {
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
    const points = [0.5, 0.6, 0.7, 0.8, 0.9, 1]
    // `values` is the axis-neutral name; `loadFactors` is the name the chart
    // and the original protocol read. Both are sent, always.
    expect(posted[0].sweep).toEqual({ param: 'loadFactor', values: points, loadFactors: points, runs: 5 })
    expect(posted[0].strategies).toEqual(['wilma', 'random'])
  })

  it('sends the overridden replication count instead when there is one', () => {
    startWith({ ...defaults, runs: 20, sweepEnabled: true, sweepRuns: 2, sweepLoadFactors: [0.7, 1] })
    expect(posted[0].sweep).toEqual({ param: 'loadFactor', values: [0.7, 1], loadFactors: [0.7, 1], runs: 2 })
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

/**
 * The axis picker. The engine's SWEEPABLE map is the whitelist -- the worker
 * throws on anything outside it -- so the panel must offer exactly that set
 * and no more.
 */
describe('the sweep axis', () => {
  const reducer = makeConfigReducer(defaults)

  it('offers exactly the parameters the engine says are sweepable', () => {
    const offered = sweepAxesFor(engine.SWEEPABLE).map((a) => a.key)
    expect(offered).toEqual(Object.keys(engine.SWEEPABLE))
    expect(offered).toContain('eliteForwardBias')
    expect(offered).toContain('preboardRate')
  })

  it('gives every axis points, a starting selection and a reason to sweep it', () => {
    for (const key of Object.keys(engine.SWEEPABLE)) {
      const axis = SWEEP_AXES[key]
      expect(axis, `${key} has no axis metadata`).toBeTruthy()
      expect(axis.points.length).toBeGreaterThan(2)
      expect(axis.defaults.every((v) => axis.points.includes(v))).toBe(true)
      expect(axis.hint.length).toBeGreaterThan(30)
    }
  })

  it('falls back to load factor when a config names an axis the engine will not run', () => {
    expect(sweepParamOf({ sweepParam: 'gravity' }, engine.SWEEPABLE)).toBe('loadFactor')
    expect(sweepParamOf({ sweepParam: 'eliteForwardBias' }, engine.SWEEPABLE)).toBe('eliteForwardBias')
  })

  it('keeps the load factors when the axis changes and changes back', () => {
    const picked = reducer(
      { ...defaults, sweepEnabled: true, sweepLoadFactors: [0.7, 1] },
      { type: 'SET_FIELD', field: 'sweepParam', value: 'eliteForwardBias', aircraft: a320 },
    )
    expect(sweepValuesKey('eliteForwardBias')).toBe('sweepValues')
    expect(picked.sweepValues).toEqual(SWEEP_AXES.eliteForwardBias.defaults)
    expect(sweepPointsOf(picked, engine.SWEEPABLE)).toEqual(SWEEP_AXES.eliteForwardBias.defaults)
    const back = reducer(picked, { type: 'SET_FIELD', field: 'sweepParam', value: 'loadFactor', aircraft: a320 })
    expect(sweepPointsOf(back, engine.SWEEPABLE)).toEqual([0.7, 1])
  })

  it('refuses points that are not on the axis it is sweeping', () => {
    expect(sanitizeSweepValues('zoneCount', [3, 6, 99, 'banana'])).toEqual([3, 6])
    expect(sanitizeSweepValues('eliteForwardBias', [0.33])).toEqual(SWEEP_AXES.eliteForwardBias.defaults)
    const cleaned = sanitizeConfig(
      { ...defaults, sweepParam: 'zoneCount', sweepValues: [2, 4, 0.5] },
      a320,
      defaults,
    )
    expect(cleaned.sweepValues).toEqual([2, 4])
  })

  it('sends the chosen axis to the worker, and the worker plans it', () => {
    const config = {
      ...defaults,
      runs: 20,
      sweepEnabled: true,
      sweepParam: 'eliteForwardBias',
      sweepValues: [0, 0.5, 1],
      sweepRuns: 2,
    }
    const spec = sweepSpecFor(config, 'analytics', engine.SWEEPABLE)
    expect(spec).toEqual({ param: 'eliteForwardBias', values: [0, 0.5, 1], loadFactors: [0, 0.5, 1], runs: 2 })
    startBatch({
      engine,
      config,
      strategies: ['priority_5tier'],
      runs: config.runs,
      sweep: spec,
      onProgress: () => {},
      onDone: () => {},
      onError: () => {},
    })
    expect(posted[0].sweep.param).toBe('eliteForwardBias')
    expect(posted[0].sweep.values).toEqual([0, 0.5, 1])

    const jobs = planJobs(config, ['priority_5tier'], config.runs, spec).filter((j) => j.kind === 'sweep')
    expect(jobs).toHaveLength(6)
    expect(jobs.map((j) => j.param)).toEqual(new Array(6).fill('eliteForwardBias'))
    expect(jobs.every((j) => j.loadFactor === undefined)).toBe(true)
  })

  it('varies the chosen parameter on the main thread too, not the load factor', async () => {
    globalThis.__fakeWorker = null
    const config = {
      ...defaults,
      runs: 1,
      sweepEnabled: true,
      sweepParam: 'zoneCount',
      sweepValues: [2, 6],
      sweepRuns: 1,
    }
    const seen = []
    const spy = { ...engine, runSimulation: (cfg) => (seen.push(cfg.zoneCount), engine.runSimulation(cfg)) }
    await new Promise((resolve, reject) => {
      startBatch({
        engine: spy,
        config,
        strategies: ['back_to_front'],
        runs: config.runs,
        sweep: sweepSpecFor(config, 'analytics', engine.SWEEPABLE),
        names: engine.STRATEGIES,
        onProgress: () => {},
        onDone: resolve,
        onError: reject,
      })
    })
    // One main run at the config's own zone count, then one per sweep point.
    expect(seen).toEqual([defaults.zoneCount, 2, 6])
  })
})
