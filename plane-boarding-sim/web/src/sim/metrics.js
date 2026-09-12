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
