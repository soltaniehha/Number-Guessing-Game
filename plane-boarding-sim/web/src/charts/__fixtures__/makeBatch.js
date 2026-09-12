/**
 * Deterministic BatchResult fixtures.
 *
 * Same seed ⇒ byte-identical output, so the charts can be built, screenshotted
 * and tested standalone without the engine or a Web Worker. Shapes follow
 * ENGINE_SPEC §7 exactly; strategy names follow STRATEGIES.md.
 */

/* ---------- deterministic RNG ------------------------------------------ */

export function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const gaussian = (rand) => {
  const u = Math.max(1e-12, rand())
  const v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/* ---------- cabin ------------------------------------------------------- */

export const A320 = {
  aircraftId: 'a320neo',
  rows: 30,
  letters: ['A', 'B', 'C', 'D', 'E', 'F'],
  /** distance from the aisle: 3 = window, 2 = middle, 1 = aisle */
  depthOf: (letter) => ({ A: 3, B: 2, C: 1, D: 1, E: 2, F: 3 }[letter] ?? 2),
}

/* ---------- strategy profiles ------------------------------------------ */

/**
 * `name` values are the human-readable labels from STRATEGIES.md.
 * `mean`/`cv` shape the totalSeconds distribution; `wave` shapes where in the
 * cabin the queue piles up; the mixes are fractions that get scaled to
 * passenger-seconds / counts.
 */
export const STRATEGY_PROFILES = {
  random: {
    name: 'Free-for-all',
    mean: 1042, cv: 0.085, wave: 'spread',
    breakdown: { walk: 0.24, stow: 0.42, shuffle: 0.17, blocked: 0.17 },
    interference: { none: 0.52, one: 0.26, two: 0.11, sameParty: 0.11 },
    gateChecks: 8.4, tailSkew: 1.15, seatBias: { row: 0.35, depth: 0.35 },
  },
  back_to_front: {
    name: 'Back-to-front zones',
    mean: 1268, cv: 0.095, wave: 'aft-to-fwd',
    breakdown: { walk: 0.18, stow: 0.34, shuffle: 0.16, blocked: 0.32 },
    interference: { none: 0.5, one: 0.27, two: 0.12, sameParty: 0.11 },
    gateChecks: 9.1, tailSkew: 1.35, seatBias: { row: 0.85, depth: 0.3 },
  },
  wilma: {
    name: 'Window / Middle / Aisle',
    mean: 936, cv: 0.075, wave: 'spread',
    breakdown: { walk: 0.27, stow: 0.5, shuffle: 0.03, blocked: 0.2 },
    interference: { none: 0.86, one: 0.05, two: 0.01, sameParty: 0.08 },
    gateChecks: 8.0, tailSkew: 1.05, seatBias: { row: 0.3, depth: -0.75 },
  },
  reverse_pyramid: {
    name: 'Reverse pyramid',
    mean: 884, cv: 0.07, wave: 'diagonal',
    breakdown: { walk: 0.28, stow: 0.51, shuffle: 0.05, blocked: 0.16 },
    interference: { none: 0.83, one: 0.07, two: 0.02, sameParty: 0.08 },
    gateChecks: 7.8, tailSkew: 1.02, seatBias: { row: 0.55, depth: -0.6 },
  },
  steffen_modified: {
    name: 'Steffen (modified)',
    mean: 831, cv: 0.065, wave: 'interleaved',
    breakdown: { walk: 0.31, stow: 0.54, shuffle: 0.04, blocked: 0.11 },
    interference: { none: 0.85, one: 0.06, two: 0.02, sameParty: 0.07 },
    gateChecks: 7.6, tailSkew: 1.0, seatBias: { row: 0.25, depth: -0.5 },
  },
  common_sense_5tier: {
    name: '5-tier common sense',
    mean: 862, cv: 0.072, wave: 'diagonal',
    breakdown: { walk: 0.29, stow: 0.52, shuffle: 0.06, blocked: 0.13 },
    interference: { none: 0.81, one: 0.09, two: 0.02, sameParty: 0.08 },
    gateChecks: 7.9, tailSkew: 1.04, seatBias: { row: 0.5, depth: -0.55 },
  },
  priority_5tier: {
    name: '5-tier priority',
    mean: 1121, cv: 0.09, wave: 'spread',
    breakdown: { walk: 0.22, stow: 0.4, shuffle: 0.16, blocked: 0.22 },
    interference: { none: 0.51, one: 0.27, two: 0.12, sameParty: 0.1 },
    gateChecks: 8.8, tailSkew: 1.25, seatBias: { row: 0.3, depth: 0.4 },
  },
  front_to_back: {
    name: 'Front-to-back zones',
    mean: 1436, cv: 0.1, wave: 'fwd-to-aft',
    breakdown: { walk: 0.15, stow: 0.3, shuffle: 0.15, blocked: 0.4 },
    interference: { none: 0.49, one: 0.28, two: 0.12, sameParty: 0.11 },
    gateChecks: 9.6, tailSkew: 1.45, seatBias: { row: -0.7, depth: 0.35 },
  },
}

export const DEFAULT_STRATEGY_KEYS = [
  'random',
  'back_to_front',
  'wilma',
  'reverse_pyramid',
  'steffen_modified',
  'common_sense_5tier',
]

/* ---------- helpers ----------------------------------------------------- */

const sorted = (values) => [...values].sort((a, b) => a - b)

function pct(sortedValues, p) {
  if (sortedValues.length === 0) return NaN
  if (sortedValues.length === 1) return sortedValues[0]
  const pos = (sortedValues.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sortedValues[lo] + (pos - lo) * (sortedValues[hi] - sortedValues[lo])
}

const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086,
  2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042]
const tcrit = (df) => (df < 1 ? NaN : df <= 30 ? T95[df - 1] : 1.96)

/* ---------- per-strategy synthesis ------------------------------------- */

function totalsFor(profile, runs, rand) {
  const values = []
  for (let i = 0; i < runs; i++) {
    const z = gaussian(rand)
    const skewed = z >= 0 ? z * profile.tailSkew : z
    values.push(Math.max(120, profile.mean * (1 + profile.cv * skewed)))
  }
  return values.map((v) => Math.round(v * 10) / 10)
}

function seatedCurveMean(profile, meanTotal, paxCount, sampleInterval = 15) {
  const points = []
  const steps = Math.max(4, Math.round(meanTotal / sampleInterval))
  for (let i = 0; i <= steps; i++) {
    const t = i * sampleInterval
    const x = t / meanTotal
    // logistic-ish S with a slow head (jet-bridge fill) and a long tail
    const s = 1 / (1 + Math.exp(-9 * (x - 0.47)))
    const s0 = 1 / (1 + Math.exp(-9 * (0 - 0.47)))
    const s1 = 1 / (1 + Math.exp(-9 * (1 - 0.47)))
    const norm = Math.min(1, (s - s0) / (s1 - s0))
    const seated = Math.round(norm * paxCount)
    const spread = paxCount * 0.06 * Math.sin(Math.PI * Math.min(1, x)) * profile.tailSkew
    points.push({
      t,
      seated,
      p25: Math.max(0, Math.round(seated - spread)),
      p75: Math.min(paxCount, Math.round(seated + spread)),
    })
  }
  return points
}

function congestionMean(profile, meanTotal, rows, rand, bucketSeconds = 30) {
  const buckets = Math.max(4, Math.ceil(meanTotal / bucketSeconds))
  const matrix = []
  for (let r = 0; r < rows; r++) {
    const row = []
    const rowNorm = r / (rows - 1)
    for (let b = 0; b < buckets; b++) {
      const tNorm = b / (buckets - 1)
      let centre
      let spread
      switch (profile.wave) {
        case 'aft-to-fwd': centre = 1 - tNorm * 0.95; spread = 0.16; break
        case 'fwd-to-aft': centre = 0.05 + tNorm * 0.95; spread = 0.14; break
        case 'diagonal': centre = 0.85 - tNorm * 0.7; spread = 0.3; break
        case 'interleaved': centre = 0.5; spread = 0.42; break
        default: centre = 0.55 - tNorm * 0.2; spread = 0.38
      }
      const shape = Math.exp(-((rowNorm - centre) ** 2) / (2 * spread * spread))
      // arrivals ramp up then drain
      const flow = Math.sin(Math.PI * Math.min(1, Math.max(0, tNorm * 1.05)))
      const jitter = 0.9 + 0.2 * rand()
      const bodies = shape * flow * (profile.wave === 'aft-to-fwd' || profile.wave === 'fwd-to-aft' ? 4.6 : 2.4) * jitter
      row.push(Math.round(bodies * 100) / 100)
    }
    matrix.push(row)
  }
  return matrix
}

function pooledWaits(profile, paxCount, rand, sampleSize = 240) {
  const base = profile.mean * 0.42
  const values = []
  for (let i = 0; i < paxCount; i++) {
    const z = gaussian(rand)
    const skew = z >= 0 ? z * (1.5 * profile.tailSkew) : z * 0.75
    values.push(Math.max(20, base * (1 + 0.45 * skew)))
  }
  const s = sorted(values)
  const n = s.length
  const mean = values.reduce((a, b) => a + b, 0) / n
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)
  const step = Math.max(1, Math.floor(n / sampleSize))
  const sample = []
  for (let i = 0; i < n; i += step) sample.push(Math.round(s[i] * 10) / 10)
  return {
    n,
    mean: Math.round(mean * 10) / 10,
    sd: Math.round(Math.sqrt(variance) * 10) / 10,
    min: Math.round(s[0] * 10) / 10,
    p05: Math.round(pct(s, 0.05) * 10) / 10,
    p25: Math.round(pct(s, 0.25) * 10) / 10,
    p50: Math.round(pct(s, 0.5) * 10) / 10,
    p75: Math.round(pct(s, 0.75) * 10) / 10,
    p90: Math.round(pct(s, 0.9) * 10) / 10,
    p95: Math.round(pct(s, 0.95) * 10) / 10,
    max: Math.round(s[n - 1] * 10) / 10,
    sample,
  }
}

