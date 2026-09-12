/**
 * Monte Carlo driver: replications, strategy comparisons and load sweeps.
 *
 * Port of `python/plane_boarding/batch.py`.
 *
 * One deliberate design choice: every strategy in a comparison is run against
 * the **same seed sequence**. Because the `pax` stream is seeded independently
 * of the `order` stream, each strategy faces an identical passenger manifest --
 * same bags, same walk speeds, same parties. This is common random numbers, and
 * it removes the manifest as a source of between-strategy variance, so a 20-run
 * comparison discriminates about as well as a few hundred independent runs.
 */
import { getAircraft } from './aircraft.js'
import { simulate } from './engine.js'
import { Aggregate, PairedDifference } from './metrics.js'
import { sortByKey } from './pyutil.js'
import { STRATEGIES } from './strategies.js'

const INTERFERENCE_KEYS = ['none', 'one', 'two', 'sameParty']

/** `n` replications of one strategy. */
export class BatchResult {
  constructor(strategy, aircraftId, loadFactor, results) {
    // Recorded so a paired comparison can VERIFY the pairing rather than assume
    // it. Two batches may only be paired if their seed sequences are identical;
    // otherwise the difference is between unrelated runs and the resulting
    // interval is confidently wrong.
    this.seeds = results.map((r) => r.seed)
    this.pairedVsBaseline = null
    this.strategy = strategy
    this.aircraftId = aircraftId
    this.loadFactor = loadFactor
    this.runs = results.length
    this.totalSeconds = new Aggregate(results.map((r) => r.totalSeconds))
    this.gateChecks = new Aggregate(results.map((r) => Number(r.gateChecks)))
    this.throughput = new Aggregate(results.map((r) => r.throughputPaxPerMin))
    this.timeToSeat = new Aggregate(results.map((r) => r.p90TimeToSeat))
    this.sequencing = new Aggregate(results.map((r) => r.doorSequencing))
    this.paxCount = results.length ? results[0].paxCount : 0
    const agg = { none: 0.0, one: 0.0, two: 0.0, sameParty: 0.0 }
    for (const r of results) for (const k of INTERFERENCE_KEYS) agg[k] += r.interference[k]
    const n = Math.max(1, results.length)
    this.interference = {}
    for (const k of INTERFERENCE_KEYS) this.interference[k] = agg[k] / n
  }

  get mean() {
    return this.totalSeconds.mean
  }

  /** Paired difference of this batch minus `other`. Negative = faster. */
  pairedAgainst(other) {
    if (this.seeds.length !== other.seeds.length ||
        this.seeds.some((s, i) => s !== other.seeds[i])) {
      throw new Error(
        `cannot pair '${this.strategy}' against '${other.strategy}': seed ` +
          'sequences differ, so the replications are not matched',
      )
    }
    return new PairedDifference(
      this.totalSeconds.values,
      other.totalSeconds.values,
      other.strategy,
    )
  }

  toDict(keepValues = false) {
    return {
      strategy: this.strategy,
      name: STRATEGIES[this.strategy] ? STRATEGIES[this.strategy].name : this.strategy,
      aircraftId: this.aircraftId,
      loadFactor: this.loadFactor,
      runs: this.runs,
      paxCount: this.paxCount,
      totalSeconds: this.totalSeconds.toDict(keepValues),
      gateChecks: this.gateChecks.toDict(),
      throughputPaxPerMin: this.throughput.toDict(),
      p90TimeToSeat: this.timeToSeat.toDict(),
      doorSequencing: this.sequencing.toDict(),
      pairedVsBaseline: this.pairedVsBaseline ? this.pairedVsBaseline.toDict() : null,
      interference: { ...this.interference },
    }
  }
}

/** `runs` replications of `cfg`, seeds `seedBase .. seedBase + runs - 1`. */
export function runBatch(cfg, runs = 30, seedBase = null, progress = null) {
  if (runs < 1) throw new Error('runs must be >= 1')
  const base = seedBase === null ? cfg.seed : seedBase
  const ac = getAircraft(cfg.aircraftId)
  const results = []
  for (let i = 0; i < runs; i++) {
    results.push(simulate(cfg.replace({ seed: base + i }), ac))
    if (progress) progress(i + 1, runs)
  }
  return new BatchResult(cfg.strategy, cfg.aircraftId, cfg.loadFactor, results)
}

/** Run every strategy over the same seed sequence, ranked fastest-first. */
export function compareStrategies(cfg, strategies = null, runs = 30, seedBase = null, progress = null) {
  const keys = strategies && strategies.length ? Array.from(strategies) : Object.keys(STRATEGIES)
  const unknown = keys.filter((k) => !Object.prototype.hasOwnProperty.call(STRATEGIES, k))
  if (unknown.length) throw new Error(`unknown strategies: ${JSON.stringify(unknown)}`)
  const out = []
  for (const key of keys) {
    const cb = progress ? (i, total) => progress(key, i, total) : null
    out.push(runBatch(cfg.replace({ strategy: key }), runs, seedBase, cb))
  }
  sortByKey(out, (b) => b.mean)
  // Attach the paired comparison against the `random` baseline. This is the
  // number that answers "is this strategy really better", as against the
  // marginal interval which answers "how long will it actually take".
  const baseline = out.find((b) => b.strategy === 'random') ?? (out.length ? out[0] : null)
  if (baseline !== null) for (const b of out) b.pairedVsBaseline = b.pairedAgainst(baseline)
  return out
}

/**
 * Boarding time vs seat load factor.
 *
 * Schultz found the relationship is linear for both one-door and two-door
 * aircraft across strategies, so a visibly non-linear sweep is a signal that
 * something in the model is saturating when it should not be.
 */
export function loadSweep(cfg, loadFactors, strategies = null, runs = 15, seedBase = null, progress = null) {
  const keys = strategies && strategies.length ? Array.from(strategies) : [cfg.strategy]
  const out = {}
  for (const key of keys) {
    const series = []
    for (const lf of loadFactors) {
      const cb = progress ? (i, total) => progress(key, lf, i, total) : null
      series.push(runBatch(cfg.replace({ strategy: key, loadFactor: lf }), runs, seedBase, cb))
    }
    out[key] = series
  }
  return out
}
