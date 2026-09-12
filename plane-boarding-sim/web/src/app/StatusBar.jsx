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
  const seated = result ? sampleAt(result.seatedCurve, t, 'seated') : 0
  const aisle = result ? sampleAt(result.aisleOccupancy, t, 'count') : 0
  const progress = playback.duration > 0 ? t / playback.duration : 0

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
        label="total"
        value={result ? fmtClock(result.totalSeconds) : '—'}
        title="Total boarding time for this run"
        emphasis
      />
    </>
  )
}

function BatchStatus() {
  const { batch, config, mode } = useStore()
  // Before a run starts there is no batch to measure, so show the size of the
  // run the Run button would start — sweep included, or the bar would jump.
  const planned = runCounts({
    strategies: mode === 'compare' ? (config.compareStrategies || []).length : 1,
    runs: config.runs,
    sweep: sweepSpecFor(config, mode),
  }).total
  const total = batch.total || planned
  const frac = total > 0 ? batch.done / total : 0
  const best = bestStrategy(batch.result)

  return (
    <>
      <Stat label="mode" value={mode === 'compare' ? 'compare' : 'analytics'} />
      <Stat label="runs" value={`${fmtInt(batch.done)}/${fmtInt(total)}`} />
      <Stat label="state" value={batch.running ? 'running' : batch.result ? 'complete' : 'idle'} />
      <div className="statusbar__progress">
        <Progress value={frac} label="Replication progress" />
      </div>
      <Stat label="fastest" value={best ? `${best.key} · ${fmtClock(best.mean)}` : '—'} emphasis />
    </>
  )
}

function bestStrategy(result) {
  const entries = readSummaries(result)
  if (entries.length === 0) return null
  return entries.reduce((a, b) => (a.mean <= b.mean ? a : b))
}

function Stat({ label, value, wide, emphasis, title }) {
  return (
    <div className={`stat${wide ? ' stat--wide' : ''}${emphasis ? ' stat--emphasis' : ''}`} title={title}>
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
