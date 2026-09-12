/**
 * The one and only config reducer.
 *
 * Plain React: `useReducer` + context, no external state library. The reducer
 * is a pure function of (defaults) -> (state, action) -> state, so tests can
 * build one against any defaults object.
 *
 * Actions
 *   SET_FIELD    { field, value, aircraft? }  set one config key
 *   TOGGLE_DOOR  { doorId }                   flip a door, never emptying the set
 *   APPLY_PRESET { patch, aircraft }          defaults + preset patch
 *   LOAD_CONFIG  { config, aircraft? }        defaults + an arbitrary partial
 *   RESET        {}                           back to defaults
 *
 * `aircraft` is the *resolved* aircraft the new config refers to; the reducer
 * needs it to keep the door set legal and it must stay pure, so the caller
 * supplies it rather than the reducer reaching for a catalogue.
 */
import { defaultDoorsFor } from './configDefaults.js'

/**
 * Drop keys the engine does not know about.
 *
 * Every simulation parameter has an entry in the engine's DEFAULTS
 * (ENGINE_SPEC section 8), so anything outside that set is either a stale
 * preset key from an older parameterisation or junk from a pasted blob. Either
 * way it must not reach the config, where it would pollute the shareable diff.
 */
export function pickKnown(partial, defaults) {
  const out = {}
  for (const [key, value] of Object.entries(partial || {})) {
    if (Object.prototype.hasOwnProperty.call(defaults, key)) out[key] = value
  }
  return out
}

/** Coerce a door list so it is a legal, non-empty subset of the aircraft's doors. */
export function sanitizeDoors(doors, aircraft) {
  const available = (aircraft?.doors || []).map((d) => d.id)
  if (available.length === 0) return Array.isArray(doors) ? [...doors] : []
  const kept = available.filter((id) => (doors || []).includes(id))
  // Invariant: an aeroplane you cannot get into is not a scenario.
  return kept.length ? kept : defaultDoorsFor(aircraft)
}

/** Clamp a whole config into legality for the aircraft it names. */
export function sanitizeConfig(config, aircraft) {
  const next = { ...config }
  next.doors = sanitizeDoors(next.doors, aircraft)
  if (next.doorAssignment === 'split_by_aisle' && (aircraft?.aisleCount ?? 1) < 2) {
    next.doorAssignment = 'split_by_row'
  }
  if (Number.isFinite(next.loadFactor)) next.loadFactor = Math.min(1, Math.max(0, next.loadFactor))
  if (Number.isFinite(next.runs)) next.runs = Math.max(1, Math.round(next.runs))
  if (Number.isFinite(next.zoneCount)) next.zoneCount = Math.max(1, Math.round(next.zoneCount))
  if (!Number.isFinite(next.seed)) next.seed = 0
  return next
}

export function makeConfigReducer(defaults) {
  return function configReducer(state, action) {
    switch (action.type) {
      case 'SET_FIELD': {
        if (!action.field) return state
        const next = { ...state, [action.field]: action.value }
        if (action.field === 'aircraftId') {
          // A new airframe has a different door list; adopt its default doors.
          next.doors = defaultDoorsFor(action.aircraft)
          return sanitizeConfig(next, action.aircraft)
        }
        if (action.field === 'doors') return sanitizeConfig(next, action.aircraft)
        return next
      }

      case 'TOGGLE_DOOR': {
        const current = state.doors || []
        const on = current.includes(action.doorId)
        const proposed = on ? current.filter((d) => d !== action.doorId) : [...current, action.doorId]
        if (proposed.length === 0) return state // refuse to close the last door
        return { ...state, doors: sanitizeDoors(proposed, action.aircraft) }
      }

      case 'APPLY_PRESET': {
        const merged = { ...defaults, ...pickKnown(action.patch, defaults) }
        return sanitizeConfig(merged, action.aircraft)
      }

      case 'LOAD_CONFIG': {
        const merged = { ...defaults, ...pickKnown(action.config, defaults) }
        return sanitizeConfig(merged, action.aircraft)
      }

      case 'RESET':
        return { ...defaults }

      default:
        return state
    }
  }
}

/** Only the keys that differ from the defaults — what we share and copy. */
export function configDiff(config, defaults) {
  const out = {}
  for (const [key, value] of Object.entries(config)) {
    if (!deepEqual(value, defaults[key])) out[key] = value
  }
  return out
}

export function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    return ka.every((k) => deepEqual(a[k], b[k]))
  }
  return false
}
