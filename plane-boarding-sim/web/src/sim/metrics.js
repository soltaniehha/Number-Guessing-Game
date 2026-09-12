/**
 * Result schema (ENGINE_SPEC 7) and the summary statistics built on top of it.
 *
 * Port of `python/plane_boarding/metrics.py`.
 */
import { pySum } from './pyutil.js'

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
    return (1.96 * this.sd) / Math.sqrt(this.n)
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
  return [mean, sd, (1.96 * sd) / Math.sqrt(n)]
}
