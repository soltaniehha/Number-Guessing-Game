/**
 * Statistics used by the charts: quantiles, box-plot five-number summaries,
 * histogram binning, and confidence intervals.
 *
 * Everything is defensive about tiny samples, because the dashboard has to
 * render honestly from a single replication.
 */

export const sum = (values) => (values ?? []).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)

export function mean(values) {
  const finite = (values ?? []).filter(Number.isFinite)
  return finite.length ? sum(finite) / finite.length : NaN
}

/** Sample standard deviation (n-1). Returns 0 for n < 2. */
export function stdev(values) {
  const finite = (values ?? []).filter(Number.isFinite)
  if (finite.length < 2) return 0
  const m = mean(finite)
  const ss = finite.reduce((acc, v) => acc + (v - m) ** 2, 0)
  return Math.sqrt(ss / (finite.length - 1))
}

/** Quantile of an already-sorted array (R-7 / linear interpolation). */
export function quantileSorted(sorted, p) {
  if (!sorted || sorted.length === 0) return NaN
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, p))
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo])
}

/** Quantile of an unsorted array. */
export function quantile(values, p) {
  const finite = (values ?? []).filter(Number.isFinite).sort((a, b) => a - b)
  return quantileSorted(finite, p)
}

/**
 * Tukey five-number summary plus fences and outliers.
 * Whiskers reach the most extreme value still inside 1.5·IQR.
 */
export function boxStats(values) {
  const finite = (values ?? []).filter(Number.isFinite).sort((a, b) => a - b)
  if (finite.length === 0) return null
  const q1 = quantileSorted(finite, 0.25)
  const median = quantileSorted(finite, 0.5)
  const q3 = quantileSorted(finite, 0.75)
  const iqr = q3 - q1
  const lowerFence = q1 - 1.5 * iqr
  const upperFence = q3 + 1.5 * iqr
  const inliers = finite.filter((v) => v >= lowerFence && v <= upperFence)
  return {
    n: finite.length,
    min: finite[0],
    max: finite[finite.length - 1],
    q1,
    median,
    q3,
    iqr,
    lowerFence,
    upperFence,
    whiskerLow: inliers.length ? inliers[0] : finite[0],
    whiskerHigh: inliers.length ? inliers[inliers.length - 1] : finite[finite.length - 1],
    outliers: finite.filter((v) => v < lowerFence || v > upperFence),
    mean: mean(finite),
  }
}

/**
 * Build a box summary out of pre-pooled percentile stats (what BatchResult
 * ships) rather than raw values, so chart 8 works without the full sample.
 */
export function boxFromPooled(pooled) {
  if (!pooled) return null
  const pick = (...names) => {
    for (const name of names) {
      const v = pooled[name]
      if (Number.isFinite(v)) return v
    }
    return NaN
  }
  const q1 = pick('p25')
  const median = pick('p50', 'median')
  const q3 = pick('p75')
  if (![q1, median, q3].every(Number.isFinite)) {
    return Array.isArray(pooled.sample) ? boxStats(pooled.sample) : null
  }
  const iqr = q3 - q1
  return {
    n: pooled.n ?? (pooled.sample?.length ?? 0),
    min: pick('min'),
    max: pick('max'),
    q1,
    median,
    q3,
    iqr,
    lowerFence: q1 - 1.5 * iqr,
    upperFence: q3 + 1.5 * iqr,
    whiskerLow: pick('p05', 'min'),
    whiskerHigh: pick('p95', 'max'),
    outliers: [],
    mean: pick('mean'),
    p90: pick('p90'),
  }
}

/**
 * Bin count: Freedman–Diaconis, falling back to Sturges when the IQR is zero
 * (which happens constantly with a 1-run partial batch).
 */
export function binCount(values) {
  const finite = (values ?? []).filter(Number.isFinite)
  const n = finite.length
  if (n < 2) return 1
  const sorted = [...finite].sort((a, b) => a - b)
  const iqr = quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25)
  const span = sorted[n - 1] - sorted[0]
  if (span <= 0) return 1
  const fd = iqr > 0 ? 2 * iqr * Math.pow(n, -1 / 3) : 0
  const count = fd > 0 ? Math.ceil(span / fd) : Math.ceil(Math.log2(n)) + 1
  return Math.max(3, Math.min(30, count))
}

