/**
 * The load-factor sweep: the second axis chart 7 (UI_SPEC section 2) plots.
 *
 * A sweep re-runs every strategy at each of several load factors, so it
 * multiplies an already-large batch by the number of points. It is therefore
 * opt-in, it gets its own (smaller) replication count, and the panel shows the
 * resulting arithmetic before anything starts.
 *
 * The worker (`src/sim/batchWorker.js`) owns the protocol:
 *   {type:'start', config, strategies, runs, sweep:{loadFactors:[...], runs?:N}}
 * and defaults `sweep.runs` to `max(3, min(12, round(runs / 4)))`. That rule is
 * restated here — `autoSweepRuns` — so the panel can *show* the number rather
 * than leave it implicit, and every spec this module builds carries an explicit
 * `runs` so what the user is told and what the worker does cannot drift.
 */

/** The load-factor points the panel offers. */
export const SWEEP_POINTS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]

/** The points a sweep starts with: half-empty up to full. */
export const DEFAULT_SWEEP_LOAD_FACTORS = [0.5, 0.6, 0.7, 0.8, 0.9, 1]

/** Modes with charts to receive a sweep. Cabin mode has none. */
export const SWEEP_MODES = ['analytics', 'compare']

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
 * Coerce a list of load factors into a legal, ordered, duplicate-free set.
 * Junk from a pasted config or a link is simply not a load factor.
 */
export function sanitizeLoadFactors(values, fallback = DEFAULT_SWEEP_LOAD_FACTORS) {
  if (!Array.isArray(values)) return [...fallback]
  const seen = new Set()
  for (const raw of values) {
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0 || n > 1) continue
    seen.add(Math.round(n * 100) / 100)
  }
  const kept = [...seen].sort((a, b) => a - b)
  return kept.length ? kept : [...fallback]
}

/** True when this config asks for a sweep and this mode has charts for it. */
export function sweepEnabled(config, mode) {
  if (!config?.sweepEnabled) return false
  return mode == null || SWEEP_MODES.includes(mode)
}

/**
 * The `sweep` block of the worker's start message, or null.
 * `runs` is always explicit, so the cost shown is the cost paid.
 */
export function sweepSpecFor(config, mode) {
  if (!sweepEnabled(config, mode)) return null
  return {
    loadFactors: sanitizeLoadFactors(config.sweepLoadFactors),
    runs: sweepRunsFor(config),
  }
}

/**
 * What a run will actually cost.
 * @returns {{strategies:number, runs:number, main:number, points:number, sweepRuns:number, sweep:number, total:number}}
 */
export function runCounts({ strategies, runs, sweep }) {
  const s = Math.max(0, Math.trunc(Number(strategies) || 0))
  const r = Math.max(0, Math.trunc(Number(runs) || 0))
  const points = sweep && Array.isArray(sweep.loadFactors) ? sweep.loadFactors.length : 0
  const sweepRuns = sweep ? Math.max(1, Math.trunc(Number(sweep.runs) || 1)) : 0
  const main = s * r
  const sweepTotal = s * points * sweepRuns
  return { strategies: s, runs: r, main, points, sweepRuns, sweep: sweepTotal, total: main + sweepTotal }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** "6 load factors × 3 strategies × 12 replications = 216 runs". */
export function describeSweepCost(counts) {
  return (
    `${plural(counts.points, 'load factor', 'load factors')} × ` +
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
