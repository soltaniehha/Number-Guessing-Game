/**
 * Transport controls for the cabin replay.
 *
 * Controlled: the parent owns `t`, `playing` and `speed` (see `usePlayback`
 * for a ready-made clock). The scrub bar is a real `<input type="range">` so
 * it is keyboard- and screen-reader-accessible for free, drawn on top of a
 * sparkline of the seated-progress curve.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import './cabin.css'
import {
  SPEEDS,
  formatClock,
  formatSpeed,
  frameIntervalOf,
  replayDuration,
  sampleSeries,
  seatedSeries,
} from './playback.js'
import { observeTheme, readTokens, withAlpha } from './tokens.js'

export default function PlaybackControls({
  replay,
  t = 0,
  playing = false,
  speed = 1,
  onSeek,
  onTogglePlay,
  onStep,
  onReset,
  onSpeedChange,
  enableKeyboard = false,
  className = '',
}) {
  const duration = replay ? replayDuration(replay) : 0
  const frameInterval = replay ? frameIntervalOf(replay) : 0.25
  const seated = useMemo(() => (replay ? seatedSeries(replay) : null), [replay])
  const seatedNow = useMemo(() => {
    if (!seated || !seated.length) return 0
    const i = Math.max(0, Math.min(seated.length - 1, Math.round(t / frameInterval)))
    return seated[i]
  }, [seated, t, frameInterval])

  const [tokens, setTokens] = useState(() => readTokens())
  useEffect(() => {
    const refresh = () => setTokens(readTokens())
    refresh()
    return observeTheme(refresh)
  }, [])

  useEffect(() => {
    if (!enableKeyboard || typeof window === 'undefined') return undefined
    const onKey = (event) => {
      const target = event.target
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return
      if (event.key === ' ') {
        event.preventDefault()
        onTogglePlay?.()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        onStep?.(1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        onStep?.(-1)
      } else if (event.key === 'r' || event.key === 'R') {
        onReset?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enableKeyboard, onTogglePlay, onStep, onReset])

  const disabled = !replay || duration <= 0

  return (
    <div className={`cab-play ${className}`.trim()}>
      <div className="cab-play__buttons">
        <button
          type="button"
          className="cab-play__btn cab-play__btn--primary"
          onClick={onTogglePlay}
          disabled={disabled}
          aria-label={playing ? 'Pause' : 'Play'}
          aria-pressed={playing}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type="button"
          className="cab-play__btn"
          onClick={() => onStep?.(-1)}
          disabled={disabled}
          aria-label="Step back one frame"
        >
          <StepIcon back />
        </button>
        <button
          type="button"
          className="cab-play__btn"
          onClick={() => onStep?.(1)}
          disabled={disabled}
          aria-label="Step forward one frame"
        >
          <StepIcon />
        </button>
        <button
          type="button"
          className="cab-play__btn"
          onClick={onReset}
          disabled={disabled}
          aria-label="Reset to the start"
        >
          <ResetIcon />
        </button>
      </div>

      <div className="cab-play__scrub">
        <Sparkline series={seated} progress={duration ? t / duration : 0} tokens={tokens} />
        <input
          className="cab-play__range"
          type="range"
          min={0}
          max={Math.max(duration, 0.001)}
          step={Math.max(duration / 2000, 0.001)}
          value={Math.min(t, duration)}
          disabled={disabled}
          onChange={(event) => onSeek?.(Number(event.target.value))}
          aria-label="Scrub through the boarding timeline"
          aria-valuetext={`${formatClock(t)} of ${formatClock(duration)}, ${Math.round(seatedNow * 100)} percent seated`}
        />
      </div>

      <div className="cab-play__clock">
        <b>{formatClock(t)}</b> / {formatClock(duration)}
      </div>

      <select
        className="cab-play__speed"
        value={speed}
        disabled={disabled}
        onChange={(event) => onSpeedChange?.(Number(event.target.value))}
        aria-label="Playback speed"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {formatSpeed(s)}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * The seated-progress curve, drawn behind the scrubber so the shape of the
 * boarding — the slow start, the mid jam, the final tail — is visible before
 * you scrub anywhere.
 */
function Sparkline({ series, progress, tokens }) {
  const ref = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const box = entries[0].contentRect
      setSize({ width: box.width, height: box.height })
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || size.width < 4 || size.height < 4) return
    const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 3)
    canvas.width = Math.round(size.width * dpr)
    canvas.height = Math.round(size.height * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)
    if (!series || series.length < 2) return

    const pad = 4
    const w = size.width
    const h = size.height
    const points = sampleSeries(series, Math.max(2, Math.round(w)))
    const yOf = (v) => h - pad - v * (h - pad * 2)

    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let i = 0; i < points.length; i++) {
      ctx.lineTo((i / (points.length - 1)) * w, yOf(points[i]))
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fillStyle = withAlpha(tokens['state-seated'], 0.16)
    ctx.fill()

    // Elapsed portion reads solid; the future stays a ghost.
    const cut = Math.max(0, Math.min(1, progress)) * w
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, cut, h)
    ctx.clip()
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let i = 0; i < points.length; i++) {
      ctx.lineTo((i / (points.length - 1)) * w, yOf(points[i]))
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fillStyle = withAlpha(tokens['state-seated'], 0.4)
    ctx.fill()
    ctx.restore()

    ctx.beginPath()
    for (let i = 0; i < points.length; i++) {
      const x = (i / (points.length - 1)) * w
      if (i === 0) ctx.moveTo(x, yOf(points[i]))
      else ctx.lineTo(x, yOf(points[i]))
    }
    ctx.strokeStyle = tokens['state-seated']
    ctx.lineWidth = 1.25
    ctx.stroke()
  }, [series, progress, tokens, size.width, size.height])

  return <canvas ref={ref} className="cab-play__spark" aria-hidden="true" />
}

// --- icons ----------------------------------------------------------------

function PlayIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 1.6 10 6 3 10.4Z" fill="currentColor" />
    </svg>
  )
}
function PauseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 2h2.2v8H3zm3.8 0H9v8H6.8z" fill="currentColor" />
    </svg>
  )
}
function StepIcon({ back = false }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <g transform={back ? 'translate(12,0) scale(-1,1)' : undefined} fill="currentColor">
        <path d="M2.5 2.2 8 6l-5.5 3.8Z" />
        <rect x="8.6" y="2.2" width="1.5" height="7.6" rx="0.6" />
      </g>
    </svg>
  )
}
function ResetIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none">
      <path
        d="M2.4 6a3.6 3.6 0 1 0 1.1-2.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M1.6 1.8v2.4h2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
