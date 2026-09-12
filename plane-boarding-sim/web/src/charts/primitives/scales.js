/**
 * Minimal scale kit — linear, band, and a time (seconds) scale.
 *
 * Each scale is a plain function with metadata hung off it, so charts can call
 * `x(value)` directly and still reach `x.ticks()` / `x.invert()`.
 */
import { niceTicks, timeTicks, niceDomain } from './ticks.js'

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/** [min,max] of an array, optionally through an accessor. Ignores non-finite. */
export function extent(values, accessor = (d) => d) {
  let min = Infinity
  let max = -Infinity
  for (const item of values ?? []) {
    const v = accessor(item)
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  return Number.isFinite(min) ? [min, max] : [0, 0]
}

/** Continuous linear scale. */
export function linearScale({ domain = [0, 1], range = [0, 1], nice = false, clamp: doClamp = false } = {}) {
  let [d0, d1] = nice ? niceDomain(domain[0], domain[1]) : domain
  if (d0 === d1) {
    const pad = Math.abs(d0) > 0 ? Math.abs(d0) * 0.5 : 0.5
    d0 -= pad
    d1 += pad
  }
  const [r0, r1] = range
  const span = d1 - d0
  const scale = (value) => {
    if (!Number.isFinite(value)) return NaN
    const t = (value - d0) / span
    const out = r0 + t * (r1 - r0)
    return doClamp ? clamp(out, Math.min(r0, r1), Math.max(r0, r1)) : out
  }
  scale.kind = 'linear'
  scale.domain = () => [d0, d1]
  scale.range = () => [r0, r1]
  scale.invert = (px) => d0 + ((px - r0) / (r1 - r0)) * span
  scale.ticks = (count = 5) => niceTicks(d0, d1, count)
  return scale
}

/**
 * Time scale over *seconds*. Identical arithmetic to linear, different tick
 * selection (clock-friendly steps) — which is the whole reason it exists.
 */
export function timeScale({ domain = [0, 60], range = [0, 1] } = {}) {
  const base = linearScale({ domain, range })
  const scale = (value) => base(value)
  scale.kind = 'time'
  scale.domain = base.domain
  scale.range = base.range
  scale.invert = base.invert
  scale.ticks = (count = 5) => {
    const [d0, d1] = base.domain()
    return timeTicks(d0, d1, count)
  }
  return scale
}

/**
 * Band scale for categorical positions.
 * `padding` is the fraction of each step given away as air (dataviz: the
 * band's leftover *is* the spacing; bars never fill their slot).
 */
export function bandScale({ domain = [], range = [0, 1], padding = 0.28, paddingOuter = null } = {}) {
  const keys = [...domain]
  const [r0, r1] = range
  const n = keys.length || 1
  const outer = paddingOuter == null ? padding / 2 : paddingOuter
  const totalSpan = r1 - r0
  const step = totalSpan / (n - padding + 2 * outer || 1)
  const bandwidth = Math.max(0, step * (1 - padding))
  const index = new Map(keys.map((k, i) => [k, i]))
  const scale = (key) => {
    const i = index.get(key)
    if (i == null) return NaN
    return r0 + outer * step + i * step
  }
  scale.kind = 'band'
  scale.domain = () => keys
  scale.range = () => [r0, r1]
  scale.bandwidth = () => bandwidth
  scale.step = () => step
  scale.center = (key) => scale(key) + bandwidth / 2
  scale.invert = (px) => {
    const i = Math.floor((px - r0 - outer * step) / step)
    return keys[clamp(i, 0, keys.length - 1)]
  }
  return scale
}

/**
 * Cap a bar's thickness. dataviz caps bars at 24px and lets the leftover of
 * the band be air, so a two-bar chart does not render two slabs.
 */
export const cappedBand = (bandwidth, cap = 24) => Math.min(bandwidth, cap)

/** Offset that keeps a capped bar centred in its band. */
export const bandInset = (bandwidth, cap = 24) => Math.max(0, (bandwidth - cap) / 2)
