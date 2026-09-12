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

/**
 * Coerce a door list so it is a legal, non-empty set of BOARDING doors.
 *
 * Checking only that the ids exist is not enough: service doors and overwing
 * exits are real doors on the airframe and appear in `aircraft.doors`, but the
 * engine refuses to board through them (`e175: door(s) ["2L"] are not boarding
 * doors`). A config that named one — most easily by inheriting the default
 * airframe's `["1L","2L"]` while naming a different aircraft — made every run
 * fail until the user un-ticked a door they never set.
 */
export function sanitizeDoors(doors, aircraft) {
  const all = aircraft?.doors || []
  if (all.length === 0) return Array.isArray(doors) ? [...doors] : []
  const boardable = all.filter((d) => d.boardable !== false).map((d) => d.id)
  const kept = boardable.filter((id) => (doors || []).includes(id))
  // Invariant: an aeroplane you cannot get into is not a scenario.
  return kept.length ? kept : defaultDoorsFor(aircraft)
}

/**
 * A finite number, or the fallback.
 *
 * `Number()` alone is not the test it looks like: `Number(null)`, `Number('')`,
 * `Number([])` and `Number(false)` are all `0`, all finite, and none of them is
 * a number anybody wrote. `{"loadFactor":null}` used to coerce to 0 — the
 * slider then clamped its *display* to its 0.3 minimum while the config still
 * said 0, so the panel read 30% and no passengers boarded.
 */
