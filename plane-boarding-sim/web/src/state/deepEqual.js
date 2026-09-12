/**
 * Structural equality for config values.
 *
 * Config values are JSON: numbers, strings, booleans, arrays of strings and
 * flat maps of numbers. It sits in its own module, rather than in the reducer
 * that used to own it, so the reducer and the per-airframe defaults layering
 * can both use it without an import cycle. `state/configReducer.js` still
 * re-exports it, because that is where everything imports it from.
 */
export function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    return ka.every((k) => deepEqual(a[k], b[k]))
  }
  return false
}
