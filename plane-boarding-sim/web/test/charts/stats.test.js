import { describe, it, expect } from 'vitest'
import {
  mean,
  stdev,
  quantile,
  quantileSorted,
  boxStats,
  boxFromPooled,
  binCount,
  histogram,
  meanCI,
  tCritical95,
  convergenceSeries,
  sumFields,
} from '../../src/charts/primitives/stats.js'

describe('mean / stdev', () => {
  it('computes the sample standard deviation (n-1)', () => {
    expect(mean([2, 4, 4, 4, 5, 5, 7, 9])).toBe(5)
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4)
  })

  it('returns 0 sd for fewer than two values', () => {
    expect(stdev([7])).toBe(0)
    expect(stdev([])).toBe(0)
  })

  it('ignores non-finite values', () => {
    expect(mean([1, null, 3, Number.NaN])).toBe(2)
  })
})

describe('quantiles', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

  it('interpolates linearly (R-7)', () => {
    expect(quantile(values, 0)).toBe(1)
    expect(quantile(values, 0.5)).toBe(5.5)
    expect(quantile(values, 1)).toBe(10)
    expect(quantile(values, 0.25)).toBeCloseTo(3.25, 10)
    expect(quantile(values, 0.75)).toBeCloseTo(7.75, 10)
  })

  it('sorts unsorted input', () => {
    expect(quantile([10, 1, 5], 0.5)).toBe(5)
  })

  it('handles single values and empties', () => {
    expect(quantileSorted([42], 0.9)).toBe(42)
    expect(Number.isNaN(quantileSorted([], 0.5))).toBe(true)
  })

  it('clamps p outside 0..1', () => {
    expect(quantile(values, -1)).toBe(1)
    expect(quantile(values, 2)).toBe(10)
  })
})

describe('boxStats', () => {
  it('produces a Tukey five-number summary', () => {
    const box = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(box.min).toBe(1)
    expect(box.q1).toBe(3)
    expect(box.median).toBe(5)
    expect(box.q3).toBe(7)
    expect(box.max).toBe(9)
    expect(box.iqr).toBe(4)
    expect(box.outliers).toEqual([])
  })

  it('finds outliers beyond 1.5 IQR and pulls whiskers back to real data', () => {
    const box = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100])
    expect(box.outliers).toContain(100)
    expect(box.whiskerHigh).toBe(9)
    expect(box.whiskerHigh).toBeLessThan(box.upperFence)
  })

  it('returns null for no data', () => {
    expect(boxStats([])).toBeNull()
  })
})

describe('boxFromPooled', () => {
  it('builds a box from pooled percentile stats', () => {
    const box = boxFromPooled({ n: 171, p05: 40, p25: 90, p50: 130, p75: 190, p90: 260, p95: 300, min: 20, max: 480, mean: 150 })
    expect(box.median).toBe(130)
    expect(box.iqr).toBe(100)
    expect(box.whiskerLow).toBe(40)
    expect(box.whiskerHigh).toBe(300)
    expect(box.p90).toBe(260)
  })

  it('falls back to the raw sample when percentiles are missing', () => {
    const box = boxFromPooled({ sample: [1, 2, 3, 4, 5] })
    expect(box.median).toBe(3)
  })

  it('returns null when there is nothing at all', () => {
    expect(boxFromPooled(null)).toBeNull()
    expect(boxFromPooled({})).toBeNull()
  })
})

