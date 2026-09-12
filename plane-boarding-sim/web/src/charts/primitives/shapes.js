/**
 * Path builders.
 *
 * dataviz mark spec: bars carry a 4px rounded DATA end and stay square at the
 * baseline, so the rounding always points the way the value grows.
 */

const n = (v) => (Number.isFinite(v) ? v : 0)

/** Horizontal bar growing right from `x`; rounded right edge. */
export function roundedRightRect(x, y, w, h, r = 4) {
  const width = Math.max(0, n(w))
  const height = Math.max(0, n(h))
  const radius = Math.min(r, width, height / 2)
  if (radius <= 0) return `M${n(x)},${n(y)}h${width}v${height}h${-width}Z`
  return [
    `M${n(x)},${n(y)}`,
    `h${width - radius}`,
    `a${radius},${radius} 0 0 1 ${radius},${radius}`,
    `v${height - radius * 2}`,
    `a${radius},${radius} 0 0 1 ${-radius},${radius}`,
    `h${-(width - radius)}`,
    'Z',
  ].join('')
}

/** Vertical column growing up from the baseline at `y + h`; rounded top edge. */
export function roundedTopRect(x, y, w, h, r = 4) {
  const width = Math.max(0, n(w))
  const height = Math.max(0, n(h))
  const radius = Math.min(r, height, width / 2)
  if (radius <= 0) return `M${n(x)},${n(y)}h${width}v${height}h${-width}Z`
  return [
    `M${n(x)},${n(y) + height}`,
    `v${-(height - radius)}`,
    `a${radius},${radius} 0 0 1 ${radius},${-radius}`,
    `h${width - radius * 2}`,
    `a${radius},${radius} 0 0 1 ${radius},${radius}`,
    `v${height - radius}`,
    'Z',
  ].join('')
}

/** Polyline through `points` ([[x, y], ...]); skips non-finite points. */
export function linePath(points) {
  let d = ''
  let pen = false
  for (const [x, y] of points ?? []) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) { pen = false; continue }
    d += `${pen ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`
    pen = true
  }
  return d
}

/** Filled area between `points` and a flat baseline. */
export function areaPath(points, baselineY) {
  const pts = (points ?? []).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  if (pts.length < 2) return ''
  const top = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L')
  const first = pts[0][0].toFixed(2)
  const last = pts[pts.length - 1][0].toFixed(2)
  return `M${top}L${last},${baselineY.toFixed(2)}L${first},${baselineY.toFixed(2)}Z`
}

/** Ribbon between an upper and a lower boundary (IQR / CI bands). */
export function bandPath(upper, lower) {
  const up = (upper ?? []).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  const down = (lower ?? []).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  if (up.length < 2 || down.length < 2) return ''
  const a = up.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L')
  const b = [...down].reverse().map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L')
  return `M${a}L${b}Z`
}

/** Step outline of histogram bins (used by the ridgeline). */
export function stepPath(bins, xScale, yScale, baselineY) {
  if (!bins || bins.length === 0) return ''
  let d = `M${xScale(bins[0].x0).toFixed(2)},${baselineY.toFixed(2)}`
  for (const bin of bins) {
    const y = yScale(bin.density ?? bin.count)
    d += `L${xScale(bin.x0).toFixed(2)},${y.toFixed(2)}`
    d += `L${xScale(bin.x1).toFixed(2)},${y.toFixed(2)}`
  }
  d += `L${xScale(bins[bins.length - 1].x1).toFixed(2)},${baselineY.toFixed(2)}Z`
  return d
}
