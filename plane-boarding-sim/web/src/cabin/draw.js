/**
 * Canvas painting for the cabin view.
 *
 * Split in two: `drawStaticLayer` paints the aeroplane (fuselage, wings,
 * seats, labels, doors) once per size / aircraft / theme change onto an
 * offscreen canvas, and `drawDynamicLayer` paints only the heat wash, the
 * jet-bridge queues and the passenger dots on every animation frame.
 *
 * The dynamic path allocates nothing: all buffers live in the `scratch`
 * object the caller owns.
 */

import {
  classToken,
  heatColor,
  mixColor,
  stateToken,
  withAlpha,
} from './tokens.js'
import { SEAT_UNIT_M, fuselageHalfWidth } from './geometry.js'
import { STATE, compressQueue } from './playback.js'

const LABEL_FONT = '600 %spx ui-monospace, "SF Mono", Menlo, Consolas, monospace'
const BADGE_FONT = '700 %spx ui-monospace, "SF Mono", Menlo, Consolas, monospace'

/** Apply the plan-space transform (device pixels included). */
function planTransform(ctx, geom, dpr) {
  const m = geom.matrix
  ctx.setTransform(m.a * dpr, m.b * dpr, m.c * dpr, m.d * dpr, m.e * dpr, m.f * dpr)
}

