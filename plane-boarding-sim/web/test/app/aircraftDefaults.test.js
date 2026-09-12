/**
 * Per-aircraft defaults (`defaultConfig` in parity/aircraft.json).
 *
 * The bug this covers: the shell sends every key it holds, so the engine saw
 * every airframe default as an explicit user override and none of them ever
 * applied. The fix puts them in the config STATE — visibly, in the controls —
 * without ever overwriting a value the user chose themselves.
 */
import { describe, expect, it } from 'vitest'
import {
  aircraftDefaultConfig,
  airframeChanges,
  effectiveDefaults,
} from '../../src/state/configDefaults.js'
import { makeConfigReducer } from '../../src/state/configReducer.js'
import { PRESET_BY_ID, PRESETS } from '../../src/app/presets.js'
import { defaults, engine, a320, e175 } from './fixtures.js'

const reducer = makeConfigReducer(defaults)
const switchTo = (state, id, from = a320) =>
  reducer(state, { type: 'SET_FIELD', field: 'aircraftId', value: id, aircraft: engine.resolveAircraft(id), prevAircraft: from })

describe('aircraft defaultConfig', () => {
  it('reads the airframe\'s own parameters, minus the documentation', () => {
    const own = aircraftDefaultConfig(e175, defaults)
    expect(own).toEqual({ bagWeights: { 0: 0.42, 1: 0.5, 2: 0.08 } })
    expect(Object.keys(own)).not.toContain('_comment')
    expect(aircraftDefaultConfig(a320, defaults)).toEqual({})
  })

  it('drops keys the live engine does not define', () => {
    const odd = { defaultConfig: { bagWeights: { 0: 1 }, warpFactor: 9 } }
    expect(aircraftDefaultConfig(odd, defaults)).toEqual({ bagWeights: { 0: 1 } })
  })

  it('layers under the base defaults, not over them', () => {
    const eff = effectiveDefaults(defaults, e175)
    expect(eff.bagWeights).toEqual({ 0: 0.42, 1: 0.5, 2: 0.08 })
    expect(eff.loadFactor).toBe(defaults.loadFactor)
    expect(effectiveDefaults(defaults, a320)).toEqual(defaults)
  })
})

describe('switching aircraft', () => {
  it('adopts the airframe\'s values for anything the user never touched', () => {
    const moved = switchTo(defaults, 'e175')
    expect(moved.bagWeights).toEqual({ 0: 0.42, 1: 0.5, 2: 0.08 })
    // ...and the panel is what runs: the value is in the config, not hidden
    // in the engine's layering.
    expect(moved.bagWeights).not.toEqual(defaults.bagWeights)
  })

  it('never reverts a value the user set themselves', () => {
    const mine = { 0: 0, 1: 0, 2: 1 }
    const edited = reducer(defaults, { type: 'SET_FIELD', field: 'bagWeights', value: mine, aircraft: a320 })
    const moved = switchTo(edited, 'e175')
    expect(moved.bagWeights).toEqual(mine)
  })

  it('restores the generic default on the way back out of the airframe', () => {
    const there = switchTo(defaults, 'e175')
    const back = switchTo(there, 'a320neo', e175)
    expect(back.bagWeights).toEqual(defaults.bagWeights)
  })

  it('keeps an edit made WHILE on the airframe when leaving it', () => {
    const there = switchTo(defaults, 'e175')
    const mine = { 0: 0.5, 1: 0.5, 2: 0 }
    const edited = reducer(there, { type: 'SET_FIELD', field: 'bagWeights', value: mine, aircraft: e175 })
    const back = switchTo(edited, 'a320neo', e175)
    expect(back.bagWeights).toEqual(mine)
  })

  it('reports what it changed, so the change can be shown', () => {
    const changes = airframeChanges(defaults, defaults, a320, e175)
    expect(changes.map((c) => c.key)).toEqual(['bagWeights'])
    expect(changes[0].to).toEqual({ 0: 0.42, 1: 0.5, 2: 0.08 })
    // Nothing to say when the user already owns the value.
    const mine = { ...defaults, bagWeights: { 0: 1, 1: 0, 2: 0 } }
    expect(airframeChanges(mine, defaults, a320, e175)).toEqual([])
    // Leaving the airframe hands the generic default back, by the same rule.
    const onE175 = effectiveDefaults(defaults, e175)
    expect(airframeChanges(onE175, defaults, e175, a320)).toEqual([
      { key: 'bagWeights', from: onE175.bagWeights, to: defaults.bagWeights },
    ])
    // Nothing at all to do when the airframe does not change.
    expect(airframeChanges(defaults, defaults, a320, a320)).toEqual([])
  })

  it('still adopts the airframe\'s doors', () => {
    const moved = switchTo(defaults, 'e175')
    expect(moved.doors).toEqual(['1L'])
  })
})

