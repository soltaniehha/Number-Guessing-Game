/**
 * The parameter sweep: the second axis chart 7 (UI_SPEC section 2) plots.
 *
 * A sweep re-runs every strategy at each of several values of ONE scenario
 * parameter, so it multiplies an already-large batch by the number of points.
 * It is therefore opt-in, it gets its own (smaller) replication count, and the
 * panel shows the resulting arithmetic before anything starts.
 *
 * The worker (`src/sim/batchWorker.js`) owns the protocol:
 *   {type:'start', config, strategies, runs,
 *    sweep:{param:'loadFactor', values:[...], loadFactors:[...], runs?:N}}
 * and defaults `sweep.runs` to `max(3, min(12, round(runs / 4)))`. That rule is
 * restated here — `autoSweepRuns` — so the panel can *show* the number rather
 * than leave it implicit, and every spec this module builds carries an explicit
 * `runs` so what the user is told and what the worker does cannot drift.
 *
 * ## Which parameters may be swept
 *
 * The ENGINE decides: `SWEEPABLE` in `src/sim/batch.js` (mirrored by
 * `plane_boarding.batch.SWEEPABLE` on the Python side) is the whitelist, and
 * the worker throws on anything outside it. This module only supplies the
 * *presentation* of each axis — which points to offer and how to write them —
 * in `SWEEP_AXES`, whose point sets are the same ones the CLI uses for
 * `cli sweep --param X`, so the two front ends sweep the same grid.
 */

/** The load-factor points the panel offers. Kept exported: the spec names them. */
export const SWEEP_POINTS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]

/** The points a load-factor sweep starts with: half-empty up to full. */
export const DEFAULT_SWEEP_LOAD_FACTORS = [0.5, 0.6, 0.7, 0.8, 0.9, 1]

/** The axis every sweep falls back to, and the one the spec is written around. */
export const DEFAULT_SWEEP_PARAM = 'loadFactor'

const asPct = (v) => `${Math.round(v * 100)}%`
const asNum = (v) => String(Number(v.toFixed(2)))
const asInt = (v) => String(Math.round(v))

/**
 * Per-axis presentation: the points offered, the ones selected to begin with,
 * how a point is written on its chip, and the sentence chart 7 is worth
 * reading for on that axis.
 *
 * `points` and `defaults` match `_SWEEP_DEFAULTS` in `plane_boarding/cli.py`,
 * so a sweep run in the browser and the same sweep run from the CLI land on
 * the same grid.
 */
export const SWEEP_AXES = {
  loadFactor: {
    points: SWEEP_POINTS,
    defaults: DEFAULT_SWEEP_LOAD_FACTORS,
    format: asPct,
    integer: false,
    hint: 'Schultz finds this relationship is linear for one- and two-door boarding alike, so a bend means something is saturating.',
  },
  preboardRate: {
    points: [0, 0.025, 0.05, 0.1, 0.15, 0.2, 0.25, 0.33],
    defaults: [0, 0.025, 0.05, 0.1, 0.15, 0.2, 0.25, 0.33],
    format: asPct,
    integer: false,
    hint: 'Watch for the knee: above roughly 15% the preboard block, not the boarding order, is what sets the time.',
  },
  eliteForwardBias: {
    points: [0, 0.25, 0.5, 0.75, 1],
    defaults: [0, 0.25, 0.5, 0.75, 1],
    format: asNum,
    integer: false,
    hint: 'The one that turns "does selling priority boarding cost time?" into a curve: at 0 status is spread evenly down the cabin, at 1 it is concentrated forward. Status-ordered strategies climb; everything else stays flat.',
  },
  nonComplianceRate: {
    points: [0, 0.05, 0.15, 0.3, 0.5],
    defaults: [0, 0.05, 0.15, 0.3, 0.5],
    format: asPct,
    integer: false,
    hint: 'Strategy differences narrow as compliance falls — a scheme nobody follows is a free-for-all.',
  },
  lateRate: {
    points: [0, 0.01, 0.05, 0.1, 0.2],
    defaults: [0, 0.01, 0.05, 0.1, 0.2],
    format: asPct,
    integer: false,
    hint: 'Late arrivals board last whatever their group says, so they cost the same under every strategy.',
  },
  stowPassSpeedFactor: {
    points: [0, 0.2, 0.3, 0.4, 0.6],
    defaults: [0, 0.2, 0.3, 0.4, 0.6],
    format: asNum,
    integer: false,
    hint: '0 is strict Schultz blocking, where a stowing passenger closes the aisle. Sweeping it shows how much of every strategy advantage is really "avoiding a stow-block" (RESEARCH_PARAMETERS 12.3).',
  },
  binCongestionWeight: {
    points: [0, 0.25, 0.45, 0.75, 1],
    defaults: [0, 0.25, 0.45, 0.75, 1],
    format: asNum,
    integer: false,
    hint: 'How much a nearly-full bin slows a stow. The main reason two runs of the same passenger differ across strategies.',
  },
  zoneCount: {
    points: [2, 3, 4, 5, 6, 7, 8],
    defaults: [2, 3, 4, 5, 6],
    format: asInt,
    integer: true,
    hint: 'Only the zone strategies move. More zones is finer spatial control and more announcements.',
  },
}

