/**
 * The centrepiece: a live top-down cabin where every passenger is a dot.
 *
 * Two stacked canvases. The lower one holds the aeroplane — fuselage, wings,
 * seats, labels, doors — and is repainted only when the size, aircraft or
 * theme changes. The upper one holds the aisle heat, the jet-bridge queues
 * and the dots, and is the only thing touched per animation frame. Every
 * buffer it needs is preallocated, so the draw loop allocates nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './cabin.css'
import { buildCabinModel, computeGeometry, mapPassengersToSeats } from './geometry.js'
import { drawDynamicLayer, drawStaticLayer, hitTest, makeScratch } from './draw.js'
import {
  STATE,
  TRAIL_SECONDS,
  frameCursor,
  frameCountOf,
  frameIntervalOf,
  shouldRenderTrail,
} from './playback.js'
import { observeTheme, prefersReducedMotion, readTokens } from './tokens.js'
import PassengerTooltip from './PassengerTooltip.jsx'

/** Below this width the cabin rotates to vertical, nose up. */
const VERTICAL_BREAKPOINT = 620

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
  className = '',
}) {
  const hostRef = useRef(null)
  const staticRef = useRef(null)
  const dotsRef = useRef(null)
  const scratchRef = useRef(null)

  const [size, setSize] = useState({ width: 0, height: 0 })
  const [tokens, setTokens] = useState(() => readTokens())
  const [reducedMotion, setReducedMotion] = useState(() => prefersReducedMotion())
  const [hover, setHover] = useState(null)
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
  const hoveredId = hover ? hover.id : -1
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
      hoveredId,
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
    hoveredId,
    paxCount,
    speed,
    reducedMotion,
  ])

  // --- hover ------------------------------------------------------------
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

  useEffect(() => {
    if (onHoverPassenger) onHoverPassenger(hover ? hover.id : null)
  }, [hover, onHoverPassenger])

  if (!replay) {
    return (
      <div className={`cab-view ${className}`.trim()} ref={hostRef}>
        <div className="cab-view__empty">Run a simulation to see the cabin.</div>
      </div>
    )
  }

  return (
    <div className={`cab-view ${className}`.trim()} ref={hostRef}>
      <canvas ref={staticRef} aria-hidden="true" />
      <canvas
        ref={dotsRef}
        className="cab-view__dots"
        role="img"
        aria-label={describe(replay, tally)}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      />
      <p className="cab-view__sr" aria-live="polite">{describe(replay, tally)}</p>
      {renderTooltip && hover ? (
        <PassengerTooltip
          replay={replay}
          paxId={hover.id}
          tSeconds={tSeconds}
          clientX={hover.x}
          clientY={hover.y}
          state={scratchRef.current ? scratchRef.current.pstate[hover.id] : STATE.QUEUED}
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

function describe(replay, tally) {
  const total = replay.passengers.length
  return (
    `${replay.aircraft.name}: ${tally[4]} of ${total} seated, ` +
    `${tally[0]} still in the jet-bridge queue, ` +
    `${tally[1]} walking, ${tally[2] + tally[3]} stowing or shuffling.`
  )
}
