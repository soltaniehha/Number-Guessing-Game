/**
 * Turning a pile of RunResults into a BatchResult.
 *
 * The shape below is the one `src/charts/ChartGrid.jsx` consumes:
 *
 *   BatchResult {
 *     byStrategy: { [key]: {
 *       runs, name,
 *       totalSeconds: { mean, sd, ci95, min, max, p05, p50, p95, values },
 *       meanBreakdown: { walk, stow, shuffle, blocked },
 *       meanInterference: { none, one, two, sameParty },
 *       meanGateChecks,
 *       seatedCurveMean:   [{ t, seated, p25, p75 }],
 *       congestionMean:    number[row][timeBucket],
 *       perPassengerPooled:{ n, mean, sd, min, p05, p25, p50, p75, p90, p95, max, sample },
 *       seatTimeMean:      { "12A": seconds },
 *       convergence:       [{ n, mean, ciLow, ciHigh }],
 *       sample:            RunResult[]   (a few kept whole)
 *     } },
 *     meta: { aircraftId, loadFactor, paxCount, seatCount, runsRequested, runsDone, complete },
 *   }
 *
 * The real worker is expected to emit the same thing; `readSummaries` below
 * also accepts a flatter `{ strategies: { key: { mean, sd, … } } }` so the
 * shell keeps working if it does not.
 */
import { sampleAt } from '../lib/curves.js'

const round1 = (n) => Math.round(n * 10) / 10
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

function pct(sorted, q) {
  if (!sorted.length) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function stats(values) {
  const s = [...values].sort((a, b) => a - b)
  const n = s.length
  const m = mean(values)
  const variance = n > 1 ? values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (n - 1) : 0
  const sd = Math.sqrt(variance)
  return {
    n,
    mean: round1(m),
    sd: round1(sd),
    ci95: round1(n > 1 ? 1.96 * (sd / Math.sqrt(n)) : 0),
    min: round1(s[0] ?? 0),
    p05: round1(pct(s, 0.05)),
    p25: round1(pct(s, 0.25)),
    p50: round1(pct(s, 0.5)),
    p75: round1(pct(s, 0.75)),
    p90: round1(pct(s, 0.9)),
    p95: round1(pct(s, 0.95)),
    max: round1(s[n - 1] ?? 0),
  }
}

/** Mean seated curve on a common grid, with an inter-run IQR band. */
function seatedCurveMean(runs, step = 15) {
  const longest = Math.max(...runs.map((r) => r.totalSeconds || 0), 1)
  const points = []
  const steps = Math.max(4, Math.round(longest / step))
  for (let i = 0; i <= steps; i += 1) {
    const t = i * step
    const values = runs.map((r) => sampleAt(r.seatedCurve, t, 'seated')).sort((a, b) => a - b)
    points.push({
      t,
      seated: Math.round(mean(values)),
      p25: Math.round(pct(values, 0.25)),
      p75: Math.round(pct(values, 0.75)),
    })
  }
  return points
}

/** Element-wise mean of the row × time-bucket congestion matrices. */
function congestionMean(runs) {
  const grids = runs.map((r) => r.congestion).filter((g) => Array.isArray(g) && g.length)
  if (!grids.length) return null
  const rows = Math.min(...grids.map((g) => g.length))
  const cols = Math.min(...grids.map((g) => Math.min(...g.map((row) => row.length))))
  if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 0 || cols <= 0) return null
  const out = []
  for (let r = 0; r < rows; r += 1) {
    const row = new Array(cols)
    for (let c = 0; c < cols; c += 1) {
      let acc = 0
      for (const g of grids) acc += g[r][c]
      row[c] = Math.round((acc / grids.length) * 100) / 100
    }
    out.push(row)
  }
  return out
}

/** Pooled distribution of individual time-to-seat, thinned to a drawable sample. */
function pooledWaits(runs, sampleSize = 240) {
  const values = []
  for (const r of runs) for (const p of r.perPassenger || []) values.push(p.timeInAisle ?? 0)
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const step = Math.max(1, Math.floor(s.length / sampleSize))
  const sample = []
  for (let i = 0; i < s.length; i += step) sample.push(round1(s[i]))
  return { ...stats(values), sample }
}