/** Fallback for a sweepable parameter this module has no point set for. */
const GENERIC_AXIS = {
  points: [0, 0.25, 0.5, 0.75, 1],
  defaults: [0, 0.25, 0.5, 0.75, 1],
  format: asNum,
  integer: false,
  hint: null,
}

/** Modes with charts to receive a sweep. Cabin mode has none. */
export const SWEEP_MODES = ['analytics', 'compare']

/** Presentation for one axis; the generic ramp for anything unrecognised. */
export function sweepAxis(param) {
  return SWEEP_AXES[param] || GENERIC_AXIS
}

/**
 * The axes to offer, in the engine's own order.
 * @param {Record<string,string>} sweepable the engine's SWEEPABLE map
 * @returns {Array<{key:string, label:string, axis:object}>}
 */
export function sweepAxesFor(sweepable) {
  const source =
    sweepable && Object.keys(sweepable).length ? sweepable : { [DEFAULT_SWEEP_PARAM]: 'seat load factor' }
  return Object.entries(source).map(([key, label]) => ({
    key,
    // The engine writes its labels lower-case ("seat load factor"); the panel
    // wants them as option labels.
    label: String(label).charAt(0).toUpperCase() + String(label).slice(1),
    axis: sweepAxis(key),
  }))
}

/** The parameter this config sweeps, restricted to what the engine allows. */
export function sweepParamOf(config, sweepable) {
  const param = config?.sweepParam || DEFAULT_SWEEP_PARAM
  if (sweepable && !Object.prototype.hasOwnProperty.call(sweepable, param)) return DEFAULT_SWEEP_PARAM
  return param
}

/** The worker's own default replication count for a sweep point. */
export function autoSweepRuns(runs) {
  const n = Number.isFinite(Number(runs)) ? Math.trunc(Number(runs)) : 1
  return Math.max(3, Math.min(12, Math.round(n / 4)))
}

/** Replications per sweep point: the override when there is one, else auto. */
export function sweepRunsFor(config) {
  const override = config?.sweepRuns
  if (override == null) return autoSweepRuns(config?.runs)
  const n = Number(override)
  return Number.isFinite(n) ? Math.max(1, Math.trunc(n)) : autoSweepRuns(config?.runs)
}

/**
 * Coerce a list of sweep points into a legal, ordered, duplicate-free set for
 * one axis. Junk from a pasted config or a link is simply not a sweep point,
 * and a value the axis does not offer is not one either — the chips are the
 * grid, and an arbitrary number would plot a point the panel cannot show.
 */
export function sanitizeSweepValues(param, values, fallback) {
  const axis = sweepAxis(param)
  const allowed = axis.points
  const back = fallback && fallback.length ? fallback : axis.defaults
  if (!Array.isArray(values)) return [...back]
  const seen = new Set()
  for (const raw of values) {
    const n = Number(raw)
    if (!Number.isFinite(n)) continue
    const snapped = axis.integer ? Math.round(n) : Math.round(n * 100) / 100
    if (!allowed.includes(snapped)) continue
    seen.add(snapped)
  }
  const kept = [...seen].sort((a, b) => a - b)
  return kept.length ? kept : [...back]
}

