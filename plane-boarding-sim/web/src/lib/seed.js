/**
 * Seed arithmetic, in one place.
 *
 * The Monte Carlo driver and the batch worker both derive a per-replication
 * seed from `config.seed`, and they used to do it differently: the worker with
 * `Math.trunc`, the main-thread runner with `config.seed | 0`. Those are not
 * the same function. `|0` is a 32-bit operation, so it wraps: seed 3_000_000_000
 * becomes -1_294_967_296, and a seed that arrived as the string "12" from a
 * pasted config becomes... 12 in one path and 12 in the other, but "1e9"
 * becomes 0 under `|0` and 1_000_000_000 under `Math.trunc(Number(...))`.
 * Common random numbers only work if every path draws the same sequence, so
 * this is the single definition both use.
 *
 * `Math.trunc` semantics are the ones kept: they are the worker's, and the
 * worker is what actually runs in the app.
 */

/** The base seed of a config: a whole number, 0 when there is not one. */
export function baseSeedOf(config) {
  const raw = Number(config?.seed)
  return Number.isFinite(raw) ? Math.trunc(raw) : 0
}

/** The seed of replication `run` (0-based) of a batch. */
export function seedForRun(config, run) {
  return baseSeedOf(config) + run
}
