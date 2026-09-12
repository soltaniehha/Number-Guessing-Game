/**
 * Tick selection.
 *
 * Two families: `niceTicks` for plain linear quantities (rounds to 1/2/2.5/5
 * decades) and `timeTicks` for seconds, which snaps to units a human reads
 * on a clock (15s, 30s, 1m, 5m, ...) instead of 1/2/5 seconds.
 */

const NICE_MULTIPLES = [1, 2, 2.5, 5, 10]
const TIME_STEPS = [
  1, 2, 5, 10, 15, 20, 30,
  60, 120, 180, 300, 600, 900, 1200, 1800,
  3600, 7200, 10800, 21600,
]

/** Round a raw step up to the nearest 1/2/2.5/5 × 10^k. */
export function niceStep(rawStep) {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const normalised = rawStep / magnitude
  const multiple = NICE_MULTIPLES.find((m) => normalised <= m * 1.0000001) ?? 10
  return multiple * magnitude
}

const snap = (value, step) => {
  const scaled = Math.round(value / step) * step
  // kill float dust like 0.30000000000000004
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1)
  return Number(scaled.toFixed(Math.min(12, decimals)))
}

/** Ticks covering [min,max] at roughly `count` intervals, on round values. */
export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  let lo = min
  let hi = max
  if (lo > hi) [lo, hi] = [hi, lo]
  if (lo === hi) return [snap(lo, niceStep(Math.abs(lo) || 1))]
  const step = niceStep((hi - lo) / Math.max(1, count))
  const start = Math.ceil(lo / step - 1e-9) * step
  const out = []
  for (let i = 0; i < 1000; i++) {
    const v = start + i * step
    if (v > hi + step * 1e-9) break
    out.push(snap(v, step))
  }
  return out
}

/** Expand [min,max] outward to round numbers that bracket the data. */
export function niceDomain(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]
  let lo = min
  let hi = max
  if (lo > hi) [lo, hi] = [hi, lo]
  if (lo === hi) {
    const pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 1
    lo -= pad
    hi += pad
  }
  const step = niceStep((hi - lo) / Math.max(1, count))
  return [snap(Math.floor(lo / step) * step, step), snap(Math.ceil(hi / step) * step, step)]
}

/** Pick a clock-friendly step (seconds) for a span, aiming for `count` ticks. */
export function timeStep(spanSeconds, count = 5) {
  const target = spanSeconds / Math.max(1, count)
  return TIME_STEPS.find((s) => s >= target) ?? Math.ceil(target / 3600) * 3600
}

/** Ticks in seconds at clock-friendly intervals. */
export function timeTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  let lo = min
  let hi = max
  if (lo > hi) [lo, hi] = [hi, lo]
  if (hi - lo <= 0) return [lo]
  const step = timeStep(hi - lo, count)
  const start = Math.ceil(lo / step - 1e-9) * step
  const out = []
  for (let i = 0; i < 1000; i++) {
    const v = start + i * step
    if (v > hi + step * 1e-9) break
    out.push(v)
  }
  return out
}

/**
 * Thin a list of tick values so labels never collide: keeps every n-th tick
 * such that at most `maxLabels` remain. Always keeps the first tick.
 */
export function thinTicks(ticks, maxLabels) {
  if (!Array.isArray(ticks) || ticks.length <= maxLabels || maxLabels < 1) return ticks
  const stride = Math.ceil(ticks.length / maxLabels)
  return ticks.filter((_, i) => i % stride === 0)
}
