/** Read a sampled `{t, ...}` curve at an arbitrary time (step-wise, no interpolation). */
export function sampleAt(curve, t, field) {
  if (!Array.isArray(curve) || curve.length === 0) return 0
  if (t <= curve[0].t) return curve[0][field] ?? 0
  const last = curve[curve.length - 1]
  if (t >= last.t) return last[field] ?? 0
  let lo = 0
  let hi = curve.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (curve[mid].t <= t) lo = mid
    else hi = mid
  }
  return curve[lo][field] ?? 0
}
