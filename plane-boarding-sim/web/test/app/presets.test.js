import { describe, expect, it } from 'vitest'
import { PRESETS, PRESET_BY_ID } from '../../src/app/presets.js'
import { makeConfigReducer } from '../../src/state/configReducer.js'
import { SHELL_DEFAULTS } from '../../src/state/configDefaults.js'
import { defaults, engine } from './fixtures.js'

const reducer = makeConfigReducer(defaults)
const apply = (preset) =>
  reducer(defaults, {
    type: 'APPLY_PRESET',
    patch: preset.patch,
    aircraft: engine.resolveAircraft(preset.patch.aircraftId),
  })

describe('presets', () => {
  it('ships the seven scenarios from the spec, each with a description', () => {
    expect(PRESETS).toHaveLength(7)
    for (const p of PRESETS) {
      expect(p.name.length).toBeGreaterThan(3)
      expect(p.blurb.length).toBeGreaterThan(20)
      expect(PRESET_BY_ID[p.id]).toBe(p)
    }
  })

  it('names a real aircraft and a real strategy', () => {
    for (const p of PRESETS) {
      expect(Object.keys(engine.AIRCRAFT)).toContain(p.patch.aircraftId)
      expect(Object.keys(engine.STRATEGIES)).toContain(p.patch.strategy)
    }
  })

  it('applies cleanly: every preset produces a legal config', () => {
    for (const p of PRESETS) {
      const config = apply(p)
      const aircraft = engine.resolveAircraft(config.aircraftId)
      const doorIds = aircraft.doors.map((d) => d.id)
      expect(config.doors.length).toBeGreaterThan(0)
      expect(config.doors.every((d) => doorIds.includes(d))).toBe(true)
      expect(config.loadFactor).toBeGreaterThan(0)
      expect(config.loadFactor).toBeLessThanOrEqual(1)
    }
  })

  it('drops preset keys the engine does not define', () => {
    const config = apply(PRESET_BY_ID.longhaul_widebody)
    for (const key of Object.keys(config)) {
      const known = Object.prototype.hasOwnProperty.call(engine.DEFAULTS, key)
      const shellField = Object.prototype.hasOwnProperty.call(SHELL_DEFAULTS, key) || key === 'doors'
      expect(known || shellField).toBe(true)
    }
  })

  it('does not inherit whatever was set before it', () => {
    const fiddled = reducer(defaults, { type: 'SET_FIELD', field: 'lateRate', value: 0.11 })
    const applied = reducer(fiddled, {
      type: 'APPLY_PRESET',
      patch: PRESET_BY_ID.us_legacy_hub.patch,
      aircraft: engine.resolveAircraft('a320neo'),
    })
    expect(applied.lateRate).toBe(defaults.lateRate)
  })

  it('every preset actually changes something', () => {
    for (const p of PRESETS) {
      const config = apply(p)
      expect(config).not.toEqual(defaults)
    }
  })
})
