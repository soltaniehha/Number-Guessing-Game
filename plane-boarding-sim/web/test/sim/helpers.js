/**
 * Shared scaffolding, mirroring `python/tests/helpers.py`.
 */
import { getAircraft } from '../../src/sim/aircraft.js'
import { buildConfig } from '../../src/sim/config.js'
import { generate } from '../../src/sim/passengers.js'
import { PCG32 } from '../../src/sim/rng.js'
import { buildOrder } from '../../src/sim/strategies.js'

/**
 * A scenario stripped of every source of ordering noise. Used wherever a test
 * needs to assert a property of the *strategy itself* rather than of the
 * post-processing that deliberately corrupts it.
 */
export const CLEAN = {
  partySizeWeights: { 1: 1.0 },
  keepPartiesTogether: false,
  nonComplianceRate: 0.0,
  lateRate: 0.0,
  preboardRate: 0.0,
  preboardFirst: false,
  slowPaxRate: 0.0,
}

export function cfgFor(aircraft = 'a320neo', strategy = 'random', seed = 1, overrides = {}) {
  const ac = getAircraft(aircraft)
  return buildConfig(ac.defaultConfig, { aircraftId: aircraft, strategy, seed, ...overrides })
}

export function cleanCfg(aircraft = 'a320neo', strategy = 'random', seed = 1, overrides = {}) {
  return cfgFor(aircraft, strategy, seed, { ...CLEAN, ...overrides })
}

/** Reproduce the engine's manifest + ordering without running the simulation. */
export function makeQueue(cfg) {
  const ac = getAircraft(cfg.aircraftId)
  const pax = generate(new PCG32(cfg.seed, 1), ac, cfg)
  return { ac, queue: buildOrder(pax, ac, cfg, new PCG32(cfg.seed, 2)) }
}

export const ALL_AIRCRAFT = ['e175', 'a320neo', 'b737_max8', 'a220_300', 'b777_300er', 'b787_9']
