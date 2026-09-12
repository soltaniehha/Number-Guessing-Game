/**
 * The centrepiece: a live top-down cabin where every passenger is a dot.
 *
 * Two stacked canvases. The lower one holds the aeroplane — fuselage, wings,
 * seats, labels, doors — and is repainted only when the size, aircraft or
 * theme changes. The upper one holds the aisle heat, the jet-bridge queues
 * and the dots, and is the only thing touched per animation frame. Every
 * buffer it needs is preallocated, so the draw loop allocates nothing.
 *
 * Accessibility, in three parts, because a canvas has no DOM to inspect:
 *
 *  1. The live region announces MILESTONES — start, each quarter of the cabin
 *     seated, completion, pause and reset — and nothing else. Announcing the
 *     running tally instead put ~5.6 mutations a second into a polite queue
 *     that then never drained.
 *  2. The precise running figures stay reachable on demand as the canvas's
 *     `aria-describedby` text, which is NOT a live region: nothing is lost,
 *     it is simply no longer shouted.
 *  3. The dots are keyboard-reachable: the layer takes focus, the arrow keys
 *     step through passengers, and Escape dismisses the read-out — which is
 *     mirrored, throttled, into its own polite region.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import './cabin.css'
import { buildCabinModel, computeGeometry, mapPassengersToSeats } from './geometry.js'
import { drawDynamicLayer, drawStaticLayer, hitTest, makeScratch } from './draw.js'
import {
  STATE,
  TRAIL_SECONDS,
  describePassenger,
  formatClock,
  frameCursor,
  frameCountOf,
  frameIntervalOf,
  shouldRenderTrail,
} from './playback.js'
import { observeTheme, prefersReducedMotion, readTokens } from './tokens.js'
import PassengerTooltip from './PassengerTooltip.jsx'
import CabinLegend from './CabinLegend.jsx'

/** Below this width the cabin rotates to vertical, nose up. */
const VERTICAL_BREAKPOINT = 620

/**
 * How long the clock has to stand still before playback counts as paused.
 * Long enough to survive a slow animation frame, short enough that the
 * announcement still feels like a response to pressing the button.
 */
const PAUSE_SETTLE_MS = 450

/**
 * Arrow keys can be held down. The inspector read-out waits for the selection
 * to settle before it says anything, so a held key produces one announcement
 * rather than forty.
 */
const INSPECT_THROTTLE_MS = 400

