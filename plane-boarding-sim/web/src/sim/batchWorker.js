/**
 * Monte Carlo batch worker.
 *
 * Protocol (see `src/state/batchRunner.js`, which drives this):
 *
 *   in    {type:'start', config, strategies:[...], runs:N, sweep?:{loadFactors:[...], runs?:N}}
 *         {type:'stop'}
 *   out   {type:'progress', done, total, partial:BatchResult}
 *         {type:'done', result:BatchResult}
 *         {type:'error', message}
 *
 * The `BatchResult` shape is the one `src/state/aggregate.js` builds and
 * `src/charts/` consumes. It is produced HERE by calling that module's own
 * `summariseStrategy`, so the two cannot drift -- with one exception, below.
 *
 * ## Why this does not simply hold every RunResult
 *
 * The shell's default batch is 200 replications of 7 strategies. Retaining
 * 1400 complete `RunResult`s costs ~300 MB (every per-passenger record and
 * every row x time congestion matrix), and re-aggregating all of them for each
 * progress message costs ~500 ms a go. Both are unacceptable in a browser tab.
 *
 * So each run is folded into an accumulator the moment it finishes and then
 * dropped. Three of `aggregate.js`'s outputs are the ones that need the raw
 * runs -- `congestionMean`, `perPassengerPooled` and `seatTimeMean` -- and each
 * is computed here incrementally, in the same order and with the same
 * arithmetic, so the answer is bit-for-bit what `aggregateBatch` would have
 * returned. `web/test/sim/batchWorker.test.js` asserts exactly that against a
 * full-fat `aggregateBatch` run, which is what keeps this honest.
 *
 * Everything else (`totalSeconds` stats, the breakdown means, the seated curve
 * band, `convergence`) is computed by `summariseStrategy` from a trimmed run
 * record that keeps every field it reads.
 */
import { aggregateBatch, summariseStrategy } from '../state/aggregate.js'
import { STRATEGIES, runSimulation } from './index.js'

/** Yield to the message queue at least this often, so `stop` lands promptly. */
const SLICE_MS = 25
/** Never post progress more often than this. */
const MIN_PROGRESS_MS = 200
/**
 * ...and never spend more than 1/(this) of the run budget on aggregating and
 * posting progress. Self-tuning: a big batch aggregates more slowly, so it
 * automatically reports less often rather than grinding to a halt.
 */
const PROGRESS_DUTY = 4