describe('histogram binning', () => {
  it('falls back to Sturges when the IQR is zero', () => {
    expect(binCount([5, 5, 5, 5, 5])).toBe(1)
    expect(binCount([1])).toBe(1)
  })

  it('uses Freedman–Diaconis and stays inside sane limits', () => {
    const values = Array.from({ length: 200 }, (_, i) => i)
    const count = binCount(values)
    expect(count).toBeGreaterThanOrEqual(3)
    expect(count).toBeLessThanOrEqual(30)
  })

  it('bins over an explicit shared domain, losing nothing', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const h = histogram(values, { domain: [0, 10], bins: 5 })
    expect(h.bins).toHaveLength(5)
    expect(h.bins.reduce((a, b) => a + b.count, 0)).toBe(values.length)
    expect(h.binWidth).toBe(2)
  })

  it('reports density as a fraction of n so facets are comparable', () => {
    const h = histogram([1, 1, 1, 5], { domain: [0, 8], bins: 4 })
    const total = h.bins.reduce((a, b) => a + b.density, 0)
    expect(total).toBeCloseTo(1, 10)
    expect(h.maxDensity).toBeCloseTo(0.75, 10)
  })

  it('puts the domain maximum in the last bin, not out of range', () => {
    const h = histogram([10], { domain: [0, 10], bins: 5 })
    expect(h.bins[4].count).toBe(1)
  })

  it('returns an empty result rather than throwing', () => {
    expect(histogram([]).bins).toEqual([])
  })
})

describe('confidence intervals', () => {
  it('uses t for small samples and z for large ones', () => {
    expect(tCritical95(1)).toBeCloseTo(12.706, 3)
    expect(tCritical95(9)).toBeCloseTo(2.262, 3)
    expect(tCritical95(200)).toBe(1.96)
  })

  it('computes a symmetric CI of the mean from raw values', () => {
    const ci = meanCI([10, 12, 14, 16, 18])
    expect(ci.mean).toBe(14)
    expect(ci.sd).toBeCloseTo(3.1623, 3)
    // t(4) = 2.776, se = 3.1623/sqrt(5) = 1.4142
    expect(ci.halfWidth).toBeCloseTo(2.776 * 1.4142, 3)
    expect(ci.hi - ci.mean).toBeCloseTo(ci.mean - ci.lo, 10)
  })

  it('accepts summary stats instead of raw values', () => {
    const ci = meanCI({ mean: 900, sd: 60, n: 100 })
    expect(ci.halfWidth).toBeCloseTo(1.96 * 6, 6)
  })

  it('degrades to a zero-width interval for a single run', () => {
    const ci = meanCI({ mean: 900, sd: 0, n: 1 })
    expect(ci.wide).toBe(true)
    expect(ci.lo).toBe(900)
    expect(ci.hi).toBe(900)
  })

  it('narrows as n grows', () => {
    const small = meanCI({ mean: 900, sd: 60, n: 10 })
    const large = meanCI({ mean: 900, sd: 60, n: 200 })
    expect(large.halfWidth).toBeLessThan(small.halfWidth)
  })

  it('returns null for nothing', () => {
    expect(meanCI(null)).toBeNull()
  })
})

describe('convergenceSeries', () => {
  const series = convergenceSeries([10, 20, 30, 40, 50])

  it('emits one point per replication with a running mean', () => {
    expect(series).toHaveLength(5)
    expect(series[0]).toMatchObject({ n: 1, mean: 10 })
    expect(series[4].mean).toBe(30)
  })

  it('has no interval at n = 1 and a shrinking one after', () => {
    expect(series[0].ciLow).toBe(series[0].ciHigh)
    const widths = series.slice(1).map((p) => p.ciHigh - p.ciLow)
    expect(widths[widths.length - 1]).toBeLessThan(widths[0])
  })

  it('matches meanCI at the final point', () => {
    const ci = meanCI([10, 20, 30, 40, 50])
    expect(series[4].ciLow).toBeCloseTo(ci.lo, 8)
    expect(series[4].ciHigh).toBeCloseTo(ci.hi, 8)
  })
})

describe('sumFields', () => {
  it('adds only the finite named fields', () => {
    expect(sumFields({ a: 1, b: 2, c: 'x' }, ['a', 'b', 'c'])).toBe(3)
    expect(sumFields(null, ['a'])).toBe(0)
  })
})