/** Reset to screen space so text is never mirrored by the vertical matrix. */
function screenTransform(ctx, dpr) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function sx(geom, u, v) {
  return geom.orientation === 'vertical' ? geom.originX + v : geom.originX + u
}
function sy(geom, u, v) {
  return geom.orientation === 'vertical' ? geom.originY + u : geom.originY + v
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

// ---------------------------------------------------------------------------
// Static layer
// ---------------------------------------------------------------------------

/**
 * Paint the aeroplane. Call on aircraft / size / theme change only.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geom  from `computeGeometry`
 * @param {Record<string,string>} tokens  from `readTokens`
 * @param {number} dpr
 */
export function drawStaticLayer(ctx, geom, tokens, dpr) {
  screenTransform(ctx, dpr)
  ctx.clearRect(0, 0, geom.width, geom.height)

  planTransform(ctx, geom, dpr)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  drawWings(ctx, geom, tokens)
  drawFuselage(ctx, geom, tokens)
  drawCabinFloor(ctx, geom, tokens)
  drawExitRowBands(ctx, geom, tokens)
  drawAisles(ctx, geom, tokens)
  drawSeats(ctx, geom, tokens)
  drawDoors(ctx, geom, tokens)

  screenTransform(ctx, dpr)
  drawRowNumbers(ctx, geom, tokens)
  drawSeatLetters(ctx, geom, tokens)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

function fuselagePath(ctx, geom) {
  const { noseEndU, tailStartU, lengthPx, halfV } = geom
  const tipV = halfV * 0.1
  ctx.beginPath()
  ctx.moveTo(0, 0)
  // Nose cone: ogive up to full width.
  ctx.bezierCurveTo(noseEndU * 0.4, -halfV * 0.66, noseEndU * 0.74, -halfV, noseEndU, -halfV)
  ctx.lineTo(tailStartU, -halfV)
  // Tail: long taper to a blunt tip.
  const tailLen = Math.max(1, lengthPx - tailStartU)
  ctx.bezierCurveTo(
    tailStartU + tailLen * 0.42, -halfV * 0.99,
    tailStartU + tailLen * 0.74, -halfV * 0.52,
    lengthPx, -tipV,
  )
  ctx.lineTo(lengthPx, tipV)
  ctx.bezierCurveTo(
    tailStartU + tailLen * 0.74, halfV * 0.52,
    tailStartU + tailLen * 0.42, halfV * 0.99,
    tailStartU, halfV,
  )
  ctx.lineTo(noseEndU, halfV)
  ctx.bezierCurveTo(noseEndU * 0.74, halfV, noseEndU * 0.4, halfV * 0.66, 0, 0)
  ctx.closePath()
}

function drawFuselage(ctx, geom, tokens) {
  fuselagePath(ctx, geom)
  ctx.fillStyle = tokens.surface
  ctx.fill()
  ctx.strokeStyle = tokens['border-strong']
  ctx.lineWidth = Math.max(1, geom.halfV * 0.022)
  ctx.stroke()
}

function drawWings(ctx, geom, tokens) {
  const { exitU0, exitU1, halfV, wingSpan, lengthPx, tailStartU } = geom
  const rootFore = exitU0 - halfV * 0.55
  const rootAft = exitU1 + halfV * 0.75
  const chord = Math.max(halfV * 0.6, rootAft - rootFore)
  const fill = withAlpha(tokens['surface-3'], 0.75)
  const edge = withAlpha(tokens.border, 0.9)

  for (const sign of [-1, 1]) {
    // Main wing: swept, tapered, hinted rather than fully drawn.
    ctx.beginPath()
    ctx.moveTo(rootFore, sign * halfV * 0.92)
    ctx.lineTo(rootFore + wingSpan * 0.82, sign * (halfV + wingSpan))
    ctx.lineTo(rootFore + wingSpan * 0.82 + chord * 0.3, sign * (halfV + wingSpan))
    ctx.lineTo(rootFore + chord, sign * halfV * 0.92)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = edge
    ctx.lineWidth = 1
    ctx.stroke()

    // Horizontal stabiliser.
    const stabRoot = tailStartU + (lengthPx - tailStartU) * 0.62
    const stabSpan = wingSpan * 0.44
    const stabChord = chord * 0.42
    ctx.beginPath()
    ctx.moveTo(stabRoot, sign * halfV * 0.5)
    ctx.lineTo(stabRoot + stabSpan * 0.85, sign * (halfV * 0.42 + stabSpan))
    ctx.lineTo(stabRoot + stabSpan * 0.85 + stabChord * 0.32, sign * (halfV * 0.42 + stabSpan))
    ctx.lineTo(stabRoot + stabChord, sign * halfV * 0.5)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    ctx.stroke()
  }
}

function drawCabinFloor(ctx, geom, tokens) {
  const { cabinU0, cabinU1, halfV } = geom
  const inset = halfV * 0.06
  roundRectPath(
    ctx,
    cabinU0,
    -halfV + inset,
    cabinU1 - cabinU0,
    (halfV - inset) * 2,
    Math.min(halfV * 0.25, 10),
  )
  ctx.fillStyle = withAlpha(tokens['surface-2'], 0.85)
  ctx.fill()
}

function drawExitRowBands(ctx, geom, tokens) {
  const { rows, halfV } = geom
  ctx.fillStyle = withAlpha(tokens.good, 0.09)
  for (const row of rows) {
    if (!row.isExitRow) continue
    ctx.fillRect(row.u - row.pitchPx / 2, -halfV, row.pitchPx, halfV * 2)
  }
}

function drawAisles(ctx, geom, tokens) {
  const { laneV, cabinU0, cabinU1, seatHeight } = geom
  const w = seatHeight * 1.18
  ctx.fillStyle = withAlpha(tokens.surface, 0.9)
  for (let k = 0; k < laneV.length; k++) {
    ctx.fillRect(cabinU0, laneV[k] - w / 2, cabinU1 - cabinU0, w)
  }
  ctx.strokeStyle = withAlpha(tokens.border, 0.55)
  ctx.lineWidth = 1
  for (let k = 0; k < laneV.length; k++) {
    for (const sign of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(cabinU0, laneV[k] + (sign * w) / 2)
      ctx.lineTo(cabinU1, laneV[k] + (sign * w) / 2)
      ctx.stroke()
    }
  }
}

function drawSeats(ctx, geom, tokens) {
  const { seatU, seatV, seatW, seatH, seatClass } = geom
  const radius = Math.min(geom.seatHeight * 0.3, 3.2)
  const seatBase = tokens['surface-3']
  for (let i = 0; i < seatU.length; i++) {
    const w = seatW[i]
    const h = seatH[i]
    // Empty seats read as furniture: the class tint is only a hint until a
    // passenger lights the seat up in the dynamic layer.
    ctx.fillStyle = mixColor(seatBase, tokens[classToken(seatClass[i])], 0.22)
    roundRectPath(ctx, seatU[i] - w / 2, seatV[i] - h / 2, w, h, radius)
    ctx.fill()
  }
  // A single hairline pass over everything is cheaper than per-seat strokes.
  ctx.strokeStyle = withAlpha(tokens.border, 0.7)
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i < seatU.length; i++) {
    const w = seatW[i]
    const h = seatH[i]
    roundRectPath(ctx, seatU[i] - w / 2, seatV[i] - h / 2, w, h, radius)
  }
  ctx.stroke()
}

function drawDoors(ctx, geom, tokens) {
  const { doors, halfV } = geom
  const size = Math.max(5, Math.min(halfV * 0.3, 13))
  for (const door of doors) {
    const skin = fuselageHalfWidth(geom, door.u) || halfV
    const v = door.side * skin
    const color = door.enabled ? tokens.good : tokens['text-3']

    // Doorway cut in the skin.
    ctx.beginPath()
    ctx.moveTo(door.u - size * 0.62, v)
    ctx.lineTo(door.u + size * 0.62, v)
    ctx.strokeStyle = door.enabled ? color : withAlpha(color, 0.7)
    ctx.lineWidth = Math.max(2, size * 0.28)
    ctx.stroke()

    // Chevron pointing into the cabin.
    ctx.beginPath()
    ctx.moveTo(door.u - size * 0.5, v + door.side * size * 0.92)
    ctx.lineTo(door.u, v + door.side * size * 0.14)
    ctx.lineTo(door.u + size * 0.5, v + door.side * size * 0.92)
    ctx.closePath()
    ctx.lineWidth = Math.max(1.2, size * 0.16)
    ctx.strokeStyle = color
    if (door.enabled) {
      ctx.fillStyle = color
      ctx.fill()
    }
    ctx.stroke()
  }
}

function drawRowNumbers(ctx, geom, tokens) {
  const stride = geom.rowNumberStride
  if (!stride) return
  const size = Math.max(8, Math.min(geom.minPitchPx * 0.62, 11))
  ctx.font = LABEL_FONT.replace('%s', size.toFixed(1))
  ctx.fillStyle = tokens['text-3']
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const offset = geom.halfV + size * 1.15
  for (let i = 0; i < geom.rows.length; i++) {
    const row = geom.rows[i]
    if (stride > 1 && i !== 0 && i !== geom.rows.length - 1 && row.rowNumber % stride !== 0) {
      continue
    }
    if (nearDoor(geom, row.u, 1)) continue
    ctx.fillText(String(row.rowNumber), sx(geom, row.u, offset), sy(geom, row.u, offset))
  }
}

function nearDoor(geom, u, side) {
  for (const door of geom.doors) {
    if (door.side !== side) continue
    if (Math.abs(door.u - u) < geom.halfV * 0.34) return true
  }
  return false
}

function drawSeatLetters(ctx, geom, tokens) {
  if (!geom.showLetters) return
  const size = Math.max(8, Math.min(geom.seatHeight * 0.72, 11))
  ctx.font = LABEL_FONT.replace('%s', size.toFixed(1))
  ctx.fillStyle = tokens['text-3']
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const cabins = geom.aircraft.cabins || []
  let previousKey = null
  for (const cabin of cabins) {
    const key = (cabin.layout || []).join('')
    if (key === previousKey) continue
    previousKey = key
    const lateral = geom.model.lateralByCabin.get(cabin.id)
    if (!lateral) continue
    const u = cabinForeU(geom, cabin.id) - size * 1.2
    for (const [letter, units] of lateral) {
      const v = units * SEAT_UNIT_M * geom.scaleLat
      ctx.fillText(letter, sx(geom, u, v), sy(geom, u, v))
    }
  }
}

function cabinForeU(geom, cabinId) {
  let lo = Infinity
  for (const row of geom.rows) {
    if (row.cabinId === cabinId && row.u - row.pitchPx / 2 < lo) {
      lo = row.u - row.pitchPx / 2
    }
  }
  return Number.isFinite(lo) ? lo : geom.cabinU0
}

// ---------------------------------------------------------------------------
// Dynamic layer
// ---------------------------------------------------------------------------

/**
 * Allocate every buffer the per-frame draw needs. Called on replay change.
 */
export function makeScratch(paxCount, rowCount, laneCount, doorCount) {
  return {
    paxCount,
    /** Screen-space dot centres, for hit testing. */
    dotX: new Float32Array(paxCount),
    dotY: new Float32Array(paxCount),
    dotVisible: new Uint8Array(paxCount),
    /** Interpolated aisle position, metres. */
    px: new Float32Array(paxCount),
    pstate: new Int8Array(paxCount),
    /** Aisle occupancy per (row, lane). */
    heat: new Int16Array(Math.max(1, rowCount * laneCount)),
    /** Passengers still queued, per door. */
    queueCount: new Int32Array(Math.max(1, doorCount)),
    queueBuf: new Float32Array(128),
    tally: new Int32Array(5),
  }
}

/**
 * Paint one frame of passengers.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geom
 * @param {Record<string,string>} tokens
 * @param {number} dpr
 * @param {object} frame
 * @param {object} frame.replay
 * @param {Float32Array|number[]} frame.x        interpolated metres per pax
 * @param {Int8Array|number[]} frame.state       state per pax
 * @param {Float32Array|number[]|null} frame.trailX  position TRAIL_SECONDS ago
 * @param {Int32Array} frame.seatIndex           geometry seat index per pax
 * @param {boolean} frame.showQueue
 * @param {boolean} frame.showHeat
 * @param {number} frame.hoveredId               -1 for none
 * @param {object} scratch  from `makeScratch`
 */
export function drawDynamicLayer(ctx, geom, tokens, dpr, frame, scratch) {
  screenTransform(ctx, dpr)
  ctx.clearRect(0, 0, geom.width, geom.height)

  const { replay } = frame
  const pax = replay.passengers
  const n = pax.length
  scratch.dotVisible.fill(0)
  scratch.tally.fill(0)

  if (frame.showHeat) {
    accumulateHeat(geom, frame, scratch, n)
    planTransform(ctx, geom, dpr)
    paintHeat(ctx, geom, tokens, scratch)
  }

  planTransform(ctx, geom, dpr)
  paintPassengers(ctx, geom, tokens, frame, scratch, n)

  if (frame.showQueue) {
    planTransform(ctx, geom, dpr)
    paintQueues(ctx, geom, tokens, frame, scratch)
    screenTransform(ctx, dpr)
    paintQueueBadges(ctx, geom, tokens, scratch)
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  return scratch.tally
}

function accumulateHeat(geom, frame, scratch, n) {
  const rows = geom.rows
  const lanes = geom.laneV.length
  scratch.heat.fill(0)
  const pax = frame.replay.passengers
  for (let i = 0; i < n; i++) {
    const s = frame.state[i]
    if (s === STATE.QUEUED || s === STATE.SEATED) continue
    const xM = frame.x[i]
    const lane = Math.min(lanes - 1, Math.max(0, pax[i].lane | 0))
    // Rows are monotonic in x, so a linear scan with early exit is fine and
    // avoids building any index per frame.
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]
      if (xM < row.xM - row.halfPitchM) break // rows ascend in x
      if (xM <= row.xM + row.halfPitchM) {
        scratch.heat[r * lanes + lane]++
        break
      }
    }
  }
}