const round1 = (n) => Math.round(n * 10) / 10
const meanOf = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** `pct` from `state/aggregate.js`, restated so the pooled stats match it. */
function pct(sorted, q) {
  if (!sorted.length) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** `stats` from `state/aggregate.js`, restated for the pooled wait sample. */
function stats(values) {
  const s = [...values].sort((a, b) => a - b)
  const n = s.length
  const m = meanOf(values)
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

/**
 * Everything one strategy's replications contribute, folded in as they arrive.
 */
class StrategyAccumulator {
  constructor(key) {
    this.key = key
    /** Trimmed runs: every field `summariseStrategy` reads, and nothing else. */
    this.lean = []
    /** The first two runs kept whole, for the documented `sample` field. */
    this.sample = []
    // congestionMean
    this.sumGrid = null
    this.accRows = 0
    this.accCols = 0
    this.minRows = Infinity
    this.minCols = Infinity
    this.gridCount = 0
    // perPassengerPooled -- kept in run order, because `stats` means and
    // variances are summed in that order.
    this.waits = []
    // seatTimeMean -- insertion order is the first-seen order, as in aggregate.js
    this.seatTotals = new Map()
  }

  add(result) {
    if (this.sample.length < 2) this.sample.push(result)

    this.lean.push({
      totalSeconds: result.totalSeconds,
      paxCount: result.paxCount,
      seatCount: result.seatCount,
      gateChecks: result.gateChecks,
      binSearches: result.binSearches,
      timeBreakdown: result.timeBreakdown,
      interference: result.interference,
      seatedCurve: result.seatedCurve,
      perPassenger: [],
    })

    const grid = result.congestion
    if (Array.isArray(grid) && grid.length) {
      if (this.sumGrid === null) {
        this.accRows = grid.length
        this.accCols = Math.min(...grid.map((row) => row.length))
        this.sumGrid = []
        for (let r = 0; r < this.accRows; r++) this.sumGrid.push(new Float64Array(this.accCols))
      }
      let gridCols = Infinity
      for (const row of grid) if (row.length < gridCols) gridCols = row.length
      if (grid.length < this.minRows) this.minRows = grid.length
      if (gridCols < this.minCols) this.minCols = gridCols
      // Only cells inside the accumulator can ever be read back: `minRows` and
      // `minCols` are minima over every grid INCLUDING the first, which sized
      // it. Adding in run order reproduces aggregate.js's summation order.
      const rows = Math.min(this.accRows, grid.length)
      for (let r = 0; r < rows; r++) {
        const src = grid[r]
        const dst = this.sumGrid[r]
        const cols = Math.min(this.accCols, src.length)
        for (let c = 0; c < cols; c++) dst[c] += src[c]
      }
      this.gridCount += 1
    }

    for (const p of result.perPassenger || []) {
      const w = p.timeInAisle ?? 0
      this.waits.push(w)
      const seatKey = p.seat ?? `${p.row}${p.letter}`
      const entry = this.seatTotals.get(seatKey)
      if (entry === undefined) this.seatTotals.set(seatKey, { sum: w, n: 1 })
      else {
        entry.sum += w
        entry.n += 1
      }
    }
  }

  congestionMean() {
    if (!this.gridCount) return null
    const rows = this.minRows
    const cols = this.minCols
    if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 0 || cols <= 0) return null
    const out = []
    for (let r = 0; r < rows; r++) {
      const row = new Array(cols)
      const src = this.sumGrid[r]
      for (let c = 0; c < cols; c++) row[c] = Math.round((src[c] / this.gridCount) * 100) / 100
      out.push(row)
    }
    return out
  }

  pooledWaits(sampleSize = 240) {
    const values = this.waits
    if (!values.length) return null
    const s = [...values].sort((a, b) => a - b)
    const step = Math.max(1, Math.floor(s.length / sampleSize))
    const sample = []
    for (let i = 0; i < s.length; i += step) sample.push(round1(s[i]))
    return { ...stats(values), sample }
  }

  seatTimeMean() {
    const out = {}
    for (const [key, { sum, n }] of this.seatTotals) out[key] = round1(sum / n)
    return out
  }

  summarise(name) {
    const entry = summariseStrategy(this.key, this.lean, name)
    entry.congestionMean = this.congestionMean()
    entry.perPassengerPooled = this.pooledWaits()
    entry.seatTimeMean = this.seatTimeMean()
    entry.sample = this.sample
    return entry
  }
}

/** Assemble the BatchResult from the accumulators, `aggregateBatch`-shaped. */
function assemble(accs, names, config, done, total, complete, sweep) {
  const byStrategy = {}
  let paxCount = 0
  let seatCount = 0
  for (const [key, acc] of accs) {
    if (!acc.lean.length) continue
    byStrategy[key] = acc.summarise(names?.[key]?.name)
    paxCount = acc.lean[0].paxCount ?? paxCount
    seatCount = acc.lean[0].seatCount ?? seatCount
  }
  return {
    byStrategy,
    // Alias kept so anything reading the flatter shape still works.
    strategies: byStrategy,
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
    ...(sweep ? { sweep } : {}),
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

let cancelled = false
let running = false

const yieldToQueue = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Build the flat list of jobs. Every strategy is run over the SAME seed
 * sequence -- common random numbers -- so a comparison at n runs discriminates
 * about as well as a few hundred independent ones would. The sweep reuses the
 * same seeds at each load factor for the same reason.
 */
function planJobs(config, strategies, runs, sweep) {
  const jobs = []
  const baseSeed = Number.isFinite(config?.seed) ? Math.trunc(config.seed) : 0
  for (const key of strategies) {
    for (let i = 0; i < runs; i++) jobs.push({ kind: 'main', key, seed: baseSeed + i })
  }
  if (sweep && Array.isArray(sweep.loadFactors) && sweep.loadFactors.length) {
    // A sweep is a second axis on top of an already-large batch, so it gets its
    // own, smaller replication count unless the caller names one.
    const sweepRuns = Number.isFinite(sweep.runs)
      ? Math.max(1, Math.trunc(sweep.runs))
      : Math.max(3, Math.min(12, Math.round(runs / 4)))
    for (const key of strategies) {
      for (let li = 0; li < sweep.loadFactors.length; li++) {
        for (let i = 0; i < sweepRuns; i++) {
          jobs.push({ kind: 'sweep', key, li, loadFactor: sweep.loadFactors[li], seed: baseSeed + i })
        }
      }
    }
  }
  return jobs
}

async function start(msg) {
  const config = msg.config || {}
  const strategies =
    Array.isArray(msg.strategies) && msg.strategies.length
      ? msg.strategies
      : [config.strategy].filter(Boolean)
  const runs = Math.max(1, Math.trunc(msg.runs ?? config.runs ?? 1))
  const sweepSpec = msg.sweep && Array.isArray(msg.sweep.loadFactors) ? msg.sweep : null

  const accs = new Map(strategies.map((k) => [k, new StrategyAccumulator(k)]))
  const jobs = planJobs(config, strategies, runs, sweepSpec)
  const total = jobs.length

  // Running sums for the sweep, so a partial sweep still plots honestly.
  let sweep = null
  if (sweepSpec) {
    sweep = { loadFactors: [...sweepSpec.loadFactors], byStrategy: {} }
    for (const key of strategies) sweep.byStrategy[key] = sweepSpec.loadFactors.map(() => null)
  }
  const sweepSums = new Map()

  let done = 0
  let lastPost = 0
  let lastPostCost = 0
  let sliceStart = performance.now()

  const postProgress = (complete) => {
    const t0 = performance.now()
    const partial = assemble(accs, STRATEGIES, config, done, total, complete, sweep)
    emit(
      complete
        ? { type: 'done', done, total, result: partial }
        : { type: 'progress', done, total, partial },
    )
    lastPostCost = performance.now() - t0
    lastPost = performance.now()
  }

  for (const job of jobs) {
    if (cancelled) return
    const result = runSimulation({
      ...config,
      strategy: job.key,
      seed: job.seed,
      ...(job.kind === 'sweep' ? { loadFactor: job.loadFactor } : {}),
    })
    if (job.kind === 'main') {
      accs.get(job.key).add(result)
    } else {
      const cell = `${job.key}|${job.li}`
      const acc = sweepSums.get(cell) || { sum: 0, n: 0 }
      acc.sum += result.totalSeconds
      acc.n += 1
      sweepSums.set(cell, acc)
      sweep.byStrategy[job.key][job.li] = acc.sum / acc.n
    }
    done += 1

    const now = performance.now()
    if (now - sliceStart >= SLICE_MS) {
      // Aggregating and cloning a BatchResult is not free, so back off from it
      // in proportion to what it actually cost last time.
      const gap = Math.max(MIN_PROGRESS_MS, lastPostCost * PROGRESS_DUTY)
      if (done < total && now - lastPost >= gap) postProgress(false)
      await yieldToQueue()
      if (cancelled) return
      sliceStart = performance.now()
    }
  }

  postProgress(true)
}

/** `postMessage` is only defined inside a real Worker; tests import the module. */
const emit = (payload) => {
  if (typeof postMessage === 'function') postMessage(payload)
}

/** Handle one inbound protocol message. Exported so tests can drive it. */
export function handleMessage(ev) {
  const msg = (ev && ev.data) || {}
  if (msg.type === 'stop') {
    cancelled = true
    return
  }
  if (msg.type !== 'start') return
  if (running) {
    cancelled = true
    return
  }
  cancelled = false
  running = true
  Promise.resolve()
    .then(() => start(msg))
    .catch((err) => {
      emit({ type: 'error', message: (err && err.message) || String(err) })
    })
    .finally(() => {
      running = false
    })
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = handleMessage
}

// Exported for `web/test/sim/batchWorker.test.js`, which drives the same code
// path without a real Worker.
export { StrategyAccumulator, assemble, planJobs, start }
