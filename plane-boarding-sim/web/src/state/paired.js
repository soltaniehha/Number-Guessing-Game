/**
 * Paired comparison of two strategies, and the shared ranks that follow from it.
 *
 * This is the app-layer counterpart of `sim/metrics.js`'s `PairedDifference`
 * and `python/plane_boarding/cli.py`'s `shared_ranks_paired`. It is restated
 * here rather than imported because `state/` must not depend on `src/sim/`
 * (see `lib/engineBridge.js` — the engine may be the fixture one), and because
 * the web batch result carries the per-replication values it needs anyway.
 *
 * ## Why paired, and why it matters for a ranking
 *
 * Every strategy in a comparison is run over the SAME seed sequence — common
 * random numbers — so replication `i` of each faces an identical passenger
 * manifest. The difference `T_a[i] - T_b[i]` therefore cancels the manifest
 * out. The samples are correlated, which means the independent-samples
 * reasoning behind "their error bars overlap, so we cannot tell them apart" is
 * simply not valid here: the paired interval is the correct one, and usually
 * the much tighter one.
 *
 * The ranking uses it. Two strategies share a rank only when the interval on
 * their paired difference contains zero.
 */

import { tCritical95 } from './aggregate.js'

/** Mean, sd and 95% half-width of a sample, using t(n-1). */
function meanSdCi(values) {
  const n = values.length
  if (n === 0) return { mean: 0, sd: 0, ci95: 0 }
  const mean = values.reduce((a, b) => a + b, 0) / n
  if (n < 2) return { mean, sd: 0, ci95: 0 }
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1)
  const sd = Math.sqrt(variance)
  return { mean, sd, ci95: tCritical95(n - 1) * (sd / Math.sqrt(n)) }
}

/**
 * Paired difference `a - b` over matched replications. Negative = `a` faster.
 *
 * A partial batch can have one strategy a replication or two ahead of another,
 * so the common prefix is used: under CRN those entries are still matched, and
 * refusing to report anything until the counts line up would leave the table
 * unranked for the whole of a long run.
 *
 * @returns {null|{n, mean, sd, ci95, lo, hi, meanRatio, significant}}
 */
export function pairedDifference(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return null
  const n = Math.min(a.length, b.length)
  if (n < 2) return null
  const diffs = []
  const ratios = []
  for (let i = 0; i < n; i += 1) {
    const x = Number(a[i])
    const y = Number(b[i])
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    diffs.push(x - y)
    if (y > 0) ratios.push(x / y)
  }
  const { mean, sd, ci95 } = meanSdCi(diffs)
  const lo = mean - ci95
  const hi = mean + ci95
  return {
    n,
    mean,
    sd,
    ci95,
    lo,
    hi,
    meanRatio: meanSdCi(ratios).mean,
    // A difference is real when its interval excludes zero.
    significant: lo > 0 || hi < 0,
  }
}

/**
 * Competition ranking (1, =2, =2, 4, ...) over a fastest-first list.
 *
 * Ties are tested against the group LEADER rather than the previous entry:
 * "not distinguishable from its neighbour" is not transitive, and chaining it
 * merges an entire table into one tie.
 */
function rankBy(n, tiesWithLeader) {
  const ranks = []
  let leader = 0
  for (let i = 0; i < n; i += 1) {
    if (i === 0) ranks.push(1)
    else if (tiesWithLeader(i, leader)) ranks.push(ranks[leader])
    else {
      leader = i
      ranks.push(i + 1)
    }
  }
  return ranks
}

/** Ranks from MARGINAL intervals: overlapping CIs share a rank. */
export function sharedRanksMarginal(means, halfwidths) {
  return rankBy(means.length, (i, lead) => means[i] - halfwidths[i] <= means[lead] + halfwidths[lead])
}

/** Ranks from the PAIRED difference, which is the correct test. */
export function sharedRanksPaired(series) {
  return rankBy(series.length, (i, lead) => {
    const pd = pairedDifference(series[i], series[lead])
    // No usable pairing (a strategy with a single replication, mismatched
    // lengths) falls back to the marginal question this row can answer: with
    // nothing to separate them on, call it a tie rather than invent an order.
    return pd ? !pd.significant : true
  })
}

/**
 * Rank a set of summary rows, fastest first.
 *
 * @param {Array<{key, mean, ci95, values}>} rows already sorted fastest-first
 * @returns {{ranks: number[], tied: Set<number>, paired: boolean, marginal: number[]}}
 */
export function rankRows(rows) {
  const series = rows.map((r) => (Array.isArray(r.values) ? r.values : []))
  const usable = series.length > 1 && series.every((s) => s.length >= 2)
  const marginal = sharedRanksMarginal(rows.map((r) => r.mean), rows.map((r) => r.ci95 || 0))
  const ranks = usable ? sharedRanksPaired(series) : marginal
  const counts = new Map()
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1)
  const tied = new Set([...counts.entries()].filter(([, c]) => c > 1).map(([r]) => r))
  return { ranks, tied, paired: usable, marginal }
}