function paintHeat(ctx, geom, tokens, scratch) {
  const rows = geom.rows
  const lanes = geom.laneV.length
  const laneW = geom.seatHeight * 1.9
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    let total = 0
    for (let k = 0; k < lanes; k++) total += scratch.heat[r * lanes + k]
    if (!total) continue
    const intensity = Math.min(1, total / 3)

    // Faint band across the whole row...
    ctx.fillStyle = withAlpha(heatColor(tokens, intensity), 0.1 + intensity * 0.1)
    ctx.fillRect(row.u - row.pitchPx / 2, -geom.halfV, row.pitchPx, geom.halfV * 2)

    // ...and a stronger wash over the lane that is actually blocked.
    for (let k = 0; k < lanes; k++) {
      const count = scratch.heat[r * lanes + k]
      if (!count) continue
      const laneIntensity = Math.min(1, count / 3)
      ctx.fillStyle = withAlpha(
        heatColor(tokens, laneIntensity),
        0.2 + laneIntensity * 0.3,
      )
      ctx.fillRect(
        row.u - row.pitchPx / 2,
        geom.laneV[k] - laneW / 2,
        row.pitchPx,
        laneW,
      )
    }
  }
}

function paintPassengers(ctx, geom, tokens, frame, scratch, n) {
  const pax = frame.replay.passengers
  const r = geom.dotRadius
  const vert = geom.orientation === 'vertical'
  const trail = frame.trailX
  const lanes = geom.laneV.length

  scratch.queueCount.fill(0)
  const doorIndex = geom.doorIndexById || buildDoorIndex(geom)

  // Motion trails first, as one translucent pass under every dot.
  if (trail) {
    ctx.lineCap = 'round'
    ctx.lineWidth = r * 1.15
    ctx.strokeStyle = withAlpha(tokens[stateToken(STATE.WALKING)], 0.28)
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      if (frame.state[i] !== STATE.WALKING) continue
      const lane = Math.min(lanes - 1, Math.max(0, pax[i].lane | 0))
      const v = geom.laneV[lane]
      const u0 = trail[i] * geom.scaleLon
      const u1 = frame.x[i] * geom.scaleLon
      if (Math.abs(u1 - u0) < 0.6) continue
      ctx.moveTo(u0, v)
      ctx.lineTo(u1, v)
    }
    ctx.stroke()
  }

  for (let i = 0; i < n; i++) {
    const s = frame.state[i]
    scratch.tally[s >= 0 && s < 5 ? s : 0]++

    if (s === STATE.QUEUED) {
      const d = doorIndex.get(pax[i].doorId)
      if (d !== undefined) scratch.queueCount[d]++
      continue
    }

    let u
    let v
    if (s === STATE.SEATED) {
      const seatIdx = frame.seatIndex[i]
      u = geom.seatU[seatIdx]
      v = geom.seatV[seatIdx]
    } else {
      const lane = Math.min(lanes - 1, Math.max(0, pax[i].lane | 0))
      u = frame.x[i] * geom.scaleLon
      v = geom.laneV[lane]
    }

    scratch.dotX[i] = vert ? geom.originX + v : geom.originX + u
    scratch.dotY[i] = vert ? geom.originY + u : geom.originY + v
    scratch.dotVisible[i] = 1

    const color = tokens[stateToken(s)]
    ctx.beginPath()
    ctx.arc(u, v, s === STATE.SEATED ? r * 0.82 : r, 0, TAU)
    ctx.fillStyle = color
    ctx.fill()

    if (s === STATE.STOWING || s === STATE.SHUFFLING) {
      // Ring: reads as "busy at this row" without relying on hue.
      ctx.beginPath()
      ctx.arc(u, v, r + Math.max(1.4, r * 0.55), 0, TAU)
      ctx.strokeStyle = color
      ctx.lineWidth = Math.max(1, r * 0.34)
      ctx.stroke()
    }

    if (i === frame.hoveredId) {
      ctx.beginPath()
      ctx.arc(u, v, r + Math.max(3, r * 1.1), 0, TAU)
      ctx.strokeStyle = tokens.text
      ctx.lineWidth = Math.max(1.2, r * 0.3)
      ctx.stroke()
    }
  }
}