/**
 * Histogram over a shared domain (so faceted strategies stay comparable).
 * Returns bins with `x0`, `x1`, `count` and `density` (count / n, so facets
 * with different run counts overlay honestly).
 */
export function histogram(values, { domain = null, bins = null } = {}) {
  const finite = (values ?? []).filter(Number.isFinite)
  if (finite.length === 0) return { bins: [], binWidth: 0, maxCount: 0, maxDensity: 0, n: 0 }
  const sorted = [...finite].sort((a, b) => a - b)
  const [d0, d1] = domain ?? [sorted[0], sorted[sorted.length - 1]]
  const count = bins ?? binCount(finite)
  const lo = d0
  const hi = d1 > d0 ? d1 : d0 + 1
  const width = (hi - lo) / count
  const out = Array.from({ length: count }, (_, i) => ({
    x0: lo + i * width,
    x1: lo + (i + 1) * width,
    count: 0,
    density: 0,
  }))
  for (const v of finite) {
    if (v < lo || v > hi) continue
    let idx = Math.floor((v - lo) / width)
    if (idx >= count) idx = count - 1
    if (idx < 0) idx = 0
    out[idx].count += 1
  }
  let maxCount = 0
  for (const bin of out) {
    bin.density = bin.count / finite.length
    if (bin.count > maxCount) maxCount = bin.count
  }
  return {
    bins: out,
    binWidth: width,
    maxCount,
    maxDensity: maxCount / finite.length,
    n: finite.length,
  }
}

// Two-sided 95% t critical values, df 1..30; ≥30 uses the normal approximation.
const T95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086,
  2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
]

/** Two-sided 95% critical value for `df` degrees of freedom. */
export function tCritical95(df) {
  if (!Number.isFinite(df) || df < 1) return NaN
  return df <= 30 ? T95[df - 1] : 1.96
}

/**
 * 95% CI of the mean. Accepts either raw values or `{mean, sd, n}` — the
 * BatchResult ships summary stats, but partial batches sometimes only have
 * the raw values array.
 */
export function meanCI(input) {
  let m
  let sd
  let n
  if (Array.isArray(input)) {
    const finite = input.filter(Number.isFinite)
    n = finite.length
    m = mean(finite)
    sd = stdev(finite)
  } else if (input && typeof input === 'object') {
    n = input.n ?? input.runs ?? (Array.isArray(input.values) ? input.values.length : 0)
    m = Number.isFinite(input.mean) ? input.mean : mean(input.values)
    sd = Number.isFinite(input.sd) ? input.sd : stdev(input.values)
  } else {
    return null
  }
  if (!Number.isFinite(m)) return null
  if (!Number.isFinite(n) || n < 2 || !Number.isFinite(sd) || sd === 0) {
    return { mean: m, sd: sd || 0, n: n || 1, halfWidth: 0, lo: m, hi: m, wide: true }
  }
  const halfWidth = tCritical95(n - 1) * (sd / Math.sqrt(n))
  return { mean: m, sd, n, halfWidth, lo: m - halfWidth, hi: m + halfWidth, wide: false }
}

/**
 * Running mean with a 95% CI band, recomputed from the raw values. Used as a
 * fallback when a partial BatchResult has no `convergence` array yet.
 */
export function convergenceSeries(values) {
  const finite = (values ?? []).filter(Number.isFinite)
  const out = []
  let runningSum = 0
  let runningSq = 0
  for (let i = 0; i < finite.length; i++) {
    const v = finite[i]
    runningSum += v
    runningSq += v * v
    const n = i + 1
    const m = runningSum / n
    let ciLow = m
    let ciHigh = m
    if (n >= 2) {
      const variance = Math.max(0, (runningSq - n * m * m) / (n - 1))
      const half = tCritical95(n - 1) * Math.sqrt(variance / n)
      ciLow = m - half
      ciHigh = m + half
    }
    out.push({ n, mean: m, ciLow, ciHigh })
  }
  return out
}

/** Sum of an object's numeric fields, ignoring anything non-finite. */
export function sumFields(obj, keys) {
  if (!obj) return 0
  return keys.reduce((acc, k) => acc + (Number.isFinite(obj[k]) ? obj[k] : 0), 0)
}
