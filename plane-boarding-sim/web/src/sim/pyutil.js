/**
 * Python semantics that JavaScript does not share.
 *
 * The engine is a line-for-line port of `python/plane_boarding/`, so anywhere
 * the Python leans on a language rule that JS spells differently, the rule gets
 * a named helper here rather than an inline approximation at the call site.
 * Every one of these is covered by `web/test/sim/pyutil.test.js`.
 *
 * The four that actually bite:
 *
 *   * `//` floors toward negative infinity; `Math.trunc` and `| 0` do not.
 *   * `%` takes the sign of the DIVISOR; JS `%` takes the sign of the dividend.
 *   * `round()` is round-half-to-EVEN; `Math.round` is half-up and maps -0.5
 *     to -0. This one matters at `round(loadFactor * seats)`, where a half
 *     value changes the passenger count, and at every `round(x, 6)` in the
 *     result schema.
 *   * `list.sort(key=...)` computes the key once per element and is stable.
 */

/** Exact powers of ten. Every one of these is representable as a double. */
const POW10 = [1, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12]

const SCRATCH = new DataView(new ArrayBuffer(8))

/**
 * Round-half-to-even on the EXACT binary value of `x`, with no intermediate
 * floating-point multiply to blur the tie.
 *
 * A double is exactly `mant * 2**e2`, so `x * 10**nd` is the exact rational
 * `mant * 10**nd * 2**e2`. BigInt division then decides the tie against the
 * true value rather than against a rounded product. This is the slow path;
 * `pyRound` only reaches it when the fast path cannot prove it is not a tie.
 *
 * @param {number} x strictly positive and finite
 * @param {number} nd decimal places, 0..12
 */
function exactRoundHalfEven(x, nd) {
  SCRATCH.setFloat64(0, x)
  const hi = SCRATCH.getUint32(0)
  const lo = SCRATCH.getUint32(4)
  const rawExp = (hi >>> 20) & 0x7ff
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo)
  let e2
  if (rawExp === 0) {
    e2 = -1074 // subnormal: no implicit leading bit
  } else {
    mant |= 1n << 52n
    e2 = rawExp - 1075
  }
  const p = 10n ** BigInt(nd)
  let num
  let den
  if (e2 >= 0) {
    num = mant * p * (1n << BigInt(e2))
    den = 1n
  } else {
    num = mant * p
    den = 1n << BigInt(-e2)
  }
  let q = num / den
  const rem = num - q * den
  const twice = rem * 2n
  if (twice > den) q += 1n
  else if (twice === den && (q & 1n) === 1n) q += 1n
  return Number(q) / POW10[nd]
}

/**
 * Python's `round(x, nd)`: round half to even, then return the nearest double
 * to that decimal.
 *
 * `-0.0` and `0.0` are returned unchanged so the sign survives exactly as it
 * does in Python (`parity/emit_py.py` normalises it separately, on purpose).
 *
 * @param {number} x
 * @param {number} [nd] decimal places, 0..12
 * @returns {number}
 */
export function pyRound(x, nd = 0) {
  if (!Number.isFinite(x)) return x
  if (x === 0) return x
  const neg = x < 0
  const ax = neg ? -x : x
  const p = POW10[nd]
  const y = ax * p
  const fl = Math.floor(y)
  const frac = y - fl
  // The computed product sits within half an ulp of the true one, so anything
  // further than that from .5 cannot be a tie and the cheap branch is exact.
  const eps = y * 2.3e-16 + 1e-9
  let out
  if (Math.abs(frac - 0.5) > eps) {
    out = (frac > 0.5 ? fl + 1 : fl) / p
  } else {
    out = exactRoundHalfEven(ax, nd)
  }
  return neg ? -out : out
}

/** Python's zero-argument `round(x)` — half to even, integral result. */
export const pyRoundInt = (x) => pyRound(x, 0)

/** Python's `a // b` for numbers: floor division, toward negative infinity. */
export const floorDiv = (a, b) => Math.floor(a / b)

/** Python's `a % b`: the result takes the sign of the DIVISOR. */
export const pyMod = (a, b) => ((a % b) + b) % b

/**
 * `bisect.bisect_left` — leftmost insertion point for `x` in a sorted array.
 * @param {ArrayLike<number>} arr
 * @param {number} x
 */
export function bisectLeft(arr, x) {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Python's `sorted(items, key=f)` / `items.sort(key=f)`.
 *
 * Decorate-sort-undecorate, so the key is computed exactly once per element
 * (the Python semantics) and ties keep their original order. `Array.prototype
 * .sort` has been required to be stable since ES2019, and the index tiebreak
 * below makes that independent of the engine anyway.
 *
 * @template T
 * @param {T[]} items mutated in place, as Python's `list.sort` is
 * @param {(item: T) => number} key
 * @param {boolean} [reverse] descending, ties still in original order
 * @returns {T[]} the same array
 */
export function sortByKey(items, key, reverse = false) {
  const n = items.length
  const decorated = new Array(n)
  for (let i = 0; i < n; i++) decorated[i] = { k: key(items[i]), i, v: items[i] }
  decorated.sort(
    reverse
      ? (a, b) => (b.k < a.k ? -1 : a.k < b.k ? 1 : a.i - b.i)
      : (a, b) => (a.k < b.k ? -1 : b.k < a.k ? 1 : a.i - b.i),
  )
  for (let i = 0; i < n; i++) items[i] = decorated[i].v
  return items
}

/**
 * As `sortByKey`, but the key is a tuple compared element by element in order,
 * mirroring Python's tuple ordering.
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => Array<number|string>} key
 */
export function sortByTuple(items, key) {
  const n = items.length
  const decorated = new Array(n)
  for (let i = 0; i < n; i++) decorated[i] = { k: key(items[i]), i, v: items[i] }
  decorated.sort((a, b) => {
    const x = a.k
    const y = b.k
    for (let j = 0; j < x.length; j++) {
      if (x[j] < y[j]) return -1
      if (y[j] < x[j]) return 1
    }
    return a.i - b.i
  })
  for (let i = 0; i < n; i++) items[i] = decorated[i].v
  return items
}

/** Compare two tuples the way Python does: element by element, in order. */
export function tupleLess(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return true
    if (b[i] < a[i]) return false
  }
  return false
}

/**
 * Python's `min(items, key=f)` where `f` returns a tuple: the FIRST element
 * holding the minimum key wins, which is what makes the choice deterministic.
 *
 * @template T
 * @param {T[]} items non-empty
 * @param {(item: T) => Array<number|string>} key
 */
export function minByTuple(items, key) {
  let best = items[0]
  let bestKey = key(best)
  for (let i = 1; i < items.length; i++) {
    const k = key(items[i])
    if (tupleLess(k, bestKey)) {
      best = items[i]
      bestKey = k
    }
  }
  return best
}

/** Python's `list.remove(value)`: drop the first identical element. */
export function removeFirst(arr, value) {
  const i = arr.indexOf(value)
  if (i >= 0) arr.splice(i, 1)
  return arr
}

/**
 * Sum a sequence left to right, exactly as Python's `sum()` does.
 *
 * Spelled out rather than `.reduce` so that nobody is tempted to reorder the
 * array first: floating-point addition is not associative and the order is
 * part of the parity contract.
 */
export function pySum(values) {
  let total = 0
  for (let i = 0; i < values.length; i++) total += values[i]
  return total
}
