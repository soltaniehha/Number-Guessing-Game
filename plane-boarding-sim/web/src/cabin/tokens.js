/**
 * Colour-token resolution for the cabin canvas.
 *
 * A canvas cannot inherit CSS custom properties, so every colour it paints is
 * read out of `src/theme.css` with `getComputedStyle` and re-read whenever the
 * theme changes. There are no hardcoded colours anywhere in `src/cabin/`.
 */

/** Every token the cabin renderer is allowed to use. */
export const TOKEN_NAMES = Object.freeze([
  'bg',
  'surface',
  'surface-2',
  'surface-3',
  'border',
  'border-strong',
  'text',
  'text-2',
  'text-3',
  'text-inv',
  'accent',
  'accent-soft',
  'state-waiting',
  'state-walking',
  'state-stowing',
  'state-seated',
  'class-first',
  'class-business',
  'class-premium',
  'class-economy',
  'heat-0',
  'heat-1',
  'heat-2',
  'heat-3',
  'heat-4',
  'heat-5',
  'good',
  'warn',
  'bad',
])

/** Heat ramp, coldest first — used for the aisle wash. */
export const HEAT_TOKENS = Object.freeze([
  'heat-0',
  'heat-1',
  'heat-2',
  'heat-3',
  'heat-4',
  'heat-5',
])

/** Passenger state code -> colour token. */
export const STATE_TOKENS = Object.freeze([
  'state-waiting', // 0 QUEUED
  'state-walking', // 1 WALKING
  'state-stowing', // 2 STOWING
  'state-stowing', // 3 SHUFFLING
  'state-seated', // 4 SEATED
])

/** Cabin classKey -> colour token. */
export const CLASS_TOKENS = Object.freeze({
  first: 'class-first',
  business: 'class-business',
  premium: 'class-premium',
  economy: 'class-economy',
})

/**
 * Read every token off an element's computed style.
 *
 * @param {Element} [element] defaults to `document.documentElement`
 * @returns {Record<string,string>} token name (without `--`) -> CSS colour
 */
export function readTokens(element) {
  const out = Object.create(null)
  const doc = typeof document !== 'undefined' ? document : null
  const el = element || (doc ? doc.documentElement : null)
  const view = el && el.ownerDocument && el.ownerDocument.defaultView
  if (!el || !view || typeof view.getComputedStyle !== 'function') {
    for (const name of TOKEN_NAMES) out[name] = 'transparent'
    return out
  }
  const cs = view.getComputedStyle(el)
  for (const name of TOKEN_NAMES) {
    const raw = cs.getPropertyValue(`--${name}`)
    out[name] = raw ? raw.trim() : 'transparent'
  }
  return out
}

/**
 * Resolve the token for a cabin class, falling back to economy so an unknown
 * classKey still paints something sane.
 */
export function classToken(classKey) {
  return CLASS_TOKENS[classKey] || CLASS_TOKENS.economy
}

/** Resolve the token for a passenger state code. */
export function stateToken(state) {
  return STATE_TOKENS[state] || STATE_TOKENS[0]
}

// ---------------------------------------------------------------------------
// Colour maths (no literals — everything derives from a resolved token)
// ---------------------------------------------------------------------------

const HEX_SHORT = /^#([\da-f])([\da-f])([\da-f])([\da-f])?$/i
const HEX_LONG = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})([\da-f]{2})?$/i
const FUNCTIONAL = /^rgba?\(([^)]+)\)$/i

/**
 * Parse a CSS colour into `[r, g, b, a]`, or `null` if it is not a form we
 * can decompose (in which case callers fall back to `ctx.globalAlpha`).
 */
export function parseColor(input) {
  if (typeof input !== 'string') return null
  const value = input.trim()
  if (!value) return null

  let m = HEX_LONG.exec(value)
  if (m) {
    return [
      parseInt(m[1], 16),
      parseInt(m[2], 16),
      parseInt(m[3], 16),
      m[4] === undefined ? 1 : parseInt(m[4], 16) / 255,
    ]
  }
  m = HEX_SHORT.exec(value)
  if (m) {
    const dup = (h) => parseInt(h + h, 16)
    return [
      dup(m[1]),
      dup(m[2]),
      dup(m[3]),
      m[4] === undefined ? 1 : dup(m[4]) / 255,
    ]
  }
  m = FUNCTIONAL.exec(value)
  if (m) {
    const parts = m[1].split(/[,/\s]+/).filter(Boolean)
    if (parts.length < 3) return null
    const num = (p) =>
      p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p)
    const alpha = parts[3] === undefined
      ? 1
      : parts[3].endsWith('%')
        ? parseFloat(parts[3]) / 100
        : parseFloat(parts[3])
    const rgb = [num(parts[0]), num(parts[1]), num(parts[2])]
    if (rgb.some((n) => !Number.isFinite(n))) return null
    return [rgb[0], rgb[1], rgb[2], Number.isFinite(alpha) ? alpha : 1]
  }
  return null
}

/** Re-emit a resolved token colour at a different alpha. */
export function withAlpha(color, alpha) {
  const rgba = parseColor(color)
  const a = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1))
  if (!rgba) return color
  const r = Math.round(rgba[0])
  const g = Math.round(rgba[1])
  const b = Math.round(rgba[2])
  return `rgba(${r}, ${g}, ${b}, ${round3(a * rgba[3])})`
}

/** Blend two resolved colours; `t` 0 => a, 1 => b. */
export function mixColor(a, b, t) {
  const ca = parseColor(a)
  const cb = parseColor(b)
  const k = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0))
  if (!ca || !cb) return k < 0.5 ? a : b
  const ch = (i) => Math.round(ca[i] + (cb[i] - ca[i]) * k)
  const alpha = ca[3] + (cb[3] - ca[3]) * k
  return `rgba(${ch(0)}, ${ch(1)}, ${ch(2)}, ${round3(alpha)})`
}

/**
 * Sample the heat ramp at `t` in 0..1, interpolating between adjacent stops so
 * congestion reads as a continuous gradient rather than six bands.
 */
export function heatColor(tokens, t) {
  const stops = HEAT_TOKENS.length - 1
  const k = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * stops
  const i = Math.min(stops - 1, Math.floor(k))
  return mixColor(tokens[HEAT_TOKENS[i]], tokens[HEAT_TOKENS[i + 1]], k - i)
}

function round3(n) {
  return Math.round(n * 1000) / 1000
}

// ---------------------------------------------------------------------------
// Theme observation
// ---------------------------------------------------------------------------

/**
 * Call `onChange` whenever the resolved palette could have changed: the
 * `data-theme` attribute flipping, or the OS colour-scheme preference moving
 * under `color-scheme: light dark`.
 *
 * @returns {() => void} unsubscribe
 */
export function observeTheme(onChange) {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => {}
  }
  const root = document.documentElement
  const observer = new MutationObserver(onChange)
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['data-theme', 'class', 'style'],
  })

  let media = null
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    media = window.matchMedia('(prefers-color-scheme: dark)')
    if (media.addEventListener) media.addEventListener('change', onChange)
    else if (media.addListener) media.addListener(onChange)
  }

  return () => {
    observer.disconnect()
    if (!media) return
    if (media.removeEventListener) media.removeEventListener('change', onChange)
    else if (media.removeListener) media.removeListener(onChange)
  }
}

/** True when the viewer has asked for reduced motion. */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