function seatTimeMean(profile, cabin, rand) {
  const out = {}
  const base = profile.mean * 0.3
  for (let row = 1; row <= cabin.rows; row++) {
    const rowNorm = (row - 1) / (cabin.rows - 1)
    for (const letter of cabin.letters) {
      const depth = cabin.depthOf(letter)
      const depthNorm = (depth - 1) / 2
      const value =
        base *
        (1 +
          profile.seatBias.row * rowNorm +
          profile.seatBias.depth * depthNorm +
          0.07 * (rand() - 0.5))
      out[`${row}${letter}`] = Math.round(Math.max(15, value) * 10) / 10
    }
  }
  return out
}

function convergenceOf(values) {
  const out = []
  let s = 0
  let sq = 0
  for (let i = 0; i < values.length; i++) {
    s += values[i]
    sq += values[i] * values[i]
    const n = i + 1
    const m = s / n
    let ciLow = m
    let ciHigh = m
    if (n >= 2) {
      const variance = Math.max(0, (sq - n * m * m) / (n - 1))
      const half = tcrit(n - 1) * Math.sqrt(variance / n)
      ciLow = m - half
      ciHigh = m + half
    }
    out.push({
      n,
      mean: Math.round(m * 10) / 10,
      ciLow: Math.round(ciLow * 10) / 10,
      ciHigh: Math.round(ciHigh * 10) / 10,
    })
  }
  return out
}

