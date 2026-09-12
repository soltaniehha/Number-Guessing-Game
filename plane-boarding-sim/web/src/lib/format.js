/**
 * Formatting helpers. Every live figure in the UI goes through one of these so
 * that digit widths are stable and rounding is consistent across the app.
 */

/** Seconds -> "mm:ss" (or "h:mm:ss" past an hour). */
export function fmtClock(seconds) {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const whole = Math.floor(s)
  const hh = Math.floor(whole / 3600)
  const mm = Math.floor((whole % 3600) / 60)
  const ss = whole % 60
  const pad = (n) => String(n).padStart(2, '0')
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`
}

/** Fixed-decimal number, never exponential, never "-0". */
export function fmtNum(value, digits = 2) {
  if (!Number.isFinite(value)) return '—'
  const out = value.toFixed(digits)
  return out === (0).toFixed(digits) ? out : out.replace(/^-0(\.0*)?$/, '0$1')
}

/** 0..1 -> "92%" (or "92.5%" with digits = 1). */
export function fmtPct(fraction, digits = 0) {
  if (!Number.isFinite(fraction)) return '—'
  return `${(fraction * 100).toFixed(digits)}%`
}

/** Seconds with a unit suffix, scaled for readability. */
export function fmtSeconds(seconds, digits = 1) {
  if (!Number.isFinite(seconds)) return '—'
  if (Math.abs(seconds) < 60) return `${fmtNum(seconds, digits)}s`
  return `${fmtNum(seconds / 60, digits)}m`
}

/** Integer with thousands separators. */
export function fmtInt(value) {
  if (!Number.isFinite(value)) return '—'
  return Math.round(value).toLocaleString('en-US')
}

/** Human label for a speed multiplier. */
export function fmtSpeed(mult) {
  return `${fmtNum(mult, mult < 1 ? 2 : 0)}×`
}

/** Turn a camelCase config key into a spaced label ("stowBaseMean" -> "Stow base mean"). */
export function humanizeKey(key) {
  const spaced = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Round to a slider step so floating point noise never reaches the config. */
export function snap(value, step) {
  if (!Number.isFinite(step) || step <= 0) return value
  const decimals = (String(step).split('.')[1] || '').length
  return Number((Math.round(value / step) * step).toFixed(decimals))
}