const TAU = Math.PI * 2

function buildDoorIndex(geom) {
  const map = new Map()
  for (let i = 0; i < geom.doors.length; i++) map.set(geom.doors[i].id, i)
  geom.doorIndexById = map
  return map
}

function paintQueues(ctx, geom, tokens, frame, scratch) {
  const r = Math.max(1.5, geom.dotRadius * 0.82)
  const waiting = tokens[stateToken(STATE.QUEUED)]
  const doors = geom.doors

  for (let d = 0; d < doors.length; d++) {
    const door = doors[d]
    const count = scratch.queueCount[d]
    door._queueShown = 0
    door._queueHidden = 0
    door._queueCount = count
    if (!count) continue

    const layout = compressQueue(count, {
      length: door.laneLength,
      spacing: r * 2.5,
      minSpacing: r * 1.1,
      maxDots: 220,
      out: scratch.queueBuf,
    })
    scratch.queueBuf = layout.offsets
    door._queueShown = layout.shown
    door._queueHidden = layout.hidden

    const laneV = door.laneV
    const skin = fuselageHalfWidth(geom, door.u) || geom.halfV

    // The jet bridge itself: a stub from the doorway out to the queue lane.
    ctx.beginPath()
    ctx.moveTo(door.u, door.side * skin)
    ctx.lineTo(door.u, laneV)
    ctx.strokeStyle = withAlpha(tokens['border-strong'], 0.8)
    ctx.lineWidth = Math.max(2, r * 2.6)
    ctx.lineCap = 'butt'
    ctx.stroke()

    // Queue lane backing.
    ctx.beginPath()
    ctx.moveTo(door.u, laneV)
    ctx.lineTo(door.u + Math.max(layout.offsets[layout.shown - 1] || 0, r), laneV)
    ctx.strokeStyle = withAlpha(tokens['surface-2'], 0.95)
    ctx.lineWidth = r * 2.9
    ctx.lineCap = 'round'
    ctx.stroke()

    ctx.fillStyle = waiting
    for (let i = 0; i < layout.shown; i++) {
      ctx.beginPath()
      ctx.arc(door.u + layout.offsets[i], laneV, r, 0, TAU)
      ctx.fill()
    }
  }
}

