/**
 * The instrument strip along the bottom: simulated clock, seated count, bodies
 * in the aisle, playback speed and progress. In Analytics and Compare it shows
 * replication progress instead, because there is no single clock to show.
 */
import { useClock, usePlayback, useStore } from '../state/StoreProvider.jsx'
import { fmtClock, fmtInt, fmtSpeed } from '../lib/format.js'
import { sampleAt } from '../lib/curves.js'
import { readSummaries } from '../state/aggregate.js'
import { runCounts, sweepSpecFor } from '../state/sweep.js'

export function StatusBar({ inert }) {
  const { mode } = useStore()
  return (
    <div className="statusbar" inert={inert}>
      {mode === 'cabin' ? <CabinStatus /> : <BatchStatus />}
    </div>
  )
}

function CabinStatus() {
  const { replay, config, aircraft } = useStore()
  const playback = usePlayback()
  const t = useClock()
  const result = replay?.result

  const paxTotal = result?.paxCount ?? Math.round((config.loadFactor || 0) * (aircraft?.seatCount || 0))
  // Before the clock starts, nobody is aboard. The engine's first curve sample
  // is labelled t=0 but is taken after the first tick has moved people, so
  // reading it straight put "IN AISLE 2" on screen at t=0, before the doors.
  const started = t > 0
  const seated = started && result ? sampleAt(result.seatedCurve, t, 'seated') : 0
  const aisle = started && result ? sampleAt(result.aisleOccupancy, t, 'count') : 0
  const progress = playback.duration > 0 ? t / playback.duration : 0
  // ENGINE_SPEC section 7: `completed` is false when the run hit the two-hour
  // simulation cap. Its `totalSeconds` is that cap, not a boarding time.
  const truncated = result?.completed === false

  return (
    <>
      <Stat label="t" value={fmtClock(t)} wide />
      <Stat label="seated" value={`${fmtInt(seated)}/${fmtInt(paxTotal)}`} />
      <Stat label="in aisle" value={fmtInt(aisle)} />
      <Stat label="speed" value={fmtSpeed(playback.speed)} />
      <div className="statusbar__progress">
        <Progress value={progress} label="Boarding progress" />
      </div>
      <Stat
        label={truncated ? 'cut off at' : 'total'}
        value={result ? fmtClock(result.totalSeconds) : '\u2014'}
        title={
          truncated
            ? 'This run hit the two-hour simulation limit with passengers still standing. It is not a boarding time.'
            : 'Total boarding time for this run'
        }
        emphasis
        warn={truncated}
      />
    </>
  )
}

function BatchStatus() {
  const { batch, config, mode, engine } = useStore()
  // Before a run starts there is no batch to measure, so show the size of the
  // run the Run button would start — sweep included, or the bar would jump.
  const planned = runCounts({
    strategies: mode === 'compare' ? (config.compareStrategies || []).length : 1,
    runs: config.runs,
    sweep: sweepSpecFor(config, mode, engine?.SWEEPABLE),
  }).total
  const total = batch.total || planned
  const frac = total > 0 ? batch.done / total : 0
  const rows = readSummaries(batch.result)
  const best = bestStrategy(rows)
  // ENGINE_SPEC section 7. Replications that hit the two-hour cap are not
  // boarding times and are excluded from the figures; the strip says how many.
  const cutOff = rows.reduce((acc, r) => acc + (r.incomplete || 0), 0)

  return (
    <>
      <Stat label="mode" value={mode === 'compare' ? 'compare' : 'analytics'} />
      <Stat label="runs" value={`${fmtInt(batch.done)}/${fmtInt(total)}`} />
      <Stat
        label="state"
        value={batchState(batch)}
        title={batch.stopped ? 'Stopped part-way; the figures cover the replications that finished.' : undefined}
        warn={batch.stopped}
      />
      <div className="statusbar__progress">
        <Progress value={frac} label="Replication progress" />
      </div>
      {cutOff > 0 && (
        <Stat
          label="cut off"
          value={fmtInt(cutOff)}
          title="Replications that hit the two-hour simulation limit. They are not boarding times and are excluded from the figures."
          warn
        />
      )}
      <Stat label="fastest" value={best ? `${best.key} · ${fmtClock(best.mean)}` : '—'} emphasis />
    </>
  )
}

/**
 * A stopped run is its own state.
 *
 * It used to report `complete` while the chart grid, correctly, said "Run
 * stopped — 637 of 2,000 completed" a few centimetres above.
 */
function batchState(batch) {
  if (batch.running) return 'running'
  if (batch.error) return 'failed'
  if (batch.stopped) return 'stopped'
  return batch.result ? 'complete' : 'idle'
}

function bestStrategy(entries) {
  if (entries.length === 0) return null
  return entries.reduce((a, b) => (a.mean <= b.mean ? a : b))
}

function Stat({ label, value, wide, emphasis, warn, title }) {
  return (
    <div
      className={`stat${wide ? ' stat--wide' : ''}${emphasis ? ' stat--emphasis' : ''}${warn ? ' stat--warn' : ''}`}
      title={title}
    >
      <span className="stat__label">{label}</span>
      <span className="stat__value num">{value}</span>
    </div>
  )
}

function Progress({ value, label }) {
  const pct = Math.max(0, Math.min(1, value || 0)) * 100
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <span className="progress__fill" style={{ width: `${pct}%` }} />
    </div>
  )
}