/* ---------- public API -------------------------------------------------- */

/**
 * Build a BatchResult.
 *
 * @param {object}   [options]
 * @param {number}   [options.runs=200]         replications completed per strategy
 * @param {string[]} [options.strategies]       strategy keys (default: six)
 * @param {number}   [options.seed=20260912]    deterministic seed
 * @param {number}   [options.loadFactor=0.95]
 * @param {boolean}  [options.sweep=true]       include the load-factor sweep
 * @param {boolean}  [options.complete=true]    meta.complete
 * @param {number}   [options.runsRequested]    defaults to `runs`
 */
export function makeBatch({
  runs = 200,
  strategies = DEFAULT_STRATEGY_KEYS,
  seed = 20260912,
  loadFactor = 0.95,
  sweep = true,
  complete = true,
  runsRequested = null,
  cabin = A320,
} = {}) {
  const seatCount = cabin.rows * cabin.letters.length
  const paxCount = Math.round(seatCount * loadFactor)
  const byStrategy = {}

  strategies.forEach((key, si) => {
    const profile = STRATEGY_PROFILES[key]
    if (!profile) return
    const rand = mulberry32(seed + si * 7919)
    const values = totalsFor(profile, Math.max(1, runs), rand)
    const s = sorted(values)
    const n = values.length
    const mean = values.reduce((a, b) => a + b, 0) / n
    const variance = n > 1 ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0
    const paxSeconds = mean * paxCount * 0.55

    byStrategy[key] = {
      runs: n,
      name: profile.name,
      totalSeconds: {
        mean: Math.round(mean * 10) / 10,
        sd: Math.round(Math.sqrt(variance) * 10) / 10,
        min: s[0],
        max: s[n - 1],
        p05: Math.round(pct(s, 0.05) * 10) / 10,
        p50: Math.round(pct(s, 0.5) * 10) / 10,
        p95: Math.round(pct(s, 0.95) * 10) / 10,
        values,
      },
      meanBreakdown: {
        walk: Math.round(paxSeconds * profile.breakdown.walk),
        stow: Math.round(paxSeconds * profile.breakdown.stow),
        shuffle: Math.round(paxSeconds * profile.breakdown.shuffle),
        blocked: Math.round(paxSeconds * profile.breakdown.blocked),
      },
      meanInterference: {
        none: Math.round(paxCount * profile.interference.none),
        one: Math.round(paxCount * profile.interference.one),
        two: Math.round(paxCount * profile.interference.two),
        sameParty: Math.round(paxCount * profile.interference.sameParty),
      },
      meanGateChecks: profile.gateChecks,
      seatedCurveMean: seatedCurveMean(profile, mean, paxCount),
      congestionMean: congestionMean(profile, mean, cabin.rows, mulberry32(seed + si * 31 + 5)),
      perPassengerPooled: pooledWaits(profile, paxCount, mulberry32(seed + si * 104729)),
      seatTimeMean: seatTimeMean(profile, cabin, mulberry32(seed + si * 15485863)),
      convergence: convergenceOf(values),
    }
  })

  const batch = {
    byStrategy,
    meta: {
      aircraftId: cabin.aircraftId,
      runsRequested: runsRequested ?? Math.max(1, runs),
      runsDone: Math.max(1, runs) * Object.keys(byStrategy).length,
      complete,
      loadFactor,
      paxCount,
      seatCount,
    },
  }

  if (sweep) {
    const loadFactors = [0.5, 0.6, 0.7, 0.8, 0.9, 1]
    const sweepByStrategy = {}
    strategies.forEach((key, si) => {
      const profile = STRATEGY_PROFILES[key]
      if (!profile) return
      const rand = mulberry32(seed + si * 104729 + 11)
      sweepByStrategy[key] = loadFactors.map((lf) => {
        // boarding time grows super-linearly with load: bins fill, aisles jam
        const growth = 0.42 + 0.58 * Math.pow(lf, 1.65)
        const congestionPenalty = 1 + 0.22 * Math.max(0, lf - 0.8) * (profile.tailSkew - 0.9) * 4
        return Math.round(profile.mean * growth * congestionPenalty * (0.99 + 0.02 * rand()))
      })
    })
    batch.sweep = { loadFactors, byStrategy: sweepByStrategy }
  }

  return batch
}

