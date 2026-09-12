/**
 * Monte Carlo driver: replications, strategy comparisons and load sweeps.
 *
 * Port of `python/plane_boarding/batch.py`.
 *
 * One deliberate design choice: every strategy in a comparison is run against
 * the **same seed sequence**. Each strategy then faces an identical passenger
 * manifest -- same bags, same walk speeds, same parties -- because the `pax`
 * stream is seeded independently of the `order` stream, AND each passenger's own
 * service draws come from sub-streams keyed on that passenger rather than on
 * when they happen to board (ENGINE_SPEC 1.3). So the same traveller stows the
 * same bag in the same time whatever the boarding order, and the k-th arrival at
 * a door waits the same drawn gap. This is common random numbers, and it removes
 * the manifest and the service draws as sources of between-strategy variance, so
 * a 20-run comparison discriminates about as well as a few hundred independent
 * runs.
 *
 * What it does NOT remove, and cannot, is the interaction: a given manifest
 * suits some orderings better than others, and that is the effect measured.
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
    // p90 of the time each passenger spent between the aircraft door and their
    // seat. `timeToSeat` keeps its name because consumers use it, but it is now
    // the aisle quantity, i.e. what the name always claimed.
    this.timeToSeat = new Aggregate(results.map((r) => r.p90AisleSeconds))
    // p90 of the wait from doors-open to seated, jetbridge queue included.
    this.boardingWait = new Aggregate(results.map((r) => r.p90BoardingWaitSeconds))
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
      p90AisleSeconds: this.timeToSeat.toDict(),
      p90BoardingWaitSeconds: this.boardingWait.toDict(),
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
 * Parameters the sweep axis is offered for, with the label a UI would print.
 *
 * `loadFactor` is the classic one. `preboardRate` earns its place because the
 * regime changes: at the shipped 2.5% preboarding is a prologue, but leisure
 * routes credibly run 20-33% (RESEARCH_AIRLINES 3.2, 7 #9), and somewhere above
 * ~15% the preboard block stops being a prologue and becomes the thing that sets
 * the boarding time -- at which point the ordering strategy underneath it barely
 * matters. That regime change is invisible unless you can sweep it.
 */
export const SWEEPABLE = {
  loadFactor: 'seat load factor',
  preboardRate: 'preboarding fraction of the cabin',
  nonComplianceRate: 'fraction ignoring their called group',
  lateRate: 'fraction arriving late',
  stowPassSpeedFactor: 'squeeze-past speed fraction',
  binCongestionWeight: 'bin-congestion stow penalty',
  eliteForwardBias: 'forward concentration of status',
  zoneCount: 'number of boarding zones',
}

/**
 * Boarding time vs any one swept scenario parameter.
 *
 * Schultz found the load-factor relationship is linear for both one-door and
 * two-door aircraft across strategies, so a visibly non-linear load sweep is a
 * signal that something in the model is saturating when it should not be. The
 * other axes have no such expectation -- `preboardRate` in particular is
 * expected to bend, and finding where it bends is the point of sweeping it.
 */
export function paramSweep(cfg, param, values, strategies = null, runs = 15, seedBase = null, progress = null) {
  if (!Object.prototype.hasOwnProperty.call(SWEEPABLE, param)) {
    throw new Error(
      `cannot sweep '${param}'; sweepable parameters: ${JSON.stringify(Object.keys(SWEEPABLE).sort())}`,
    )
  }
  const keys = strategies && strategies.length ? Array.from(strategies) : [cfg.strategy]
  const out = {}
  for (const key of keys) {
    const series = []
    for (const v of values) {
      const cb = progress ? (i, total) => progress(key, v, i, total) : null
      series.push(runBatch(cfg.replace({ strategy: key, [param]: v }), runs, seedBase, cb))
    }
    out[key] = series
  }
  return out
}

/** Boarding time vs seat load factor. Thin wrapper over `paramSweep`. */
export function loadSweep(cfg, loadFactors, strategies = null, runs = 15, seedBase = null, progress = null) {
  return paramSweep(cfg, 'loadFactor', loadFactors, strategies, runs, seedBase, progress)
}
