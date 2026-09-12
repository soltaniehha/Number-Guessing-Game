/**
 * Default SimConfig assembly, and the per-airframe layer on top of it.
 *
 * ENGINE_SPEC section 8 defines the simulation parameters, and their values
 * come from parity/defaults.json (re-exported by the engine as `DEFAULTS`).
 * Three things the UI needs are *not* in that file because they are not
 * simulation parameters — the aircraft, the strategy and the seed — plus
 * `runs`, the Monte Carlo replication count, and `compareStrategies`, the set
 * shown in Compare mode. Those live here.
 */

import { deepEqual } from './deepEqual.js'
import { DEFAULT_SWEEP_LOAD_FACTORS, DEFAULT_SWEEP_PARAM } from './sweep.js'

export const SHELL_DEFAULTS = {
  aircraftId: 'a320neo',
  strategy: 'priority_5tier',
  seed: 20260101,
  runs: 200,
  // The parameter sweep (chart 7). Opt-in: it multiplies the batch by the
  // number of points. See state/sweep.js.
  sweepEnabled: false,
  // Which scenario parameter the sweep varies. The engine's SWEEPABLE map is
  // the authority on what is legal; load factor is the axis the spec names.
  sweepParam: DEFAULT_SWEEP_PARAM,
  // Load factor keeps its own point list, so switching axis and back does not
  // lose it. Every other axis shares `sweepValues`.
  sweepLoadFactors: [...DEFAULT_SWEEP_LOAD_FACTORS],
  // Empty = whatever the chosen axis offers as its own starting points. An
  // ARRAY rather than null on purpose: `coerceToSchema` reads a null default
  // as "nullable number" and would coerce a list of points into one.
  sweepValues: [],
  // null = derive from `runs`, the way the worker does.
  sweepRuns: null,
  compareStrategies: [
    'random',
    'back_to_front',
    'wilma',
    'reverse_pyramid',
    'steffen_modified',
    'priority_5tier',
    'common_sense_5tier',
  ],
}

/**
 * The aircraft's own default parameters, filtered to keys the engine knows.
 *
 * `parity/aircraft.json` gives each airframe a `defaultConfig` — the E175's
 * tighter regional-jet bag mix, for instance. The engine layers
 * defaults.json -> aircraft.defaultConfig -> user overrides, but the shell
 * sends every key it holds, so an airframe default that is not also *in the
 * config state* is an override the user never made and never sees. This is
 * the layer that puts it into the state instead, where the panel can show it.
 *
 * `_`-prefixed keys are documentation for humans, and a key the live engine
 * does not define is a stale parameterisation; both are dropped.
 */
export function aircraftDefaultConfig(aircraft, defaults) {
  const out = {}
  const raw = aircraft?.defaultConfig
  if (!raw || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('_')) continue
    if (defaults && !Object.prototype.hasOwnProperty.call(defaults, key)) continue
    out[key] = value && typeof value === 'object' ? structuredClone(value) : value
  }
  return out
}

/** The defaults as they stand for one airframe: base defaults, then its own. */
export function effectiveDefaults(defaults, aircraft) {
  return { ...defaults, ...aircraftDefaultConfig(aircraft, defaults) }
}

/**
 * What changing airframe should change in the config, and what it must not.
 *
 * A value the user has explicitly moved away from the previous airframe's
 * effective default is theirs and is left alone. A value still sitting at that
 * default was never chosen by anyone, so the new airframe's number takes its
 * place — visibly, in the control, because the panel renders the config.
 *
 * @returns {Array<{key:string, from:*, to:*}>} in `defaults` key order
 */
export function airframeChanges(config, defaults, prevAircraft, nextAircraft) {
  const prev = effectiveDefaults(defaults, prevAircraft)
  const next = effectiveDefaults(defaults, nextAircraft)
  const keys = new Set([
    ...Object.keys(aircraftDefaultConfig(prevAircraft, defaults)),
    ...Object.keys(aircraftDefaultConfig(nextAircraft, defaults)),
  ])
  const out = []
  for (const key of keys) {
    if (!deepEqual(config?.[key], prev[key])) continue // the user's own value
    if (deepEqual(prev[key], next[key])) continue // nothing to change
    out.push({ key, from: config?.[key], to: next[key] })
  }
  return out
}

/** Door ids a freshly selected aircraft should board through. */
export function defaultDoorsFor(aircraft) {
  if (!aircraft || !aircraft.doors || aircraft.doors.length === 0) return []
  const on = aircraft.doors.filter((d) => d.defaultEnabled).map((d) => d.id)
  return on.length ? on : [aircraft.doors[0].id]
}

/**
 * Build the full default config for an engine module.
 * @param {object} engine the resolved engine (see lib/engineBridge.js)
 */
export function buildDefaultConfig(engine) {
  const ids = Object.keys(engine.AIRCRAFT || {})
  const aircraftId = ids.includes(SHELL_DEFAULTS.aircraftId) ? SHELL_DEFAULTS.aircraftId : ids[0]
  const strategies = Object.keys(engine.STRATEGIES || {})
  const strategy = strategies.includes(SHELL_DEFAULTS.strategy) ? SHELL_DEFAULTS.strategy : strategies[0]
  const aircraft = engine.resolveAircraft ? engine.resolveAircraft(aircraftId) : engine.AIRCRAFT?.[aircraftId]

  return {
    ...structuredClone(engine.DEFAULTS || {}),
    ...SHELL_DEFAULTS,
    aircraftId,
    strategy,
    doors: defaultDoorsFor(aircraft),
    compareStrategies: SHELL_DEFAULTS.compareStrategies.filter((k) => strategies.includes(k)),
  }
}