/** A batch as it looks after exactly one replication of each strategy. */
export function makePartialBatch(options = {}) {
  return makeBatch({ runs: 1, sweep: false, complete: false, runsRequested: 200, ...options })
}

/** A batch mid-flight: some strategies done, some barely started, no sweep. */
export function makeStreamingBatch(options = {}) {
  const batch = makeBatch({ runs: 40, sweep: false, complete: false, runsRequested: 200, ...options })
  const keys = Object.keys(batch.byStrategy)
  keys.slice(3).forEach((key, i) => {
    const entry = batch.byStrategy[key]
    const kept = Math.max(1, 6 - i * 2)
    const values = entry.totalSeconds.values.slice(0, kept)
    const s = sorted(values)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const variance = values.length > 1
      ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1)
      : 0
    entry.runs = values.length
    entry.totalSeconds = {
      mean: Math.round(mean * 10) / 10,
      sd: Math.round(Math.sqrt(variance) * 10) / 10,
      min: s[0],
      max: s[s.length - 1],
      p05: Math.round(pct(s, 0.05) * 10) / 10,
      p50: Math.round(pct(s, 0.5) * 10) / 10,
      p95: Math.round(pct(s, 0.95) * 10) / 10,
      values,
    }
    entry.convergence = convergenceOf(values)
  })
  batch.meta.runsDone = keys.reduce((acc, k) => acc + batch.byStrategy[k].runs, 0)
  return batch
}

