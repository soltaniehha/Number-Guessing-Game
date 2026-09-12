/**
 * Default SimConfig assembly.
 *
 * ENGINE_SPEC section 8 defines the simulation parameters, and their values
 * come from parity/defaults.json (re-exported by the engine as `DEFAULTS`).
 * Three things the UI needs are *not* in that file because they are not
 * simulation parameters — the aircraft, the strategy and the seed — plus
 * `runs`, the Monte Carlo replication count, and `compareStrategies`, the set
 * shown in Compare mode. Those live here.
 */

export const SHELL_DEFAULTS = {
  aircraftId: 'a320neo',
  strategy: 'priority_5tier',
  seed: 20260101,
  runs: 200,
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
