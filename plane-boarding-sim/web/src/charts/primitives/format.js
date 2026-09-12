/**
 * Number / duration formatters.
 *
 * dataviz: durations are *never* shown as raw seconds. Axis ticks and value
 * labels use `m:ss`; prose and tooltips use the long form (`7m 12s`).
 * Columns of numbers get tabular figures via the `.num` class in CSS; large
 * standalone figures deliberately do not.
 */

const pad2 = (n) => (n < 10 ? `0${n}` : `${n}`)

/** `432` -> `7:12`, `3782` -> `1:03:02`. Negative and non-finite inputs are safe. */
export function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const sign = seconds < 0 ? '-' : ''
  const total = Math.round(Math.abs(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${sign}${h}:${pad2(m)}:${pad2(s)}` : `${sign}${m}:${pad2(s)}`
}

/** `432` -> `7m 12s`, `48` -> `48s`, `3782` -> `1h 3m`. */
export function formatDurationLong(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const sign = seconds < 0 ? '-' : ''
  const total = Math.round(Math.abs(seconds))
  if (total < 60) return `${sign}${total}s`
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${sign}${h}h ${m}m`
  return s === 0 ? `${sign}${m}m` : `${sign}${m}m ${s}s`
}

/**
 * Axis-tick duration. Whole minutes collapse to `7m` so a time axis does not
 * read as a wall of `:00`s; anything finer keeps `m:ss`.
 */
export function formatDurationTick(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return ''
  const total = Math.round(seconds)
  if (total === 0) return '0'
  if (total % 60 === 0) {
    const m = total / 60
    return m % 60 === 0 && m >= 60 ? `${m / 60}h` : `${m}m`
  }
  return formatDuration(total)
}

/** Fixed-precision number with thousands separators. */
export function formatNumber(value, digits = 0) {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** Axis-friendly number: drops trailing zeros, compacts thousands. */
export function formatTick(value) {
  if (value == null || !Number.isFinite(value)) return ''
  const abs = Math.abs(value)
  if (abs >= 1000) {
    const k = value / 1000
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`
  }
  if (Number.isInteger(value)) return `${value}`
  if (abs >= 10) return value.toFixed(0)
  if (abs >= 1) return value.toFixed(1)
  return value.toFixed(2)
}

/** `0.873` -> `87%` (fraction in 0..1). */
export function formatPercent(fraction, digits = 0) {
  if (fraction == null || !Number.isFinite(fraction)) return '—'
  return `${(fraction * 100).toFixed(digits)}%`
}

/** `87.3` -> `87%` (value already in 0..100). */
export function formatPercentValue(value, digits = 0) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

/** Signed delta, e.g. `+42s` / `-1m 5s`. */
export function formatSignedDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const body = formatDurationLong(Math.abs(seconds))
  return `${seconds >= 0 ? '+' : '−'}${body}`
}

/** Seat id from row + letter, e.g. 12 + 'C' -> `12C`. */
export const seatId = (row, letter) => `${row}${letter}`