/** The zero state: a batch object with nothing in it yet. */
export function makeEmptyBatch() {
  return {
    byStrategy: {},
    meta: { aircraftId: A320.aircraftId, runsRequested: 200, runsDone: 0, complete: false },
  }
}

/** A single RunResult, for components that take one run rather than a batch. */
export function makeRun({ strategy = 'wilma', seed = 4242, loadFactor = 0.95, cabin = A320 } = {}) {
  const profile = STRATEGY_PROFILES[strategy] ?? STRATEGY_PROFILES.wilma
  const rand = mulberry32(seed)
  const seatCount = cabin.rows * cabin.letters.length
  const paxCount = Math.round(seatCount * loadFactor)
  const totalSeconds = Math.round(profile.mean * (1 + profile.cv * gaussian(rand)) * 10) / 10
  const pooled = pooledWaits(profile, paxCount, mulberry32(seed + 1))
  const paxSeconds = totalSeconds * paxCount * 0.55
  return {
    totalSeconds,
    totalMinutes: Math.round((totalSeconds / 60) * 100) / 100,
    strategy,
    aircraftId: cabin.aircraftId,
    seed,
    paxCount,
    seatCount,
    loadFactor,
    seatedCurve: seatedCurveMean(profile, totalSeconds, paxCount).map(({ t, seated }) => ({ t, seated })),
    aisleOccupancy: congestionMean(profile, totalSeconds, cabin.rows, mulberry32(seed + 2))[0]
      .map((count, i) => ({ t: i * 30, count: Math.round(count * paxCount * 0.04) })),
    congestion: congestionMean(profile, totalSeconds, cabin.rows, mulberry32(seed + 3)),
    perPassenger: [],
    timeBreakdown: {
      walk: Math.round(paxSeconds * profile.breakdown.walk),
      stow: Math.round(paxSeconds * profile.breakdown.stow),
      shuffle: Math.round(paxSeconds * profile.breakdown.shuffle),
      blocked: Math.round(paxSeconds * profile.breakdown.blocked),
    },
    interference: {
      none: Math.round(paxCount * profile.interference.none),
      one: Math.round(paxCount * profile.interference.one),
      two: Math.round(paxCount * profile.interference.two),
      sameParty: Math.round(paxCount * profile.interference.sameParty),
    },
    gateChecks: Math.round(profile.gateChecks),
    binSearches: Math.round(paxCount * 0.22),
    aisleBlockEvents: Math.round(paxCount * 0.31),
    p50TimeToSeat: pooled.p50,
    p90TimeToSeat: pooled.p90,
    maxTimeToSeat: pooled.max,
    throughputPaxPerMin: Math.round((paxCount / (totalSeconds / 60)) * 100) / 100,
  }
}
