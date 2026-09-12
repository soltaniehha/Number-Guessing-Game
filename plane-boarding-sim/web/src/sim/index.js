/**
 * Public surface of the simulation engine.
 *
 * This is a port of `python/plane_boarding/` and is required to produce
 * BIT-IDENTICAL results to it: same passenger manifest, same boarding order,
 * same service times, same total. `parity/compare.py` runs both engines over
 * `parity/fixtures.json` and fails CI on any disagreement.
 *
 * The two shared data files -- `parity/defaults.json` and
 * `parity/aircraft.json` -- are imported, never transcribed. Both engines read
 * the same bytes, so they cannot drift on a parameter value.
 *
 * The interface below is what `src/lib/engineBridge.js` expects:
 *
 *   AIRCRAFT, STRATEGIES, DEFAULTS, runSimulation(config), runReplay(config),
 *   resolveAircraft(id)
 */
import { aircraftIds, geometryPayload, getAircraft } from './aircraft.js'
import { DEFAULTS as DEFAULTS_JSON, buildConfig, knownConfigKeys } from './config.js'
import { run, simulate } from './engine.js'
import { STRATEGIES as STRATEGY_REGISTRY } from './strategies.js'
import './replay.js' // registers the replay builder with the engine

/** The parsed `parity/defaults.json`, exactly as both engines read it. */
export const DEFAULTS = DEFAULTS_JSON

/**
 * Strategy metadata, without the implementation function.
 *
 * The picker renders straight off this, and a bare metadata object survives
 * `structuredClone` into a worker where a closure would not.
 */
export const STRATEGIES = Object.fromEntries(
  Object.entries(STRATEGY_REGISTRY).map(([key, entry]) => [
    key,
    { key, name: entry.name, description: entry.description, family: entry.family },
  ]),
)

/**
 * Resolve (and cache) an aircraft's geometry.
 * @param {string} id
 */
export function resolveAircraft(id) {
  return getAircraft(id)
}

/** Every aircraft in `parity/aircraft.json`, resolved and keyed by id. */
export const AIRCRAFT = Object.fromEntries(aircraftIds().map((id) => [id, getAircraft(id)]))

const KNOWN_KEYS = knownConfigKeys()

/**
 * Turn a UI-level config object into a validated `SimConfig`.
 *
 * The shell owns the whole parameter set (see `state/configReducer.js`), so
 * every key it supplies is treated as an explicit override on top of
 * defaults -> aircraft defaults. Keys the engine does not know -- the shell's
 * own `runs` and `compareStrategies`, and the `_`-prefixed documentation keys
 * carried along in `DEFAULTS` -- are dropped rather than rejected, because a
 * pasted or URL-encoded config is not a programming error.
 */
export function toSimConfig(config) {
  const ac = getAircraft(config && config.aircraftId ? config.aircraftId : 'a320neo')
  const overrides = {}
  for (const key of Object.keys(config || {})) {
    if (KNOWN_KEYS.has(key)) overrides[key] = config[key]
  }
  return buildConfig(ac.defaultConfig, overrides)
}

/**
 * Run one boarding.
 * @param {object} config
 * @returns {object} RunResult (ENGINE_SPEC section 7)
 */
export function runSimulation(config) {
  const cfg = toSimConfig(config)
  return simulate(cfg, getAircraft(cfg.aircraftId))
}

/**
 * Run one boarding and keep the frame buffer for the cabin renderer.
 * @param {object} config
 * @param {number} [frameInterval] seconds between frames
 * @returns {object} Replay: a RunResult plus geometry, passengers and frames
 */
export function runReplay(config, frameInterval = 0.25) {
  const cfg = toSimConfig(config)
  const { replay } = run(cfg, getAircraft(cfg.aircraftId), true, frameInterval)
  return replay
}

export { geometryPayload }
export { buildConfig, ConfigError, SimConfig, ticksFor } from './config.js'
export { PCG32 } from './rng.js'
export { Aggregate, percentile } from './metrics.js'
export { BatchResult, compareStrategies, loadSweep, runBatch } from './batch.js'
export { run, simulate } from './engine.js'
export { aircraftIds, getAircraft } from './aircraft.js'
export { STRATEGY_REGISTRY }
