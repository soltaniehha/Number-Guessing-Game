/**
 * Palette wiring for the analytics charts.
 *
 * `web/src/theme.css` is frozen and is the project's palette instance: it
 * supplies `--series-1..12` (categorical) and `--heat-0..5` (semantic heat
 * ramp). This module supplies the two things the dataviz method asks a
 * consumer to decide: the **slot order** and the **series cap**.
 *
 * Slot order was derived, not eyeballed. Every ordering was scored with the
 * skill's `validate_palette.js` (Machado-Oliveira-Fernandes CVD simulation,
 * ΔE in OKLab×100) against BOTH themed surfaces (#ffffff / #131924), then
 * annealed to maximise the worst adjacent pair over prefixes of every length.
 *
 *   order  : 1, 2, 8, 7, 6, 5, 4, 3, 10, 11, 12
 *   light  : worst adjacent CVD ΔE 11.2 · worst adjacent normal ΔE 15.4  (PASS/PASS)
 *   dark   : worst adjacent CVD ΔE 12.3 · worst adjacent normal ΔE 18.6  (PASS/PASS)
 *   first 3, --pairs all (the scatter): CVD 13.1 / normal 15.4 light,
 *                                       CVD 10.9 / normal 18.6 dark      (PASS)
 *
 * A 12th slot drops the worst adjacent normal-vision ΔE to 11.7, under the
 * hard floor of 15 — so the cap is ELEVEN. Past that, series fold into a
 * muted "Other" bucket rather than getting a generated hue.
 *
 * Two frozen tokens carry known flaws that cannot be fixed from here:
 *   --series-7  (#ca8a04) sits at 2.94:1 on the light surface. The relief rule
 *               applies and is satisfied: every chart ships visible value
 *               labels and a table view.
 *   --series-12 (#0f766e) has OKLCH chroma 0.086, below the 0.10 floor, so it
 *               reads greyish in light mode. It is placed LAST, so it only
 *               appears when eleven strategies are on screen at once.
 * Secondary encoding (a per-slot marker shape, plus direct labels) rides along
 * on every slot so identity never rests on hue alone.
 */

/** Validated assignment order over the frozen `--series-*` tokens. */
export const SERIES_SLOT_ORDER = [1, 2, 8, 7, 6, 5, 4, 3, 10, 11, 12]

/** Hard cap on distinct categorical hues. Past this, fold to "Other". */
export const MAX_SERIES = SERIES_SLOT_ORDER.length

/** Series-count cap for all-pairs forms (scatter): validated at three. */
export const ALL_PAIRS_SAFE = 3

/** Marker shapes — the secondary identity channel (composite hue × shape). */
export const SERIES_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'pentagon', 'cross']

/** Steps in the semantic heat ramp (`--heat-0` … `--heat-5`). */
export const HEAT_STEPS = 6

/** CSS variable reference for categorical slot `i` (0-based, entity order). */
export function seriesColor(index) {
  if (!Number.isFinite(index) || index < 0 || index >= MAX_SERIES) return 'var(--text-3)'
  return `var(--series-${SERIES_SLOT_ORDER[index]})`
}

/** Marker shape for categorical slot `i`. */
export function seriesShape(index) {
  if (!Number.isFinite(index) || index < 0) return 'circle'
  return SERIES_SHAPES[index % SERIES_SHAPES.length]
}

/** CSS variable reference for heat step `level` (0..5), clamped. */
export function heatColor(level) {
  const l = Math.max(0, Math.min(HEAT_STEPS - 1, Math.round(level || 0)))
  return `var(--heat-${l})`
}

/** Bucket a value into 0..5 across [min,max]. Degenerate ranges give step 0. */
export function heatLevel(value, min, max) {
  if (!Number.isFinite(value)) return null
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0
  const t = (value - min) / (max - min)
  return Math.max(0, Math.min(HEAT_STEPS - 1, Math.floor(t * HEAT_STEPS - 1e-9)))
}

/** Inclusive value edges of each heat bin, for the scale legend. */
export function heatBins(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return Array.from({ length: HEAT_STEPS }, (_, i) => ({ level: i, x0: min ?? 0, x1: max ?? 0 }))
  }
  const width = (max - min) / HEAT_STEPS
  return Array.from({ length: HEAT_STEPS }, (_, i) => ({
    level: i,
    x0: min + i * width,
    x1: min + (i + 1) * width,
  }))
}

/**
 * Stable entity → visual identity map.
 *
 * Colour follows the *entity*, never its rank or its row in the current
 * filter: the map is built from the full key list once, so hiding a strategy
 * never repaints the survivors.
 */
export function assignSeries(keys) {
  const map = new Map()
  ;(keys ?? []).forEach((key, i) => {
    const overflow = i >= MAX_SERIES
    map.set(key, {
      key,
      index: overflow ? -1 : i,
      color: overflow ? 'var(--text-3)' : seriesColor(i),
      shape: seriesShape(i),
      overflow,
    })
  })
  return map
}

/** SVG path for a marker shape centred at (cx, cy) with radius r (>= 4px). */
export function shapePath(shape, cx, cy, r = 4.5) {
  const poly = (points) => `M${points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L')}Z`
  switch (shape) {
    case 'square':
      return poly([
        [cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r],
      ])
    case 'triangle': {
      const h = r * 1.25
      return poly([[cx, cy - h], [cx + h, cy + h * 0.75], [cx - h, cy + h * 0.75]])
    }
    case 'diamond': {
      const d = r * 1.3
      return poly([[cx, cy - d], [cx + d, cy], [cx, cy + d], [cx - d, cy]])
    }
    case 'pentagon': {
      const pts = []
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5
        pts.push([cx + Math.cos(a) * r * 1.25, cy + Math.sin(a) * r * 1.25])
      }
      return poly(pts)
    }
    case 'cross': {
      const t = r * 0.45
      const l = r * 1.25
      return poly([
        [cx - t, cy - l], [cx + t, cy - l], [cx + t, cy - t], [cx + l, cy - t],
        [cx + l, cy + t], [cx + t, cy + t], [cx + t, cy + l], [cx - t, cy + l],
        [cx - t, cy + t], [cx - l, cy + t], [cx - l, cy - t], [cx - t, cy - t],
      ])
    }
    case 'circle':
    default:
      return `M${cx - r},${cy}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0Z`
  }
}
