/**
 * Deterministic PCG32 random number generator.
 *
 * This file is a line-for-line mirror of `python/plane_boarding/rng.py`.
 * It uses BigInt for the 64-bit state so the arithmetic is exact and matches
 * Python's arbitrary-precision integers bit for bit.
 *
 * See docs/ENGINE_SPEC.md section 1 for the normative definition.
 */

const UINT64_MASK = (1n << 64n) - 1n
const UINT32_MASK = 0xffffffffn
const PCG_MULT = 6364136223846793005n
const TWO_POW_32 = 4294967296
const TWO_POW_32_BIG = 4294967296n

export class PCG32 {
  constructor(seed, stream = 1) {
    this.state = 0n
    this.inc = ((BigInt(stream) << 1n) | 1n) & UINT64_MASK
    this.nextUint32()
    this.state = (this.state + (BigInt(seed) & UINT64_MASK)) & UINT64_MASK
    this.nextUint32()
  }

  // -- core ---------------------------------------------------------------

  nextUint32() {
    const old = this.state
    this.state = (old * PCG_MULT + this.inc) & UINT64_MASK
    const xorshifted = (((old >> 18n) ^ old) >> 27n) & UINT32_MASK
    const rot = (old >> 59n) & 31n
    const out = ((xorshifted >> rot) | (xorshifted << ((-rot) & 31n))) & UINT32_MASK
    return Number(out)
  }

  // -- derived distributions ---------------------------------------------

  /** Float in [0, 1). */
  random() {
    return this.nextUint32() / TWO_POW_32
  }

  uniform(a, b) {
    return a + (b - a) * this.random()
  }

  /** Integer in [0, n), rejection-sampled to remove modulo bias. */
  randint(n) {
    if (n <= 0) return 0
    const big = BigInt(n)
    const limit = Number(TWO_POW_32_BIG - (TWO_POW_32_BIG % big))
    for (;;) {
      const r = this.nextUint32()
      if (r < limit) return r % n
    }
  }

  /**
   * Box-Muller. Deliberately does NOT cache the second variate, so the number
   * of draws consumed per call is always exactly two.
   */
  normal(mu = 0, sigma = 1) {
    let u1 = this.random()
    if (u1 < 1e-12) u1 = 1e-12
    const u2 = this.random()
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    return mu + sigma * z
  }

  truncnormal(mu, sigma, lo, hi) {
    let value = mu
    for (let i = 0; i < 32; i++) {
      value = this.normal(mu, sigma)
      if (value >= lo && value <= hi) return value
    }
    return Math.min(hi, Math.max(lo, value))
  }

  /**
   * Parameterised by the mean/sd of the RESULT, not of the underlying normal --
   * this is what makes the config parameters human-readable.
   */
  lognormal(mean, sd) {
    if (mean <= 0) return 0
    if (sd <= 0) return mean
    const varr = sd * sd
    const mu = Math.log((mean * mean) / Math.sqrt(varr + mean * mean))
    const sigma = Math.sqrt(Math.log(1 + varr / (mean * mean)))
    return Math.exp(this.normal(mu, sigma))
  }

  /**
   * Inverse-CDF exponential. Exactly ONE uint32 draw.
   *
   * Used for the door arrival process: Schultz's field data show passenger
   * inter-arrival at the aircraft door is memoryless, which is what makes the
   * door such a stubborn serialising constraint.
   */
  exponential(mean) {
    if (mean <= 0) return 0
    let u = 1 - this.random()
    if (u < 1e-12) u = 1e-12
    return -mean * Math.log(u)
  }

  /**
   * Inverse-CDF Weibull. Exactly ONE uint32 draw.
   *
   * Schultz fits Weibull(k=1.7, lambda=16 s) to the time to stow ONE piece of
   * luggage. The right-skew is the point: most stows are quick, a small tail of
   * them are disasters, and it is the tail that jams the aisle.
   */
  weibull(shape, scale) {
    if (shape <= 0 || scale <= 0) return 0
    let u = 1 - this.random()
    if (u < 1e-12) u = 1e-12
    return scale * Math.pow(-Math.log(u), 1 / shape)
  }

  /**
   * Inverse-CDF triangular. Exactly ONE uint32 draw.
   *
   * The elementary-movement primitive: one "step out / stand / sit" action
   * costs Triangular(1.8, 2.4, 3.0) s. Seat interference is then modelled as an
   * integer NUMBER of these movements rather than a fitted total, which is what
   * lets the model distinguish "aisle blocks middle" from "aisle+middle block
   * window".
   */
  triangular(lo, mode, hi) {
    const span = hi - lo
    if (span <= 0) return lo
    const u = this.random()
    const c = (mode - lo) / span
    if (u < c) return lo + Math.sqrt(u * span * (mode - lo))
    return hi - Math.sqrt((1 - u) * span * (hi - mode))
  }

  bernoulli(p) {
    return this.random() < p
  }

  /** In-place Fisher-Yates, descending index. Returns the same array. */
  shuffle(items) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.randint(i + 1)
      const tmp = items[i]
      items[i] = items[j]
      items[j] = tmp
    }
    return items
  }

  choice(items) {
    return items[this.randint(items.length)]
  }

  /**
   * One draw. `keys` and `weights` must be parallel and ordered
   * deterministically by the caller.
   */
  weightedPick(keys, weights) {
    let total = 0
    for (const w of weights) total += Math.max(0, w)
    if (total <= 0) return keys[0]
    const r = this.random() * total
    let acc = 0
    for (let i = 0; i < weights.length; i++) {
      acc += Math.max(0, weights[i])
      if (r < acc) return keys[i]
    }
    return keys[keys.length - 1]
  }
}