/** Mean time-to-seat per seat, keyed "12A". */
function seatTimeMean(runs) {
  const totals = new Map()
  for (const r of runs) {
    for (const p of r.perPassenger || []) {
      const key = p.seat ?? `${p.row}${p.letter}`
      const entry = totals.get(key) || { sum: 0, n: 0 }
      entry.sum += p.timeInAisle ?? 0
      entry.n += 1
      totals.set(key, entry)
    }
  }
  const out = {}
  for (const [key, { sum, n }] of totals) out[key] = round1(sum / n)
  return out
}

/** Running mean with a 95% interval, one point per replication. */
function convergence(values) {
  const out = []
  let sum = 0
  let sq = 0
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i]
    sq += values[i] * values[i]
    const n = i + 1
    const m = sum / n
    let half = 0
    if (n >= 2) {
      const variance = Math.max(0, (sq - n * m * m) / (n - 1))
      half = 1.96 * Math.sqrt(variance / n)
    }
    out.push({ n, mean: round1(m), ciLow: round1(m - half), ciHigh: round1(m + half) })
  }
  return out
}

const meanOf = (runs, pick) => {
  const keys = new Set()
  for (const r of runs) for (const k of Object.keys(pick(r) || {})) keys.add(k)
  const out = {}
  for (const k of keys) out[k] = round1(mean(runs.map((r) => Number(pick(r)?.[k]) || 0)))
  return out
}

/** Summarise one strategy's runs into a byStrategy entry. */
export function summariseStrategy(key, runs, name) {
  const values = runs.map((r) => r.totalSeconds)
  const base = stats(values)
  return {
    key,
    name,
    runs: runs.length,
    totalSeconds: { ...base, values },
    meanBreakdown: meanOf(runs, (r) => r.timeBreakdown),
    meanInterference: meanOf(runs, (r) => r.interference),
    meanGateChecks: round1(mean(runs.map((r) => r.gateChecks || 0))),
    meanBinSearches: round1(mean(runs.map((r) => r.binSearches || 0))),
    seatedCurveMean: seatedCurveMean(runs),
    congestionMean: congestionMean(runs),
    perPassengerPooled: pooledWaits(runs),
    seatTimeMean: seatTimeMean(runs),
    convergence: convergence(values),
    sample: runs.slice(0, 2),
  }
}

/** Assemble the whole BatchResult. */
export function aggregateBatch({ byStrategy, names, config, done, total, complete }) {
  const out = {}
  let paxCount = 0
  let seatCount = 0
  for (const [key, runs] of Object.entries(byStrategy)) {
    if (!runs.length) continue
    out[key] = summariseStrategy(key, runs, names?.[key]?.name)
    paxCount = runs[0].paxCount ?? paxCount
    seatCount = runs[0].seatCount ?? seatCount
  }
  return {
    byStrategy: out,
    // Alias kept so anything reading the flatter shape still works.
    strategies: out,
    meta: {
      aircraftId: config?.aircraftId,
      loadFactor: config?.loadFactor,
      paxCount,
      seatCount,
      runsRequested: config?.runs,
      runsDone: done,
      complete: Boolean(complete),
    },
    done,
    total,
    complete: Boolean(complete),
  }
}

/**
 * Normalised rows for the shell's own read-outs, tolerating either the
 * `byStrategy` shape above or a flat `{ strategies: { key: { mean, … } } }`.
 */
export function readSummaries(batch) {
  const source = batch?.byStrategy || batch?.strategies || {}
  return Object.entries(source)
    .map(([key, entry]) => {
      const t = entry?.totalSeconds && typeof entry.totalSeconds === 'object' ? entry.totalSeconds : entry
      return {
        key,
        name: entry?.name,
        n: entry?.runs ?? entry?.n ?? t?.n ?? 0,
        mean: t?.mean ?? 0,
        sd: t?.sd ?? 0,
        ci95: t?.ci95 ?? (t?.sd && (entry?.runs || t?.n) ? 1.96 * (t.sd / Math.sqrt(entry?.runs || t.n)) : 0),
        min: t?.min ?? 0,
        max: t?.max ?? 0,
        p05: t?.p05 ?? 0,
        p50: t?.p50 ?? 0,
        p95: t?.p95 ?? 0,
        // Bags that never made it into the cabin. An airframe property as much
        // as a strategy one — it is how you can see a tight-binned regional
        // jet behaving like one.
        gateChecks: entry?.meanGateChecks ?? 0,
        binSearches: entry?.meanBinSearches ?? 0,
      }
    })
    .filter((s) => s.n > 0)
}
