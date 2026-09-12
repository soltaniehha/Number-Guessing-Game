/**
 * Result schema (ENGINE_SPEC 7) and the summary statistics built on top of it.
 *
 * Port of `python/plane_boarding/metrics.py`.
 */
import { pySum } from './pyutil.js'

/**
 * Two-sided 95% t critical values for df = 1..30. Above 30 the normal
 * approximation is within 0.5% and 1.96 is used.
 */
const T95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086,
  2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
]

/**
 * Two-sided 95% critical value for `df` degrees of freedom.
 *
 * A flat 1.96 is the LARGE-SAMPLE limit, and this project routinely reports
 * n = 5..25: at n=5 it understates the interval by 41.6%, at n=8 by 20.7%, at
 * n=12 by 12.3%, and only past n≈50 does the gap fall below 0.5%. Reporting a
 * "95% interval" that is 40% too narrow is not a rounding difference -- it
 * changes which strategy comparisons read as significant, which is the one
 * question this tool exists to answer.
 *
 * The same table `charts/primitives/stats.js` uses, so a number drawn on a
 * chart and the same number in a batch result agree.
 */
export function tCritical95(df) {
  if (!Number.isFinite(df) || df < 1) return NaN
  return df <= 30 ? T95[df - 1] : 1.96
}


/**
 * Linear-interpolated percentile on an already-sorted sequence.
 *
 * Spelled out rather than delegated because the Python engine reproduces it
 * exactly, and every language's built-in disagrees about interpolation.
 */
export function percentile(sortedValues, q) {
  const n = sortedValues.length
  if (n === 0) return 0.0
  if (n === 1) return Number(sortedValues[0])
  const pos = q * (n - 1)
  const lo = Math.trunc(pos)
  const hi = Math.min(lo + 1, n - 1)
  const frac = pos - lo
  return Number(sortedValues[lo]) * (1.0 - frac) + Number(sortedValues[hi]) * frac
}

/** mean / sd / min / max / p05 / p50 / p95 over a sample. */
export class Aggregate {
  constructor(values, keepValues = true) {
    const vals = Array.from(values, Number)
    const n = vals.length
    this.n = n
    this.values = keepValues ? vals : []
    if (n === 0) {
      this.mean = 0.0
      this.sd = 0.0
      this.min = 0.0
      this.max = 0.0
      this.p05 = 0.0
      this.p50 = 0.0
      this.p95 = 0.0
      return
    }
    const mean = pySum(vals) / n
    let variance = 0.0
    if (n > 1) {
      const squares = vals.map((v) => (v - mean) ** 2)
      variance = pySum(squares) / (n - 1)
    }
    const s = vals.slice().sort((a, b) => a - b)
    this.mean = mean
    this.sd = Math.sqrt(variance)
    this.min = s[0]
    this.max = s[n - 1]
    this.p05 = percentile(s, 0.05)
    this.p50 = percentile(s, 0.5)
    this.p95 = percentile(s, 0.95)
  }

  /** Half-width of the 95% confidence interval on the mean. */
  get ci95() {
    if (this.n < 2) return 0.0
    return (tCritical95(this.n - 1) * this.sd) / Math.sqrt(this.n)
  }

  toDict(keepValues = false) {
    const d = {
      n: this.n,
      mean: this.mean,
      sd: this.sd,
      min: this.min,
      max: this.max,
      p05: this.p05,
      p50: this.p50,
      p95: this.p95,
      ci95: this.ci95,
    }
    if (keepValues) d.values = this.values.slice()
    return d
  }
}

/**
 * Paired comparison of two strategies run under common random numbers.
 *
 * With CRN, replication `i` of every strategy faces the SAME passenger manifest
 * -- same bags, same walk speeds, same parties -- because the `pax` stream is
 * seeded independently of the `order` stream. The difference `T_a[i] - T_b[i]`
 * therefore removes the manifest as a source of variance entirely, and a
 * confidence interval on the mean of those differences is both the
 * statistically correct analysis and a far more powerful one than comparing two
 * marginal intervals. Two strategies whose marginal intervals overlap heavily
 * can still be separated with certainty by the paired test; that is the whole
 * reason for running CRN in the first place.
 *
 * Sign convention: negative means `a` is FASTER than `b`.
 */
export class PairedDifference {
  constructor(a, b, baseline = '') {
    if (a.length !== b.length) {
      throw new Error(
        `cannot pair ${a.length} replications against ${b.length} -- the two ` +
          'batches must be the same length and run on the same seeds',
      )
    }
    this.baseline = baseline
    const n = a.length
    this.n = n
    const diffs = []
    for (let i = 0; i < n; i++) diffs.push(a[i] - b[i])
    const ratios = []
    for (let i = 0; i < n; i++) if (b[i] > 0) ratios.push(a[i] / b[i])
    const [mean, sd, ci95] = meanSdCi(diffs)
    this.mean = mean
    this.sd = sd
    this.ci95 = ci95
    this.lo = this.mean - this.ci95
    this.hi = this.mean + this.ci95
    const [meanRatio, , ratioCi95] = meanSdCi(ratios)
    this.meanRatio = meanRatio
    this.ratioCi95 = ratioCi95
    this.ratioLo = this.meanRatio - this.ratioCi95
    this.ratioHi = this.meanRatio + this.ratioCi95
    // A difference is real when its interval excludes zero.
    this.significant = this.lo > 0.0 || this.hi < 0.0
  }

  toDict() {
    return {
      baseline: this.baseline,
      n: this.n,
      mean: this.mean,
      sd: this.sd,
      ci95: this.ci95,
      lo: this.lo,
      hi: this.hi,
      meanRatio: this.meanRatio,
      ratioCi95: this.ratioCi95,
      ratioLo: this.ratioLo,
      ratioHi: this.ratioHi,
      significant: this.significant,
    }
  }
}

function meanSdCi(values) {
  const n = values.length
  if (n === 0) return [0.0, 0.0, 0.0]
  const mean = pySum(values) / n
  if (n < 2) return [mean, 0.0, 0.0]
  const squares = values.map((v) => (v - mean) ** 2)
  const variance = pySum(squares) / (n - 1)
  const sd = Math.sqrt(variance)
  return [mean, sd, (tCritical95(n - 1) * sd) / Math.sqrt(n)]
}
