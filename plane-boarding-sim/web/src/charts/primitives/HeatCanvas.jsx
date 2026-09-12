import { useEffect, useMemo, useRef } from 'react'
import { HEAT_STEPS, heatLevel } from './palette.js'
import { readToken, useThemeVersion } from './useTheme.js'

/**
 * Paint a matrix of heat levels into a 2-D context, in device pixels.
 *
 * Kept out of the component so it can be timed and tested without React.
 * Cell edges snap to whole device pixels so neighbours butt together without
 * seams, and `fillStyle` is only re-assigned when the colour actually changes
 * (long runs of one level are the common case, and the assignment is the
 * expensive part of a per-cell fill).
 *
 * @returns {number} cells painted
 */
export function paintHeat(ctx, { matrix, rows, columns, min, max, pxWidth, pxHeight, dpr, colors }) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, pxWidth, pxHeight)

  const cellW = pxWidth / columns
  const cellH = pxHeight / rows
  // A 1 CSS-px separator only once cells are big enough to read as cells.
  const gap = cellW >= 6 * dpr && cellH >= 6 * dpr ? Math.round(dpr) : 0

  let painted = null
  let count = 0
  for (let r = 0; r < rows; r += 1) {
    const row = matrix[r]
    if (!row) continue
    const y0 = Math.round(r * cellH)
    const h = Math.max(1, Math.round((r + 1) * cellH) - y0 - gap)
    for (let b = 0; b < columns; b += 1) {
      const level = heatLevel(row[b], min, max)
      if (level == null) continue
      const color = colors[level]
      if (!color) continue
      if (color !== painted) {
        ctx.fillStyle = color
        painted = color
      }
      const x0 = Math.round(b * cellW)
      ctx.fillRect(x0, y0, Math.max(1, Math.round((b + 1) * cellW) - x0 - gap), h)
      count += 1
    }
  }
  return count
}

/**
 * The cell layer of a matrix heatmap, painted on a `<canvas>`.
 *
 * SVG keeps the axes, the frame and the hit layer; only the cells move here,
 * because the cells are what there are tens of thousands of. An a320neo
 * congestion matrix at the engine's 2 s sample interval is 31 rows × ~340
 * columns ≈ 10,500 cells, a 777 about 20,000 — and every one of them was a
 * `<rect>` that React re-created on every render, including every progress
 * tick of a streaming batch.
 *
 * Two things a canvas does not get for free, and both are handled here:
 *
 * - **Theme.** A canvas cannot inherit CSS custom properties, so the `--heat-*`
 *   ramp is resolved with `getComputedStyle` and re-resolved whenever the theme
 *   changes (`useThemeVersion`), exactly as `src/cabin/` does it.
 * - **Density.** The backing store is sized by `devicePixelRatio` and cell
 *   edges are snapped to whole device pixels, so cells stay crisp and butt
 *   together without seams.
 *
 * Purely decorative: it carries no accessible content of its own. The chart's
 * `aria-label`, its keyboard hit layer and its table view all live in the SVG
 * beside it.
 */
export function HeatCanvas({
  matrix,
  rows,
  columns,
  min,
  max,
  width,
  height,
  left = 0,
  top = 0,
  className = 'ch-heat-canvas',
}) {
  const ref = useRef(null)
  const themeVersion = useThemeVersion()

  // Re-read on every theme flip; `var(--heat-n)` means nothing to a canvas.
  const colors = useMemo(
    () => Array.from({ length: HEAT_STEPS }, (_, i) => readToken(`--heat-${i}`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [themeVersion],
  )

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !Array.isArray(matrix) || rows <= 0 || columns <= 0) return
    if (!(width > 0) || !(height > 0)) return

    const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 3)
    const pxWidth = Math.max(1, Math.round(width * dpr))
    const pxHeight = Math.max(1, Math.round(height * dpr))
    if (canvas.width !== pxWidth) canvas.width = pxWidth
    if (canvas.height !== pxHeight) canvas.height = pxHeight

    let ctx = null
    try {
      ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null
    } catch {
      ctx = null
    }
    // No 2-D context (jsdom, a blocked canvas): the table view and the aria
    // description still carry every number, so draw nothing rather than throw.
    if (!ctx) return

    paintHeat(ctx, { matrix, rows, columns, min, max, pxWidth, pxHeight, dpr, colors })
  }, [matrix, rows, columns, min, max, width, height, colors])

  return (
    <canvas
      ref={ref}
      className={className}
      aria-hidden="true"
      style={{ left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` }}
    />
  )
}
