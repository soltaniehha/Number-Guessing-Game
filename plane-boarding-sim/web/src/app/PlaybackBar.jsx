/** Transport controls for Cabin mode: play, step, reset, scrub, speed. */
import { SPEEDS, useClock, usePlayback, useStore } from '../state/StoreProvider.jsx'
import { fmtClock, fmtSpeed } from '../lib/format.js'
import { radioGroupKeyDown, rovingTabIndex } from './controls/radioGroup.js'

const SPEED_OPTIONS = SPEEDS.map((value) => ({ value }))

export function PlaybackBar() {
  const playback = usePlayback()
  const t = useClock()
  const { replay } = useStore()
  const has = Boolean(replay) && playback.duration > 0

  return (
    <div className="transport">
      <div className="transport__buttons">
        <button type="button" className="btn btn--icon" onClick={playback.rewind} disabled={!has} title="Reset (R)" aria-label="Reset to the start">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3.5 2v10M12 2 L5.5 7 L12 12 Z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className="btn btn--icon" onClick={() => playback.step(-1)} disabled={!has} title="Step back 1s (left arrow)" aria-label="Step back one second">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M9.5 2 L3.5 7 L9.5 12 Z" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className="btn btn--play"
          onClick={playback.toggle}
          disabled={!has}
          title="Play / pause (Space)"
          aria-label={playback.playing ? 'Pause' : 'Play'}
        >
          {playback.playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3.5 2h2.6v10H3.5zM7.9 2h2.6v10H7.9z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3.5 2 L11.5 7 L3.5 12 Z" fill="currentColor" />
            </svg>
          )}
        </button>
        <button type="button" className="btn btn--icon" onClick={() => playback.step(1)} disabled={!has} title="Step forward 1s (right arrow)" aria-label="Step forward one second">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M4.5 2 L10.5 7 L4.5 12 Z" fill="currentColor" />
          </svg>
        </button>
      </div>

      <span className="transport__clock num">{fmtClock(t)}</span>

      <input
        className="scrub"
        type="range"
        min={0}
        max={Math.max(playback.duration, 0.1)}
        step={0.1}
        value={Math.min(t, playback.duration)}
        disabled={!has}
        aria-label="Scrub the timeline"
        aria-valuetext={fmtClock(t)}
        onChange={(e) => playback.seek(Number(e.target.value))}
      />

      <span className="transport__clock transport__clock--dim num">{fmtClock(playback.duration)}</span>

      <div
        className="speeds"
        role="radiogroup"
        aria-label="Playback speed"
        onKeyDown={(ev) => radioGroupKeyDown(ev, SPEED_OPTIONS, playback.speed, playback.setSpeed)}
      >
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            data-value={s}
            tabIndex={rovingTabIndex(SPEED_OPTIONS, playback.speed, s)}
            aria-checked={playback.speed === s}
            className={`speeds__item num${playback.speed === s ? ' is-active' : ''}`}
            onClick={() => playback.setSpeed(s)}
          >
            {fmtSpeed(s)}
          </button>
        ))}
      </div>
    </div>
  )
}