function paintQueueBadges(ctx, geom, tokens, scratch) {
  const size = Math.max(9, Math.min(geom.halfV * 0.22, 12))
  ctx.font = BADGE_FONT.replace('%s', size.toFixed(1))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (let d = 0; d < geom.doors.length; d++) {
    const door = geom.doors[d]
    const count = scratch.queueCount[d]
    if (!count) continue
    const label = String(count)
    const u = door.u - size * 1.9
    const x = sx(geom, u, door.laneV)
    const y = sy(geom, u, door.laneV)
    const w = ctx.measureText(label).width + size * 1.1
    const h = size * 1.6

    roundRectPath(ctx, x - w / 2, y - h / 2, w, h, h / 2)
    ctx.fillStyle = tokens[stateToken(STATE.QUEUED)]
    ctx.fill()
    ctx.fillStyle = tokens['text-inv']
    ctx.fillText(label, x, y)
  }
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/**
 * Nearest visible dot to a screen point, or -1.
 * 400 dots is a trivial linear scan and needs no spatial index.
 */
export function hitTest(scratch, x, y, radius) {
  let best = -1
  let bestDist = radius * radius
  for (let i = 0; i < scratch.paxCount; i++) {
    if (!scratch.dotVisible[i]) continue
    const dx = scratch.dotX[i] - x
    const dy = scratch.dotY[i] - y
    const dist = dx * dx + dy * dy
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}