describe('presets and aircraft agree', () => {
  it('names an aircraft the live engine actually has', () => {
    for (const p of PRESETS) expect(Object.keys(engine.AIRCRAFT)).toContain(p.patch.aircraftId)
  })

  it('leaves no half-merged config: the airframe layer is under every preset', () => {
    const applied = reducer(defaults, {
      type: 'APPLY_PRESET',
      patch: { aircraftId: 'e175', strategy: 'back_to_front' },
      aircraft: e175,
    })
    expect(applied.bagWeights).toEqual({ 0: 0.42, 1: 0.5, 2: 0.08 })
    expect(applied.aircraftId).toBe('e175')
    expect(applied.strategy).toBe('back_to_front')
    // A bare aircraft patch and simply switching aircraft agree on the result.
    const switched = switchTo(defaults, 'e175')
    expect(applied.bagWeights).toEqual(switched.bagWeights)
    expect(applied.doors).toEqual(switched.doors)
  })

  it('lets a preset that states a parameter keep it', () => {
    const applied = reducer(defaults, {
      type: 'APPLY_PRESET',
      patch: PRESET_BY_ID.regional_commuter.patch,
      aircraft: e175,
    })
    expect(applied.bagWeights).toEqual(PRESET_BY_ID.regional_commuter.patch.bagWeights)
    // ...but takes the airframe's bins, because it does not state those.
    expect(applied.binBagsPerRowSide).toBe(null)
  })

  it('applying a preset twice, or after a detour, lands in the same place', () => {
    const once = reducer(defaults, { type: 'APPLY_PRESET', patch: PRESET_BY_ID.regional_commuter.patch, aircraft: e175 })
    const detour = switchTo(once, 'a320neo', e175)
    const again = reducer(detour, { type: 'APPLY_PRESET', patch: PRESET_BY_ID.regional_commuter.patch, aircraft: e175 })
    expect(again).toEqual(once)
  })
})

/**
 * The observable symptom, measured against the real engine rather than the
 * fixture one: the E175's tight bins and valet-checked bag mix are what make
 * it interesting, and if gate-checks do not move, nothing has been fixed.
 */
describe('the E175 actually behaves like an E175', () => {
  it('boards with its own bag mix and its own bins, and gate-checks accordingly', async () => {
    const sim = await import('../../src/sim/index.js')
    const { buildDefaultConfig } = await import('../../src/state/configDefaults.js')
    const base = buildDefaultConfig(sim)
    const reduce = makeConfigReducer(base)
    const a320neo = sim.resolveAircraft('a320neo')
    const embraer = sim.resolveAircraft('e175')

    const switched = reduce(base, {
      type: 'SET_FIELD',
      field: 'aircraftId',
      value: 'e175',
      aircraft: embraer,
      prevAircraft: a320neo,
    })
    // The airframe's own bag mix is in the CONFIG, which is what the panel
    // shows and what the engine is handed.
    expect(switched.bagWeights).toEqual({ 0: 0.42, 1: 0.5, 2: 0.08 })
    expect(switched.binBagsPerRowSide).toBe(null) // inherit: 1 bag per row-side
    expect(embraer.binBagsPerRowSide).toBe(1)
    expect(a320neo.binBagsPerRowSide).toBe(4)

    const rate = (config) => {
      const r = sim.runSimulation(config)
      return r.gateChecks / r.paxCount
    }
    // Switching airframe raises gate-checking: a quarter of the bins for a
    // fifth of the seats.
    expect(rate(base)).toBeLessThan(0.02)
    expect(rate(switched)).toBeGreaterThan(0.08)

    // ...and with the airframe defaults ignored (the bug), the same aircraft
    // gate-checks far more of the cabin than United ever reports.
    const asBefore = { ...switched, bagWeights: base.bagWeights }
    expect(rate(asBefore)).toBeGreaterThan(rate(switched) * 2)
  })

  it('the Regional commuter preset gate-checks heavily, as its blurb promises', async () => {
    const sim = await import('../../src/sim/index.js')
    const { buildDefaultConfig } = await import('../../src/state/configDefaults.js')
    const base = buildDefaultConfig(sim)
    const reduce = makeConfigReducer(base)
    const config = reduce(base, {
      type: 'APPLY_PRESET',
      patch: PRESET_BY_ID.regional_commuter.patch,
      aircraft: sim.resolveAircraft('e175'),
    })
    expect(config.binBagsPerRowSide).toBe(null)
    const result = sim.runSimulation(config)
    expect(result.gateChecks / result.paxCount).toBeGreaterThan(0.4)
  })
})
