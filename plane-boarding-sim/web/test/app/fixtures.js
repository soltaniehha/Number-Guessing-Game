/** Shared test scaffolding: the fixture engine, its defaults, a resolved aircraft. */
import * as fixtureEngine from '../../src/app/__fixtures__/index.js'
import { buildDefaultConfig } from '../../src/state/configDefaults.js'

export const engine = { ...fixtureEngine, isMock: true }
export const defaults = buildDefaultConfig(engine)
export const a320 = engine.resolveAircraft('a320neo')
export const e175 = engine.resolveAircraft('e175')
export const b777 = engine.resolveAircraft('b777-300er')
