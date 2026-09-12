/**
 * The one and only config reducer.
 *
 * Plain React: `useReducer` + context, no external state library. The reducer
 * is a pure function of (defaults) -> (state, action) -> state, so tests can
 * build one against any defaults object.
 *
 * Actions
 *   SET_FIELD    { field, value, aircraft?, prevAircraft? }  set one config key
 *   TOGGLE_DOOR  { doorId }                   flip a door, never emptying the set
 *   APPLY_PRESET { patch, aircraft }          defaults + preset patch
 *   LOAD_CONFIG  { config, aircraft? }        defaults + an arbitrary partial
 *   RESET        { aircraft? }                 back to defaults
 *
 * `aircraft` is the *resolved* aircraft the new config refers to; the reducer
 * needs it to keep the door set legal and it must stay pure, so the caller
 * supplies it rather than the reducer reaching for a catalogue.
 */
import { deepEqual } from './deepEqual.js'
import { airframeChanges, defaultDoorsFor, effectiveDefaults } from './configDefaults.js'
import { DEFAULT_SWEEP_PARAM, sanitizeLoadFactors, sanitizeSweepValues, sweepAxis } from './sweep.js'

// Re-exported so the long-standing `state/configReducer.js` import site keeps
// working; the implementation moved to lib/ to keep the defaults layering,
// which also needs it, out of an import cycle.
export { deepEqual }

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

/**
 * Coerce every value whose default is a number (or a nested map of numbers)
 * into a finite number, falling back to the default when it cannot be.
 *
 * A hash or a pasted blob is attacker-shaped input: `{"loadFactor":"banana"}`
 * used to sail through `Number.isFinite` guards untouched, render as `NaN%`
 * and then be re-encoded into the shareable link. Anything that is not a
 * finite number after `Number()` is simply not a value, so the default wins.
 *
 * `null` defaults mark the nullable-numeric parameters (bin capacity, which
 * means "inherit from the airframe" when null); they accept null or a finite
 * number and nothing else. Booleans are held to `typeof` for the same reason —
 * `Boolean('false')` is not the answer anyone wants.
 */
export function coerceToSchema(config, defaults) {
  const next = { ...config }
  if (!defaults || typeof defaults !== 'object') return next
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = next[key]
    if (typeof fallback === 'number') {
      const n = Number(value)
      next[key] = Number.isFinite(n) ? n : fallback
    } else if (typeof fallback === 'boolean') {
      next[key] = typeof value === 'boolean' ? value : fallback
    } else if (fallback === null) {
      if (value == null) {
        next[key] = null
      } else {
        const n = Number(value)
        next[key] = Number.isFinite(n) ? n : null
      }
    } else if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
      const given = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
      next[key] = coerceToSchema({ ...fallback, ...given }, fallback)
    }
  }
  return next
}

/**
 * Clamp a whole config into legality for the aircraft it names.
 *
 * `defaults` is optional only so the two-argument call sites in the tests keep
 * working; pass it whenever you have it, because it is what makes the numeric
 * coercion above possible.
 */
export function sanitizeConfig(config, aircraft, defaults) {
  const next = coerceToSchema(config, defaults)
  next.doors = sanitizeDoors(next.doors, aircraft)
  if (next.doorAssignment === 'split_by_aisle' && (aircraft?.aisleCount ?? 1) < 2) {
    next.doorAssignment = 'split_by_row'
  }
  if (Number.isFinite(next.loadFactor)) next.loadFactor = Math.min(1, Math.max(0, next.loadFactor))
  if (Number.isFinite(next.runs)) next.runs = Math.max(1, Math.round(next.runs))
  if (Number.isFinite(next.zoneCount)) next.zoneCount = Math.max(1, Math.round(next.zoneCount))
  if (!Number.isFinite(next.seed)) next.seed = 0
  // Arrays are the one shape `coerceToSchema` cannot check, and a sweep axis
  // of `['banana']` would reach the worker and plot nothing.
  if (defaults && Object.prototype.hasOwnProperty.call(defaults, 'sweepLoadFactors')) {
    next.sweepLoadFactors = sanitizeLoadFactors(next.sweepLoadFactors, defaults.sweepLoadFactors)
  }
  if (defaults && Object.prototype.hasOwnProperty.call(defaults, 'sweepValues')) {
    // Only the axis in force can be checked: `sweepValues` left over from
    // another axis is inert, and snapping it to this one's grid would silently
    // rewrite points the user chose there. Empty means "this axis's defaults".
    const param = next.sweepParam || DEFAULT_SWEEP_PARAM
    const stored = next.sweepValues
    next.sweepValues =
      param !== DEFAULT_SWEEP_PARAM && Array.isArray(stored) && stored.length
        ? sanitizeSweepValues(param, stored, sweepAxis(param).defaults)
        : Array.isArray(stored)
          ? stored
          : []
  }
  if (next.sweepRuns != null) next.sweepRuns = Math.max(1, Math.round(Number(next.sweepRuns) || 1))
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
          // ...and its own parameter defaults, for every value the user has
          // not explicitly moved away from the old airframe's. WYSIWYG: the
          // numbers change ON SCREEN rather than behind the panel's back.
          for (const change of airframeChanges(state, defaults, action.prevAircraft, action.aircraft)) {
            next[change.key] = change.to
          }
          return sanitizeConfig(next, action.aircraft, defaults)
        }
        if (action.field === 'doors') return sanitizeConfig(next, action.aircraft, defaults)
        // A new sweep axis has different points; adopt its own, because the
        // previous axis's values are meaningless on it (0.9 is a sensible load
        // factor and a nonsense zone count).
        if (action.field === 'sweepParam') {
          next.sweepValues =
            action.value === DEFAULT_SWEEP_PARAM ? [] : [...sweepAxis(action.value).defaults]
          return sanitizeConfig(next, action.aircraft, defaults)
        }
        return next
      }

      case 'TOGGLE_DOOR': {
        const current = state.doors || []
        const on = current.includes(action.doorId)
        const proposed = on ? current.filter((d) => d !== action.doorId) : [...current, action.doorId]
        if (proposed.length === 0) return state // refuse to close the last door
        return { ...state, doors: sanitizeDoors(proposed, action.aircraft) }
      }

      // A preset is "defaults, then these values" — and the defaults for the
      // airframe the preset names include that airframe's own. A preset that
      // states a parameter still wins it: it is the explicit layer.
      case 'APPLY_PRESET': {
        const base = effectiveDefaults(defaults, action.aircraft)
        const merged = { ...base, ...pickKnown(action.patch, defaults) }
        return sanitizeConfig(merged, action.aircraft, defaults)
      }

      case 'LOAD_CONFIG': {
        const base = effectiveDefaults(defaults, action.aircraft)
        const merged = { ...base, ...pickKnown(action.config, defaults) }
        return sanitizeConfig(merged, action.aircraft, defaults)
      }

      case 'RESET':
        return sanitizeConfig(effectiveDefaults(defaults, action.aircraft), action.aircraft, defaults)

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
