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

/**
 * Two-sided 95% t critical values, df 1..30; above that the normal
 * approximation is within 0.5%. The same table `charts/primitives/stats.js`
 * and `sim/batchWorker.js` use — restated rather than imported because this
 * module must not depend on either of those directories.
 */
const T95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086,
  2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
]

/**
 * Two-sided 95% critical value for `df` degrees of freedom.
 *
 * A flat 1.96 is the large-sample limit, and this app routinely reports
 * n = 5..25 where it understates the interval by 41.6% at n=5, 20.7% at n=8
 * and 12.3% at n=12. The chart layer has always used the t form, so a flat
 * 1.96 here put two different numbers for the same quantity on one screen.
 */
export function tCritical95(df) {
  if (!Number.isFinite(df) || df < 1) return NaN
  return df <= 30 ? T95[df - 1] : 1.96
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
    ci95: round1(n > 1 ? tCritical95(n - 1) * (sd / Math.sqrt(n)) : 0),
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

/**
 * Element-wise mean of the row × time-bucket congestion matrices.
 *
 * ZERO-PADDED to the longest run, not cropped to the shortest. Cropping threw
 * away the tail of every longer replication — which is exactly where late jams
 * form, and the reason the congestion chart exists. Padding is not a fudge: a
 * run that has finished has nobody in the aisle, so it genuinely contributes 0
 * to every column past its own end, and dividing by the full run count is the
 * unbiased mean over the whole window. Cropping silently changed the window
 * instead. `sim/batchWorker.js` pads the same way, so the two paths agree.
 */
function congestionMean(runs) {
  const grids = runs.map((r) => r.congestion).filter((g) => Array.isArray(g) && g.length)
  if (!grids.length) return null
  let rows = 0
  let cols = 0
  for (const g of grids) {
    if (g.length > rows) rows = g.length
    for (const row of g) if (row.length > cols) cols = row.length
  }
  if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 0 || cols <= 0) return null
  const out = []
  for (let r = 0; r < rows; r += 1) {
    const row = new Array(cols).fill(0)
    for (const g of grids) {
      const src = g[r]
      if (!src) continue
      for (let c = 0; c < src.length; c += 1) row[c] += src[c]
    }
    for (let c = 0; c < cols; c += 1) row[c] = Math.round((row[c] / grids.length) * 100) / 100
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
      half = tCritical95(n - 1) * Math.sqrt(variance / n)
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

/**
 * True when a run hit `MAX_SIM_SECONDS` and was cut off with people still
 * standing (ENGINE_SPEC §7: "`completed` is false if the run hit
 * `MAX_SIM_SECONDS`. Any consumer that averages `totalSeconds` should check
 * it.").
 *
 * The flag itself is preferred. It is not always there: the batch worker folds
 * each run into an accumulator and keeps only the fields this module reads, and
 * `completed` is not one of them, so by the time a batch is aggregated the flag
 * has been dropped. The *signature* of a truncated run survives that trim
 * intact — it is the run that ended with fewer people seated than there are
 * passengers, because the engine back-fills sit times for everyone still
 * standing but records the true seated count in the closing curve sample. On a
 * completed run the two are equal by construction.
 */
export function isTruncatedRun(run) {
  if (!run) return false
  if (run.completed === false) return true
  if (run.completed === true) return false
  const curve = run.seatedCurve
  const pax = Number(run.paxCount)
  if (!Array.isArray(curve) || curve.length === 0) return false
  if (!Number.isFinite(pax) || pax <= 0) return false
  const last = curve[curve.length - 1]
  const seated = Number(last?.seated)
  return Number.isFinite(seated) && seated < pax
}

/**
 * Summarise one strategy's runs into a byStrategy entry.
 *
 * Truncated runs are excluded from the boarding-time statistics. Their
 * `totalSeconds` is the simulation cap, not a boarding time, and averaging it
 * in produces a distribution piled on the cap and presented as durations — the
 * shipped "nightmare" preset put median, p95 and max all at exactly 2:00:00.
 * They are still counted (`incomplete`) and still contribute to the profile
 * aggregates, which describe what happened during the window rather than how
 * long the window was.
 *
 * When *every* run truncated there is nothing honest to average, so the capped
 * values are used and `allTruncated` says so; consumers must label the figure
 * rather than drop the strategy off the table entirely.
 */
export function summariseStrategy(key, runs, name) {
  const timedAll = runs.filter((r) => !isTruncatedRun(r))
  const incomplete = runs.length - timedAll.length
  const allTruncated = runs.length > 0 && timedAll.length === 0
  const timed = allTruncated ? runs : timedAll
  const values = timed.map((r) => r.totalSeconds)
  const base = stats(values)
  return {
    key,
    name,
    runs: runs.length,
    /** Replications that finished, and so are in `totalSeconds`. */
    timedRuns: timed.length,
    /** Replications cut off at the simulation cap. */
    incomplete,
    allTruncated,
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

/**
 * One entry per congestion-matrix row, in slot order.
 *
 * The matrix is indexed by row SLOT (ENGINE_SPEC §2.1), and a chart labelling
 * rows `slot + 1` is only right for an aircraft that starts at row 1 and skips
 * nothing — on b787_9, slot 30 is row 42. Accepts the engine's `rowSlots`
 * (`{slot, number}`) and the fixture engine's (`{rowNumber}`).
 */
export function rowSlotsOf(aircraft) {
  const slots = aircraft?.rowSlots
  if (!Array.isArray(slots) || slots.length === 0) return undefined
  const out = []
  for (let i = 0; i < slots.length; i += 1) {
    const s = slots[i]
    const number = Number(s?.number ?? s?.rowNumber)
    if (!Number.isFinite(number)) return undefined
    out.push({ slot: Number.isFinite(s?.slot) ? s.slot : i, number })
  }
  return out
}

/**
 * Scenario facts the charts cannot derive from the runs: the congestion
 * matrix's column pitch and the real row numbers behind its row slots.
 *
 * Both are `undefined` when they cannot be established, never guessed — the
 * chart layer has a documented fallback for each and says so on screen, which
 * is better than a confident wrong axis.
 */
export function chartMeta(config, aircraft) {
  const interval = Number(config?.sampleInterval)
  return {
    sampleInterval: Number.isFinite(interval) && interval > 0 ? interval : undefined,
    rowSlots: rowSlotsOf(aircraft),
  }
}

/** Assemble the whole BatchResult. */
export function aggregateBatch({ byStrategy, names, config, aircraft, done, total, complete }) {
  const out = {}
  let paxCount = 0
  let seatCount = 0
  for (const [key, runs] of Object.entries(byStrategy)) {
    if (!runs.length) continue
    out[key] = summariseStrategy(key, runs, names?.[key]?.name)
    paxCount = runs[0].paxCount ?? paxCount
    seatCount = runs[0].seatCount ?? seatCount
  }
  const { sampleInterval, rowSlots } = chartMeta(config, aircraft)
  return {
    byStrategy: out,
    // Alias kept so anything reading the flatter shape still works.
    strategies: out,
    meta: {
      aircraftId: config?.aircraftId,
      loadFactor: config?.loadFactor,
      paxCount,
      seatCount,
      // Seconds per congestion-matrix column, and the printed row number of
      // each of its rows. See `chartMeta`.
      sampleInterval,
      rowSlots,
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
      const runs = entry?.runs ?? entry?.n ?? t?.n ?? 0
      const incomplete = Number(entry?.incomplete) || 0
      return {
        key,
        name: entry?.name,
        n: runs,
        // Replications actually behind the boarding-time figures: a run cut
        // off at the simulation cap is not a boarding time (ENGINE_SPEC §7).
        timedRuns: entry?.timedRuns ?? t?.n ?? runs,
        incomplete,
        allTruncated: Boolean(entry?.allTruncated),
        // Per-replication totals, in run order. Under common random numbers
        // run `i` of every strategy faces the identical manifest, so these
        // line up across strategies and can be compared pairwise.
        values: Array.isArray(t?.values) ? t.values : [],
        mean: t?.mean ?? 0,
        sd: t?.sd ?? 0,
        ci95:
          t?.ci95 ??
          (t?.sd && (entry?.runs || t?.n)
            ? tCritical95((entry?.runs || t.n) - 1) * (t.sd / Math.sqrt(entry?.runs || t.n))
            : 0),
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
