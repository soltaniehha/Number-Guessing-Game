/**
 * Cabin mode. The cabin renderer itself is owned by another agent; this is the
 * frame around it — playback transport, the run read-out, and a real empty
 * state for before the first run or before src/cabin exists.
 */
import { Suspense } from 'react'
import { CabinView, hasCabinView } from '../../lib/engineBridge.js'
import { useClock, usePlayback, useStore } from '../../state/StoreProvider.jsx'
import { PlaybackBar } from '../PlaybackBar.jsx'
import { EmptyState, CabinGlyph } from './EmptyState.jsx'
import { ErrorBoundary } from '../ErrorBoundary.jsx'
import { fmtClock, fmtInt, fmtNum } from '../../lib/format.js'

/**
 * The cabin renderer owns the Replay contract: a columnar frame buffer
 * (`frames.x` / `frames.state`), a `passengers` array and a resolved
 * `aircraft`. Anything else - an engine that only returns a RunResult, say -
 * degrades to the read-out below instead of crashing the renderer.
 */
function isRenderableReplay(replay) {
  return Boolean(
    replay &&
      replay.aircraft &&
      Array.isArray(replay.passengers) &&
      replay.frames &&
      replay.frames.x &&
      replay.frames.state,
  )
}

export function CabinMode() {
  const { replay, aircraft, run, busy, runError, replayStale } = useStore()
  const renderable = hasCabinView && isRenderableReplay(replay)

  return (
    <div className="mode mode--cabin">
      <div className="viewport">
        {runError && <p className="alert alert--bad">{runError}</p>}
        {replayStale && (
          <p className="alert alert--stale">
            The scenario has changed since this run.{' '}
            <button type="button" className="linkbtn" onClick={run}>
              Run it again
            </button>
          </p>
        )}
        {!replay && !busy && (
          <EmptyState
            icon={CabinGlyph}
            title="Nothing boarding yet"
            body="Set up a scenario on the left and hit Run. The whole flight is simulated up front, so scrubbing and replay are instant."
            action={
              <button type="button" className="btn btn--run" onClick={run}>
                Run the boarding
              </button>
            }
          />
        )}
        {replay && renderable && (
          <ErrorBoundary label="The cabin view">
            <Suspense fallback={<div className="viewport__loading">Loading cabin…</div>}>
              <CabinFrame replay={replay} aircraft={aircraft} />
            </Suspense>
          </ErrorBoundary>
        )}
        {replay && !renderable && <CabinPlaceholder replay={replay} />}
      </div>
      <PlaybackBar />
    </div>
  )
}

function CabinFrame({ replay, aircraft }) {
  const t = useClock()
  const { speed } = usePlayback()
  return <CabinView replay={replay} tSeconds={t} aircraft={aircraft} speed={speed} />
}

const STATE_ROWS = [
  ['waiting', 'waiting'],
  ['walking', 'walking'],
  ['stowing', 'stowing'],
  ['shuffling', 'stowing'],
  ['seated', 'seated'],
]

/**
 * Shown when the cabin renderer is absent or the replay is not in its frame
 * format. Not a seat map, but it proves the replay and the clock are live.
 */
function CabinPlaceholder({ replay }) {
  const t = useClock()
  const result = replay.result || replay
  const counts = tallyAt(replay, t)

  return (
    <div className="placeholder">
      <p className="placeholder__note">
        The cabin renderer is not in this build yet. Everything below is live from the replay buffer.
      </p>
      <div className="readouts">
        <Readout label="Boarding time" value={fmtClock(result.totalSeconds)} />
        <Readout label="Passengers" value={fmtInt(result.paxCount)} />
        <Readout label="Throughput" value={`${fmtNum(result.throughputPaxPerMin, 1)}/min`} />
        <Readout label="Gate checks" value={fmtInt(result.gateChecks)} />
        <Readout label="Median time to seat" value={fmtClock(result.p50TimeToSeat)} />
        <Readout label="Worst time to seat" value={fmtClock(result.maxTimeToSeat)} />
      </div>
      {counts && (
        <div className="statelane" aria-label="Passenger states at the current time">
          {STATE_ROWS.map(([label, token], code) => (
            <div className="statelane__item" key={label}>
              <span className={`dot dot--${token}`} aria-hidden="true" />
              <span className="statelane__label">{label}</span>
              <span className="statelane__count num">{fmtInt(counts[code] || 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Count passengers per state at time t, straight from the frame buffer. */
function tallyAt(replay, t) {
  const rows = replay?.frames?.state
  if (!rows || !rows.length) return null
  const dt = replay.frameInterval || 0.5
  const frame = rows[Math.max(0, Math.min(rows.length - 1, Math.round(t / dt)))]
  const counts = [0, 0, 0, 0, 0]
  for (let i = 0; i < frame.length; i += 1) counts[frame[i]] = (counts[frame[i]] || 0) + 1
  return counts
}

function Readout({ label, value }) {
  return (
    <div className="readout">
      <span className="readout__label">{label}</span>
      <span className="readout__value num">{value}</span>
    </div>
  )
}
