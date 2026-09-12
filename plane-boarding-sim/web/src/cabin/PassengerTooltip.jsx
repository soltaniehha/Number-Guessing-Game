/**
 * Hover read-out for a single passenger.
 *
 * Follows the cursor with `position: fixed` + a transform (so it never
 * triggers layout), is `pointer-events: none` (so it can never steal the
 * hover that spawned it and flicker), and flips side or clamps rather than
 * escaping the viewport.
 */

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  STATE,
  STATE_NAMES,
  enteredFrame,
  formatDuration,
  frameIntervalOf,
  seatedFrame,
} from './playback.js'
import { stateToken } from './tokens.js'

const GAP = 16
const EDGE = 8

export default function PassengerTooltip({
  replay,
  paxId,
  tSeconds,
  clientX,
  clientY,
  state = STATE.QUEUED,
}) {
  const ref = useRef(null)
  const [offset, setOffset] = useState({ x: clientX + GAP, y: clientY + GAP })

  const pax = replay && paxId >= 0 ? replay.passengers[paxId] : null

  const times = useMemo(() => {
    if (!pax) return null
    const dt = frameIntervalOf(replay)
    const entered = enteredFrame(replay, paxId)
    const seated = seatedFrame(replay, paxId)
    return {
      enterTime: entered < 0 ? null : entered * dt,
      sitTime: seated < 0 ? null : seated * dt,
    }
  }, [replay, paxId, pax])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = typeof window === 'undefined' ? 1024 : window.innerWidth
    const vh = typeof window === 'undefined' ? 768 : window.innerHeight

    let x = clientX + GAP
    let y = clientY + GAP
    if (x + w > vw - EDGE) x = clientX - GAP - w
    if (y + h > vh - EDGE) y = clientY - GAP - h
    x = Math.max(EDGE, Math.min(x, vw - w - EDGE))
    y = Math.max(EDGE, Math.min(y, vh - h - EDGE))
    setOffset((prev) => (prev.x === x && prev.y === y ? prev : { x, y }))
  }, [clientX, clientY, paxId])

  if (!pax) return null

  const stateName = STATE_NAMES[state] || STATE_NAMES[0]
  const waiting = state === STATE.QUEUED
    ? tSeconds
    : times.enterTime === null
      ? null
      : Math.max(0, tSeconds - times.enterTime)

  return (
    <div
      ref={ref}
      className="cab-tip"
      role="tooltip"
      style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
    >
      <div className="cab-tip__head">
        <span className="cab-tip__seat">{pax.seatRow}{pax.seatLetter}</span>
        <span
          className="cab-tip__state"
          style={{ color: `var(--${stateToken(state)})` }}
        >
          <i className="cab-tip__swatch" />
          {stateName}
        </span>
      </div>
      <dl className="cab-tip__grid">
        <dt>Group</dt>
        <dd>{pax.groupLabel || pax.tier || '—'}</dd>
        <dt>Party</dt>
        <dd>{pax.party === 1 ? 'solo' : `${pax.party} together`}</dd>
        <dt>Bags</dt>
        <dd>{pax.bags}</dd>
        <dt>Door</dt>
        <dd>{pax.doorId || '—'}</dd>
        {state === STATE.QUEUED ? (
          <>
            <dt>Waiting</dt>
            <dd>{formatDuration(waiting)}</dd>
          </>
        ) : (
          <>
            <dt>In cabin</dt>
            <dd>{waiting === null ? '—' : formatDuration(waiting)}</dd>
          </>
        )}
        {state === STATE.SEATED ? (
          <>
            <dt>Time to seat</dt>
            <dd>{times.sitTime === null ? '—' : formatDuration(times.sitTime)}</dd>
          </>
        ) : null}
      </dl>
    </div>
  )
}
