/**
 * Ink selection for text that sits ON a data colour.
 *
 * Stacked-bar value labels are the one place the dataviz method allows text
 * on a fill, and the price of it is that the label colour has to be decided
 * from the fill's measured luminance rather than from the theme: light-theme
 * paper on `--state-walking` measures 3.68:1 and on `--state-waiting` 4.37:1,
 * both under the 4.5:1 floor for 11px text, while the same paper on
 * `--state-stowing` is fine. Only per-fill selection clears AA everywhere.
 *
 * The two candidate inks are the extremes rather than the theme's text
 * tokens, because on `--state-waiting` (#e0364f) even `--text` (#10151f) only
 * reaches 4.25:1 — pure black reaches 4.81:1.
 */

/** The two candidates. Nothing else clears AA on every fill in the palette. */
export const INK_DARK = '#000000'
export const INK_LIGHT = '#ffffff'

/** Their token names — nothing paints a literal hex, that is the house rule. */
export const INK_VARS = {
  [INK_DARK]: 'var(--ink-on-fill)',
  [INK_LIGHT]: 'var(--paper-on-fill)',
}

/** Parse `#rgb`, `#rrggbb`, `rgb()` / `rgba()` into channel bytes. */
export function parseColor(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  if (text[0] === '#') {
    const hex = text.slice(1)
    if (hex.length === 3 || hex.length === 4) {
      const n = [0, 1, 2].map((i) => parseInt(hex[i] + hex[i], 16))
      return n.some(Number.isNaN) ? null : { r: n[0], g: n[1], b: n[2] }
    }
    if (hex.length === 6 || hex.length === 8) {
      const n = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
      return n.some(Number.isNaN) ? null : { r: n[0], g: n[1], b: n[2] }
    }
    return null
  }
  const nums = text.match(/[\d.]+/g)
  if (!nums || nums.length < 3) return null
  const [r, g, b] = nums.slice(0, 3).map(Number)
  return [r, g, b].some((v) => !Number.isFinite(v)) ? null : { r, g, b }
}

function channel(value) {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of an opaque colour. `null` if unparseable. */
export function relativeLuminance(color) {
  const c = typeof color === 'string' ? parseColor(color) : color
  if (!c) return null
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}

/** WCAG contrast ratio between two opaque colours. `null` if unparseable. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  if (la === null || lb === null) return null
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * The higher-contrast of the two inks for text painted on `fill`.
 *
 * `fallback` is returned when the fill cannot be resolved (no DOM, an unset
 * token): the dark ink, which is the safer guess on the saturated mid-tones
 * this is used for.
 */
export function labelInk(fill, fallback = INK_DARK) {
  const l = relativeLuminance(fill)
  if (l === null) return fallback
  // Contrast against white is 1.05/(L+0.05); against black (L+0.05)/0.05.
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? INK_DARK : INK_LIGHT
}

/**
 * Resolve a `var(--token)` reference (or a literal colour) to a computed
 * value. Returns '' when there is no DOM or the token is unset.
 */
export function resolveColor(value, element = null) {
  if (typeof value !== 'string') return ''
  const token = value.match(/^var\(\s*(--[\w-]+)/)
  if (!token) return value
  if (typeof window === 'undefined' || typeof document === 'undefined') return ''
  try {
    const el = element ?? document.documentElement
    return window.getComputedStyle(el).getPropertyValue(token[1]).trim()
  } catch {
    return ''
  }
}

/** `labelInk`, as the token reference the renderer actually paints with. */
export function labelInkVar(fill) {
  return INK_VARS[labelInk(fill)]
}