export default function CabinView({
  replay,
  tSeconds = 0,
  showQueue = true,
  showHeat = true,
  onHoverPassenger,
  enabledDoors,
  speed = 1,
  orientation = 'auto',
  renderTooltip = true,
  showLegend = true,
  playing = null,
  className = '',
}) {
  const hostRef = useRef(null)
  const staticRef = useRef(null)
  const dotsRef = useRef(null)
  const scratchRef = useRef(null)
  const detailId = useId()

  const [size, setSize] = useState({ width: 0, height: 0 })
  const [tokens, setTokens] = useState(() => readTokens())
  const [reducedMotion, setReducedMotion] = useState(() => prefersReducedMotion())
  const [hover, setHover] = useState(null)
  const [selected, setSelected] = useState(null)
  const [tally, setTally] = useState(() => [0, 0, 0, 0, 0])

  // --- theme ------------------------------------------------------------
  useEffect(() => {
    const refresh = () => {
      setTokens(readTokens())
      setReducedMotion(prefersReducedMotion())
    }
    refresh()
    return observeTheme(refresh)
  }, [])

  // --- size -------------------------------------------------------------
  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const box = entries[0].contentRect
      setSize((prev) =>
        Math.abs(prev.width - box.width) < 0.5 && Math.abs(prev.height - box.height) < 0.5
          ? prev
          : { width: box.width, height: box.height },
      )
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const aircraft = replay ? replay.aircraft : null
  const model = useMemo(() => (aircraft ? buildCabinModel(aircraft) : null), [aircraft])

  const resolvedOrientation = useMemo(() => {
    if (orientation !== 'auto') return orientation
    if (!size.width || !size.height) return 'horizontal'
    return size.width < VERTICAL_BREAKPOINT || size.width / size.height < 1.15
      ? 'vertical'
      : 'horizontal'
  }, [orientation, size.width, size.height])

  const geom = useMemo(() => {
    if (!aircraft || !model || size.width < 8 || size.height < 8) return null
    return computeGeometry(aircraft, {
      width: size.width,
      height: size.height,
      orientation: resolvedOrientation,
      padding: 14,
      model,
      enabledDoorIds: enabledDoors,
    })
  }, [aircraft, model, size.width, size.height, resolvedOrientation, enabledDoors])

  const seatIndex = useMemo(
    () => (geom && replay ? mapPassengersToSeats(geom, replay.passengers) : null),
    [geom, replay],
  )

  const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 3)

  // --- static layer -----------------------------------------------------
  useEffect(() => {
    const canvas = staticRef.current
    if (!canvas || !geom) return
    sizeCanvas(canvas, geom.width, geom.height, dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawStaticLayer(ctx, geom, tokens, dpr)
  }, [geom, tokens, dpr])

  // --- scratch buffers --------------------------------------------------
  const paxCount = replay ? replay.passengers.length : 0
  useEffect(() => {
    if (!geom || !paxCount) {
      scratchRef.current = null
      return
    }
    const current = scratchRef.current
    if (
      !current ||
      current.paxCount !== paxCount ||
      current.heat.length !== geom.rows.length * geom.laneV.length ||
      current.queueCount.length !== Math.max(1, geom.doors.length)
    ) {
      scratchRef.current = makeScratch(
        paxCount,
        geom.rows.length,
        geom.laneV.length,
        geom.doors.length,
      )
    }
  }, [geom, paxCount])

  // --- dynamic layer, once per animation frame --------------------------
  const activeId = selected ? selected.id : hover ? hover.id : -1
  useEffect(() => {
    const canvas = dotsRef.current
    const scratch = scratchRef.current
    if (!canvas || !geom || !scratch || !replay || !seatIndex) return
    sizeCanvas(canvas, geom.width, geom.height, dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const frameInterval = frameIntervalOf(replay)
    const frameCount = frameCountOf(replay)
    const xs = replay.frames.x
    const states = replay.frames.state
    const { i0, i1, alpha } = frameCursor(tSeconds, frameInterval, frameCount)
    const x0 = xs[i0]
    const x1 = xs[i1]
    const st = states[i0]

    // Linear interpolation between the two bracketing frames; state always
    // comes from the nearest preceding frame.
    const px = scratch.px
    const pstate = scratch.pstate
    if (alpha === 0) {
      for (let i = 0; i < paxCount; i++) {
        px[i] = x0[i]
        pstate[i] = st[i]
      }
    } else {
      for (let i = 0; i < paxCount; i++) {
        const a = x0[i]
        px[i] = a + (x1[i] - a) * alpha
        pstate[i] = st[i]
      }
    }

    let trail = null
    if (shouldRenderTrail(speed, reducedMotion)) {
      const c = frameCursor(tSeconds - TRAIL_SECONDS, frameInterval, frameCount)
      const t0 = xs[c.i0]
      const t1 = xs[c.i1]
      trail = scratch.trail
      if (c.alpha === 0) {
        for (let i = 0; i < paxCount; i++) trail[i] = t0[i]
      } else {
        for (let i = 0; i < paxCount; i++) {
          const a = t0[i]
          trail[i] = a + (t1[i] - a) * c.alpha
        }
      }
    }

    const counts = drawDynamicLayer(ctx, geom, tokens, dpr, {
      replay,
      x: px,
      state: pstate,
      trailX: trail,
      seatIndex,
      showQueue,
      showHeat,
      hoveredId: activeId,
    }, scratch)

    setTally((prev) =>
      prev[0] === counts[0] &&
      prev[1] === counts[1] &&
      prev[2] === counts[2] &&
      prev[3] === counts[3] &&
      prev[4] === counts[4]
        ? prev
        : [counts[0], counts[1], counts[2], counts[3], counts[4]],
    )
  }, [
    geom,
    replay,
    seatIndex,
    tSeconds,
    tokens,
    dpr,
    showQueue,
    showHeat,
    activeId,
    paxCount,
    speed,
    reducedMotion,
  ])

  // --- the precise, continuously-updating description --------------------
  // Deliberately NOT a live region: it changes several times a second. It is
  // the canvas's `aria-describedby`, so it is there whenever it is asked for.
  const detail = replay ? describeState(replay, tally) : ''

  // A mirror of the volatile values, so effects that must not re-run every
  // frame can still read the current ones.
  const nowRef = useRef({ tSeconds, tally, detail })
  nowRef.current = { tSeconds, tally, detail }

  // --- milestone announcements -------------------------------------------
  const total = paxCount
  const seated = tally[STATE.SEATED]
  const [summary, setSummary] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const stageRef = useRef({ replay: null, bucket: -1 })

  useEffect(() => {
    if (!replay) {
      stageRef.current = { replay: null, bucket: -1 }
      setSummary('')
      setAnnouncement('')
      return
    }
    const bucket = seatedBucket(seated, total)
    const fresh = stageRef.current.replay !== replay
    if (!fresh && stageRef.current.bucket === bucket) return
    stageRef.current = { replay, bucket }
    setSummary(summaryText(replay, seated, total, bucket))
    setAnnouncement(milestoneText(replay, seated, total, bucket, fresh, nowRef.current.tSeconds))
  }, [replay, seated, total])

  // --- pause and reset ----------------------------------------------------
  // Reset is visible in the clock itself. Pause is not: when the host does not
  // pass `playing`, a settled clock is the only evidence there is.
  const clockRef = useRef(tSeconds)
  useEffect(() => {
    const previous = clockRef.current
    clockRef.current = tSeconds
    if (tSeconds === previous || !replay) return undefined
    if (tSeconds === 0 && previous > 0) {
      setAnnouncement(`Playback reset to the start. ${summaryText(replay, 0, paxCount, 0)}`)
      return undefined
    }
    if (playing !== null && playing !== undefined) return undefined
    const timer = setTimeout(() => {
      const { tally: current } = nowRef.current
      if (current[STATE.SEATED] >= paxCount) return // the completion milestone covers it
      setAnnouncement(pausedText(current, paxCount, nowRef.current.tSeconds))
    }, PAUSE_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [tSeconds, replay, paxCount, playing])

  const playingRef = useRef(playing)
  useEffect(() => {
    const previous = playingRef.current
    playingRef.current = playing
    if (playing === null || playing === undefined || previous === playing || playing) return
    const { tally: current, tSeconds: t } = nowRef.current
    if (current[STATE.SEATED] >= paxCount) return
    setAnnouncement(pausedText(current, paxCount, t))
  }, [playing, paxCount])

  // --- hover --------------------------------------------------------------
  const handleMove = useCallback(
    (event) => {
      const canvas = dotsRef.current
      const scratch = scratchRef.current
      if (!canvas || !scratch || !geom) return
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const id = hitTest(scratch, x, y, Math.max(9, geom.dotRadius * 2.4))
      setHover((prev) => {
        if (id < 0) return prev === null ? prev : null
        if (prev && prev.id === id && Math.abs(prev.x - event.clientX) < 1 &&
            Math.abs(prev.y - event.clientY) < 1) {
          return prev
        }
        return { id, x: event.clientX, y: event.clientY }
      })
    },
    [geom],
  )

  const handleLeave = useCallback(() => setHover(null), [])

  // --- keyboard -----------------------------------------------------------
  /** Anchor the read-out on a passenger's dot, in viewport coordinates. */
  const anchorOn = useCallback((id) => {
    const canvas = dotsRef.current
    const scratch = scratchRef.current
    if (!canvas || !scratch || id < 0) return null
    const rect = canvas.getBoundingClientRect()
    return { id, x: rect.left + scratch.dotX[id], y: rect.top + scratch.dotY[id] }
  }, [])

  const handleKeyDown = useCallback(
    (event) => {
      const scratch = scratchRef.current
      if (!scratch || !paxCount) return
      const { key } = event
      let step = 0
      if (key === 'ArrowRight' || key === 'ArrowDown') step = 1
      else if (key === 'ArrowLeft' || key === 'ArrowUp') step = -1
      else if (key !== 'Home' && key !== 'End') return

      event.preventDefault()
      const from = selected ? selected.id : -1
      const next =
        key === 'Home'
          ? firstVisible(scratch, 1)
          : key === 'End'
            ? firstVisible(scratch, -1)
            : stepVisible(scratch, from, step)
      if (next < 0) return
      setHover(null)
      setSelected(anchorOn(next))
    },
    [anchorOn, paxCount, selected],
  )

  const handleBlur = useCallback(() => setSelected(null), [])

  // WCAG 1.4.13: content that appears on hover or focus must be dismissable
  // without moving the pointer. The listener is only attached while something
  // is actually showing.
  const showing = Boolean(selected || hover)
  useEffect(() => {
    if (!showing || typeof document === 'undefined') return undefined
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      setSelected(null)
      setHover(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showing])

  // The inspector read-out, throttled: held arrow keys announce once.
  const [inspection, setInspection] = useState('')
  const selectedId = selected ? selected.id : -1
  useEffect(() => {
    if (selectedId < 0 || !replay) {
      setInspection('')
      return undefined
    }
    const timer = setTimeout(() => {
      const scratch = scratchRef.current
      const state = scratch ? scratch.pstate[selectedId] : STATE.QUEUED
      setInspection(describePassenger(replay, selectedId, nowRef.current.tSeconds, state))
    }, INSPECT_THROTTLE_MS)
    return () => clearTimeout(timer)
  }, [selectedId, replay])

  useEffect(() => {
    if (onHoverPassenger) onHoverPassenger(activeId < 0 ? null : activeId)
  }, [activeId, onHoverPassenger])

  if (!replay) {
    return (
      <div className={`cab-view ${className}`.trim()}>
        <div className="cab-view__stage" ref={hostRef}>
          <div className="cab-view__empty">Run a simulation to see the cabin.</div>
        </div>
      </div>
    )
  }

  const readout = selected || hover

  return (
    <div className={`cab-view ${className}`.trim()}>
      <div className="cab-view__stage" ref={hostRef}>
        <canvas ref={staticRef} aria-hidden="true" />
        <canvas
          ref={dotsRef}
          className="cab-view__dots"
          role="img"
          tabIndex={0}
          aria-label={summary}
          aria-describedby={detailId}
          aria-keyshortcuts="ArrowRight ArrowLeft Home End Escape"
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
        />
        <p className="cab-view__sr" id={detailId}>
          {detail} Press the arrow keys to step through passengers one at a time, Home or End for
          the first or last, Escape to dismiss.
        </p>
      </div>

      {showLegend ? <CabinLegend replay={replay} counts={tally} className="cab-view__legend" /> : null}

      <p className="cab-view__sr" role="status" aria-live="polite">{announcement}</p>
      <p className="cab-view__sr" role="status" aria-live="polite">{inspection}</p>

      {renderTooltip && readout ? (
        <PassengerTooltip
          replay={replay}
          paxId={readout.id}
          tSeconds={tSeconds}
          clientX={readout.x}
          clientY={readout.y}
          state={scratchRef.current ? scratchRef.current.pstate[readout.id] : STATE.QUEUED}
        />
      ) : null}
    </div>
  )
}

function sizeCanvas(canvas, width, height, dpr) {
  const w = Math.max(1, Math.round(width * dpr))
  const h = Math.max(1, Math.round(height * dpr))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
}

/** The full running tally, for the on-demand description. */
function describeState(replay, tally) {
  const total = replay.passengers.length
  return (
    `${replay.aircraft.name}: ${tally[STATE.SEATED]} of ${total} seated, ` +
    `${tally[STATE.QUEUED]} still in the jet-bridge queue, ` +
    `${tally[STATE.WALKING]} walking, ` +
    `${tally[STATE.STOWING] + tally[STATE.SHUFFLING]} stowing or shuffling.`
  )
}

/** 0 = under way, 1/2/3 = a quarter, half, three quarters seated, 4 = done. */
export function seatedBucket(seated, total) {
  if (!total) return 0
  if (seated >= total) return 4
  const fraction = seated / total
  if (fraction >= 0.75) return 3
  if (fraction >= 0.5) return 2
  if (fraction >= 0.25) return 1
  return 0
}

/** The canvas label. Updated on the milestone cadence, never per frame. */
function summaryText(replay, seated, total, bucket) {
  const name = replay.aircraft.name
  if (bucket === 4) return `${name}: boarding complete, ${seated} of ${total} seated.`
  if (bucket === 0) return `${name}: ${seated} of ${total} seated, boarding under way.`
  return `${name}: ${seated} of ${total} seated, past ${bucket * 25}% of the cabin.`
}

function milestoneText(replay, seated, total, bucket, fresh, tSeconds) {
  if (bucket === 4) {
    return `Boarding complete — all ${total} passengers seated at ${formatClock(tSeconds)}.`
  }
  if (fresh && bucket === 0) {
    return `${replay.aircraft.name} ready to board: ${total} passengers, none seated yet.`
  }
  const words = ['Boarding under way', 'A quarter of the cabin is seated', 'Half the cabin is seated', 'Three quarters of the cabin is seated']
  return `${words[bucket]} — ${seated} of ${total}.`
}

function pausedText(tally, total, tSeconds) {
  return (
    `Playback paused at ${formatClock(tSeconds)} — ${tally[STATE.SEATED]} of ${total} seated, ` +
    `${tally[STATE.QUEUED]} still queued.`
  )
}

/** The first (or last) passenger currently drawn. */
function firstVisible(scratch, direction) {
  const n = scratch.paxCount
  for (let k = 0; k < n; k++) {
    const i = direction > 0 ? k : n - 1 - k
    if (scratch.dotVisible[i]) return i
  }
  return -1
}

/** The next drawn passenger in index order, wrapping at both ends. */
function stepVisible(scratch, from, direction) {
  const n = scratch.paxCount
  if (n === 0) return -1
  if (from < 0) return firstVisible(scratch, direction)
  for (let k = 1; k <= n; k++) {
    const i = (((from + direction * k) % n) + n) % n
    if (scratch.dotVisible[i]) return i
  }
  return scratch.dotVisible[from] ? from : -1
}
