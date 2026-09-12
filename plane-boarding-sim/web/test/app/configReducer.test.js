import { describe, expect, it } from 'vitest'
import { makeConfigReducer, sanitizeConfig, sanitizeDoors, configDiff, deepEqual, pickKnown } from '../../src/state/configReducer.js'
import { defaults, a320, e175, b777, engine } from './fixtures.js'

const reducer = makeConfigReducer(defaults)

describe('configReducer', () => {
  it('SET_FIELD sets a scalar without touching anything else', () => {
    const next = reducer(defaults, { type: 'SET_FIELD', field: 'loadFactor', value: 0.5, aircraft: a320 })
    expect(next.loadFactor).toBe(0.5)
    expect(next.strategy).toBe(defaults.strategy)
    expect(defaults.loadFactor).not.toBe(0.5) // no mutation
  })

  it('SET_FIELD ignores an action with no field', () => {
    expect(reducer(defaults, { type: 'SET_FIELD', value: 1 })).toBe(defaults)
  })

  it('SET_FIELD on aircraftId adopts the new airframe default doors', () => {
    const next = reducer(defaults, { type: 'SET_FIELD', field: 'aircraftId', value: 'e175', aircraft: e175 })
    expect(next.aircraftId).toBe('e175')
    expect(next.doors).toEqual(['1L'])
  })

  it('SET_FIELD on aircraftId drops split_by_aisle when the new aircraft has one aisle', () => {
    const twin = reducer(defaults, { type: 'SET_FIELD', field: 'aircraftId', value: 'b777-300er', aircraft: b777 })
    const withAisleSplit = reducer(twin, { type: 'SET_FIELD', field: 'doorAssignment', value: 'split_by_aisle', aircraft: b777 })
    expect(withAisleSplit.doorAssignment).toBe('split_by_aisle')
    const single = reducer(withAisleSplit, { type: 'SET_FIELD', field: 'aircraftId', value: 'e175', aircraft: e175 })
    expect(single.doorAssignment).toBe('split_by_row')
  })

  it('SET_FIELD on doors sanitises unknown ids and never empties the set', () => {
    const next = reducer(defaults, { type: 'SET_FIELD', field: 'doors', value: ['9Z'], aircraft: a320 })
    expect(next.doors).toEqual(['1L'])
  })

  it('TOGGLE_DOOR turns a door on and off again', () => {
    const on = reducer(defaults, { type: 'TOGGLE_DOOR', doorId: '2L', aircraft: a320 })
    expect(on.doors.sort()).toEqual(['1L', '2L'])
    const off = reducer(on, { type: 'TOGGLE_DOOR', doorId: '2L', aircraft: a320 })
    expect(off.doors).toEqual(['1L'])
  })

  it('APPLY_PRESET starts from the defaults, not from the current state', () => {
    const fiddled = reducer(defaults, { type: 'SET_FIELD', field: 'walkSpeedMean', value: 1.55, aircraft: a320 })
    const next = reducer(fiddled, { type: 'APPLY_PRESET', patch: { strategy: 'wilma' }, aircraft: a320 })
    expect(next.strategy).toBe('wilma')
    expect(next.walkSpeedMean).toBe(defaults.walkSpeedMean)
  })

  it('LOAD_CONFIG merges a partial over the defaults and drops unknown keys', () => {
    const next = reducer(defaults, {
      type: 'LOAD_CONFIG',
      config: { strategy: 'steffen_perfect', nonsenseKey: 42 },
      aircraft: a320,
    })
    expect(next.strategy).toBe('steffen_perfect')
    expect(next).not.toHaveProperty('nonsenseKey')
    expect(next.loadFactor).toBe(defaults.loadFactor)
  })

  it('RESET returns exactly the defaults', () => {
    const fiddled = reducer(defaults, { type: 'SET_FIELD', field: 'seed', value: 7, aircraft: a320 })
    expect(reducer(fiddled, { type: 'RESET' })).toEqual(defaults)
  })

  it('ignores an unknown action', () => {
    expect(reducer(defaults, { type: 'NOPE' })).toBe(defaults)
  })
})

describe('sanitizeConfig', () => {
  it('clamps the load factor and rounds the counts', () => {
    const out = sanitizeConfig({ ...defaults, loadFactor: 1.8, runs: 12.7, zoneCount: 3.4 }, a320)
    expect(out.loadFactor).toBe(1)
    expect(out.runs).toBe(13)
    expect(out.zoneCount).toBe(3)
  })

  it('replaces a non-numeric seed', () => {
    expect(sanitizeConfig({ ...defaults, seed: 'abc' }, a320).seed).toBe(0)
  })
})

describe('helpers', () => {
  it('sanitizeDoors keeps only ids the airframe has', () => {
    expect(sanitizeDoors(['1L', '2L', '7Q'], a320)).toEqual(['1L', '2L'])
  })

  it('configDiff reports only what changed', () => {
    const changed = { ...defaults, loadFactor: 0.5 }
    expect(configDiff(changed, defaults)).toEqual({ loadFactor: 0.5 })
    expect(configDiff(defaults, defaults)).toEqual({})
  })

  it('configDiff sees inside nested weight objects', () => {
    const changed = { ...defaults, bagWeights: { ...defaults.bagWeights, 2: 0.9 } }
    expect(Object.keys(configDiff(changed, defaults))).toEqual(['bagWeights'])
  })

  it('deepEqual compares arrays and objects structurally', () => {
    expect(deepEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true)
    expect(deepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false)
    expect(deepEqual(['1L'], ['1L'])).toBe(true)
  })

  it('pickKnown keeps only keys the engine defines', () => {
    expect(pickKnown({ loadFactor: 0.5, madeUp: 1 }, engine.DEFAULTS)).toEqual({ loadFactor: 0.5 })
  })
})