function numberOr(value, fallback) {
  if (value === null || value === undefined || typeof value === 'boolean') return fallback
  if (typeof value === 'string' && value.trim() === '') return fallback
  if (typeof value === 'object') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
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
 *
 * String defaults (`aircraftId`, `strategy`, `doorAssignment`,
 * `openSeatingPolicy`) are held to `typeof` too. Without that branch they
 * passed through entirely unvalidated, and `aircraftId` is dereferenced during
 * render — `#c1=` + `{"aircraftId":42}` threw inside the reducer's lazy
 * initialiser and blanked the page. Whether the string names something that
 * exists is a separate question, answered against the engine's registries in
 * `sanitizeConfig`.
 */
export function coerceToSchema(config, defaults) {
  const next = { ...config }
  if (!defaults || typeof defaults !== 'object') return next
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = next[key]
    if (typeof fallback === 'number') {
      next[key] = numberOr(value, fallback)
    } else if (typeof fallback === 'string') {
      next[key] = typeof value === 'string' ? value : fallback
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
 * Resolve the id-shaped fields against the registries that actually define
 * them, so an id nobody has ever heard of never leaves this module.
 *
 * `aircraftId` is the one that matters: it is dereferenced *during render*
 * (`engine.resolveAircraft(id)` in the store's lazy initialiser), the real
 * engine throws for an unknown id, and a throw during render with no boundary
 * above it unmounts the whole tree. `#c1=` + base64url of
 * `{"aircraftId":"concorde"}` was a blank page with no way back but editing the
 * URL. Every other corrupted field already degraded to its default.
 *
 * @param {object} next config, already type-coerced
 * @param {object} defaults
 * @param {{AIRCRAFT?: object, STRATEGIES?: object}} [registries] the live
 *        engine's own maps. Optional: without them the ids are left as they
 *        are, which is what the reducer's unit tests want.
 */
function resolveIds(next, defaults, registries) {
  if (!registries) return next
  const known = (registry, value) =>
    registry && typeof registry === 'object' && Object.prototype.hasOwnProperty.call(registry, value)
  if (registries.AIRCRAFT && !known(registries.AIRCRAFT, next.aircraftId)) {
    next.aircraftId = known(registries.AIRCRAFT, defaults?.aircraftId)
      ? defaults.aircraftId
      : Object.keys(registries.AIRCRAFT)[0] ?? next.aircraftId
  }
  if (registries.STRATEGIES && !known(registries.STRATEGIES, next.strategy)) {
    next.strategy = known(registries.STRATEGIES, defaults?.strategy)
      ? defaults.strategy
      : Object.keys(registries.STRATEGIES)[0] ?? next.strategy
  }
  if (registries.STRATEGIES && Array.isArray(next.compareStrategies)) {
    const kept = next.compareStrategies.filter((k) => known(registries.STRATEGIES, k))
    next.compareStrategies = kept.length ? kept : [next.strategy]
  }
  return next
}

/**
 * Clamp a whole config into legality for the aircraft it names.
 *
 * `defaults` is optional only so the two-argument call sites in the tests keep
 * working; pass it whenever you have it, because it is what makes the numeric
 * coercion above possible. `registries` is the engine's own `AIRCRAFT` and
 * `STRATEGIES` maps, and is what turns "a string" into "a string that names
 * something".
 */
export function sanitizeConfig(config, aircraft, defaults, registries, movedField) {
  const next = resolveIds(coerceToSchema(config, defaults), defaults, registries)
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
  clampTriangle(next, movedField)
  return next
}

/**
 * Keep the shuffle-movement triangle ordered: min <= mode <= max.
 *
 * The engine rejects any other ordering outright ("shuffle movement times must
 * satisfy min <= mode <= max"), and the three were independent sliders with no
 * relationship between them: four of their six extremes produced a run that
 * failed instead of a run that was merely fast or slow. In a full sweep of all
 * 45 sliders to both ends — ninety runs — this was the only failure.
 *
 * The value the user just moved is the one that wins; the other two give way,
 * which is what "drag this to 6 s" plainly means. `mode` is settled last so it
 * always ends up inside the interval however the ends moved.
 */
function clampTriangle(next, moved) {
  const has = (k) => Number.isFinite(next[k])
  if (!has('shuffleMoveMin') || !has('shuffleMoveMode') || !has('shuffleMoveMax')) return next
  if (moved === 'shuffleMoveMin') {
    next.shuffleMoveMax = Math.max(next.shuffleMoveMax, next.shuffleMoveMin)
  } else if (moved === 'shuffleMoveMax') {
    next.shuffleMoveMin = Math.min(next.shuffleMoveMin, next.shuffleMoveMax)
  } else if (moved === 'shuffleMoveMode') {
    next.shuffleMoveMin = Math.min(next.shuffleMoveMin, next.shuffleMoveMode)
    next.shuffleMoveMax = Math.max(next.shuffleMoveMax, next.shuffleMoveMode)
  } else if (next.shuffleMoveMin > next.shuffleMoveMax) {
    // No single control moved (a link, a pasted blob): keep the wider interval.
    const lo = Math.min(next.shuffleMoveMin, next.shuffleMoveMax)
    const hi = Math.max(next.shuffleMoveMin, next.shuffleMoveMax)
    next.shuffleMoveMin = lo
    next.shuffleMoveMax = hi
  }
  next.shuffleMoveMode = Math.min(next.shuffleMoveMax, Math.max(next.shuffleMoveMin, next.shuffleMoveMode))
  return next
}

/** The shuffle-movement triangle: three sliders that constrain each other. */
const TRIANGLE = new Set(['shuffleMoveMin', 'shuffleMoveMode', 'shuffleMoveMax'])

export function makeConfigReducer(defaults, registries) {
  const clamp = (config, aircraft, movedField) => sanitizeConfig(config, aircraft, defaults, registries, movedField)
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
          return clamp(next, action.aircraft)
        }
        if (action.field === 'doors') return clamp(next, action.aircraft)
        // Cross-clamped groups: the field just moved is the one that wins.
        if (TRIANGLE.has(action.field)) return clamp(next, action.aircraft, action.field)
        // A new sweep axis has different points; adopt its own, because the
        // previous axis's values are meaningless on it (0.9 is a sensible load
        // factor and a nonsense zone count).
        if (action.field === 'sweepParam') {
          next.sweepValues =
            action.value === DEFAULT_SWEEP_PARAM ? [] : [...sweepAxis(action.value).defaults]
          return clamp(next, action.aircraft)
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
        return clamp(merged, action.aircraft)
      }

      case 'LOAD_CONFIG': {
        const base = effectiveDefaults(defaults, action.aircraft)
        const merged = { ...base, ...pickKnown(action.config, defaults) }
        return clamp(merged, action.aircraft)
      }

      case 'RESET':
        return clamp(effectiveDefaults(defaults, action.aircraft), action.aircraft)

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
