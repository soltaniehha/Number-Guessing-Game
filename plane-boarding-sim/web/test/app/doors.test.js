/** The "at least one door" invariant, from every angle it can be attacked. */
import { describe, expect, it } from 'vitest'
import { makeConfigReducer, sanitizeDoors, sanitizeConfig } from '../../src/state/configReducer.js'
import { defaultDoorsFor } from '../../src/state/configDefaults.js'
import { defaults, a320, e175, b777, engine } from './fixtures.js'

const reducer = makeConfigReducer(defaults)

describe('at least one door', () => {
  it('refuses to close the only open door', () => {
    const single = { ...defaults, doors: ['1L'] }
    const after = reducer(single, { type: 'TOGGLE_DOOR', doorId: '1L', aircraft: a320 })
    expect(after.doors).toEqual(['1L'])
    expect(after).toBe(single)
  })

  it('lets you close a door while another is open', () => {
    const both = { ...defaults, doors: ['1L', '2L'] }
    expect(reducer(both, { type: 'TOGGLE_DOOR', doorId: '1L', aircraft: a320 }).doors).toEqual(['2L'])
  })

  it('cannot be emptied by closing doors one at a time', () => {
    let config = { ...defaults, doors: b777.doors.map((d) => d.id) }
    for (const door of b777.doors) {
      config = reducer(config, { type: 'TOGGLE_DOOR', doorId: door.id, aircraft: b777 })
      expect(config.doors.length).toBeGreaterThan(0)
    }
    expect(config.doors).toHaveLength(1)
  })

  it('cannot be emptied through SET_FIELD', () => {
    expect(reducer(defaults, { type: 'SET_FIELD', field: 'doors', value: [], aircraft: a320 }).doors).toEqual(['1L'])
  })

  it('cannot be emptied through LOAD_CONFIG', () => {
    const loaded = reducer(defaults, { type: 'LOAD_CONFIG', config: { doors: [] }, aircraft: a320 })
    expect(loaded.doors.length).toBeGreaterThan(0)
  })

  it('cannot be emptied by loading doors that belong to another aircraft', () => {
    const loaded = reducer(defaults, {
      type: 'LOAD_CONFIG',
      config: { aircraftId: 'e175', doors: ['3L', '4L'] },
      aircraft: e175,
    })
    expect(loaded.doors).toEqual(['1L'])
  })

  it('sanitizeDoors falls back to the airframe defaults when nothing survives', () => {
    expect(sanitizeDoors([], a320)).toEqual(defaultDoorsFor(a320))
    expect(sanitizeDoors(undefined, a320)).toEqual(defaultDoorsFor(a320))
    expect(sanitizeDoors(['nope'], e175)).toEqual(['1L'])
  })

  it('every aircraft in the catalogue has at least one default-enabled door', () => {
    for (const aircraft of Object.values(engine.AIRCRAFT)) {
      expect(defaultDoorsFor(aircraft).length).toBeGreaterThan(0)
      expect(sanitizeConfig({ ...defaults, doors: [] }, aircraft).doors.length).toBeGreaterThan(0)
    }
  })
})