/**
 * Load-factor points, specifically. Retained because load factor is the axis
 * the spec names and the one the config stores in its own key.
 */
export function sanitizeLoadFactors(values, fallback = DEFAULT_SWEEP_LOAD_FACTORS) {
  return sanitizeSweepValues(DEFAULT_SWEEP_PARAM, values, fallback)
}

/**
 * Which config key holds the point list for an axis.
 *
 * Load factor keeps `sweepLoadFactors`: it is the axis the spec is written
 * around, it is what shareable links from before the other axes existed carry,
 * and keeping it separate means switching axis and switching back does not
 * lose the load factors you chose. Every other axis shares `sweepValues`,
 * which is reset to that axis's defaults when the axis changes.
 */
export function sweepValuesKey(param) {
  return param === DEFAULT_SWEEP_PARAM ? 'sweepLoadFactors' : 'sweepValues'
}

/** The selected points for whichever axis this config sweeps. */
export function sweepPointsOf(config, sweepable) {
  const param = sweepParamOf(config, sweepable)
  const stored = config?.[sweepValuesKey(param)]
  return sanitizeSweepValues(param, stored, sweepAxis(param).defaults)
}

/** True when this config asks for a sweep and this mode has charts for it. */
export function sweepEnabled(config, mode) {
  if (!config?.sweepEnabled) return false
  return mode == null || SWEEP_MODES.includes(mode)
}

/**
 * The `sweep` block of the worker's start message, or null.
 * `runs` is always explicit, so the cost shown is the cost paid.
 *
 * `loadFactors` is emitted alongside `values` whatever the axis, because that
 * is the field name the chart and the load-factor-only protocol read; on a
 * non-load-factor sweep it carries that axis's values.
 */
export function sweepSpecFor(config, mode, sweepable) {
  if (!sweepEnabled(config, mode)) return null
  const param = sweepParamOf(config, sweepable)
  const values = sweepPointsOf(config, sweepable)
  return { param, values, loadFactors: values, runs: sweepRunsFor(config) }
}

/** The points in a sweep spec, whichever field the caller filled in. */
export function specValues(sweep) {
  if (!sweep) return []
  if (Array.isArray(sweep.values)) return sweep.values
  if (Array.isArray(sweep.loadFactors)) return sweep.loadFactors
  return []
}

/**
 * What a run will actually cost.
 * @returns {{strategies:number, runs:number, main:number, points:number, sweepRuns:number, sweep:number, total:number}}
 */
export function runCounts({ strategies, runs, sweep }) {
  const s = Math.max(0, Math.trunc(Number(strategies) || 0))
  const r = Math.max(0, Math.trunc(Number(runs) || 0))
  const points = specValues(sweep).length
  const sweepRuns = sweep ? Math.max(1, Math.trunc(Number(sweep.runs) || 1)) : 0
  const main = s * r
  const sweepTotal = s * points * sweepRuns
  return { strategies: s, runs: r, main, points, sweepRuns, sweep: sweepTotal, total: main + sweepTotal }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** "6 points × 3 strategies × 12 replications = 216 runs". */
export function describeSweepCost(counts) {
  return (
    `${plural(counts.points, 'sweep point', 'sweep points')} × ` +
    `${plural(counts.strategies, 'strategy', 'strategies')} × ` +
    `${plural(counts.sweepRuns, 'replication', 'replications')} = ` +
    `${plural(counts.sweep, 'run', 'runs')}`
  )
}

/** "3 strategies × 200 replications = 600 runs". */
export function describeBatchCost(counts) {
  return (
    `${plural(counts.strategies, 'strategy', 'strategies')} × ` +
    `${plural(counts.runs, 'replication', 'replications')} = ` +
    `${plural(counts.main, 'run', 'runs')}`
  )
}
