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
import { SEAT_UNIT_M, TAIL_TIP_FRACTION, fuselageHalfWidth } from './geometry.js'
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

/**
 * The fuselage outline, nose tip at `u = 0`.
 *
 * Traced clockwise from the radome: ogive nose, parallel tube through the
 * cabin, tail cone tapering to a blunt tip. It must stay in step with
 * `fuselageHalfWidth`, which is what anchors the doors and the tailplane to
 * this same skin.
 */
function fuselagePath(ctx, geom) {
  const { noseEndU, tailStartU, lengthPx, halfV } = geom
  const noseLen = Math.max(1, noseEndU)
  const tailLen = Math.max(1, lengthPx - tailStartU)
  const tipV = halfV * TAIL_TIP_FRACTION
  // A radome is round, not sharp: start the ogive on a small blunt face.
  const noseV = halfV * 0.05
  ctx.beginPath()
  ctx.moveTo(0, -noseV)
  // Control points chosen to track `fuselageHalfWidth`'s `(1 - k^2)^0.62` to
  // within ~2% of the half-width, so the skin the doors are pinned to is the
  // skin that gets drawn. Convex all the way out: an ogive, not a wedge.
  ctx.bezierCurveTo(
    noseLen * 0.06, -halfV * 0.52,
    noseLen * 0.44, -halfV,
    noseEndU, -halfV,
  )
  ctx.lineTo(tailStartU, -halfV)
  ctx.bezierCurveTo(
    tailStartU + tailLen * 0.40, -halfV,
    tailStartU + tailLen * 0.72, -halfV * 0.46,
    lengthPx, -tipV,
  )
  ctx.lineTo(lengthPx, tipV)
  ctx.bezierCurveTo(
    tailStartU + tailLen * 0.72, halfV * 0.46,
    tailStartU + tailLen * 0.40, halfV,
    tailStartU, halfV,
  )
  ctx.lineTo(noseEndU, halfV)
  ctx.bezierCurveTo(
    noseLen * 0.44, halfV,
    noseLen * 0.06, halfV * 0.52,
    0, noseV,
  )
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
  // Wings are filled like the fuselage so the aeroplane reads as one body
  // rather than a silhouette with a shadow behind it.
  const fill = withAlpha(tokens['surface-3'], 0.85)
  const edge = withAlpha(tokens['border-strong'], 0.7)
  ctx.lineWidth = 1

  // The cabin is drawn with the lateral axis exaggerated, so a wing sized off
  // the fuselage half-width would come out stubby and swept the wrong way.
  // Size the chord off the span instead: it keeps the planform believable --
  // and off the whole aeroplane too, so it does not shrink to a fin now that
  // the nose and the tail cone are in the picture. A real root chord is about
  // a seventh of the overall length.
  const exitMid = (exitU0 + exitU1) / 2
  const rootChord = Math.max(
    halfV * 0.42,
    wingSpan * 1.15,
    lengthPx * 0.13,
    (exitU1 - exitU0) + halfV * 0.2,
  )
  const rootFore = exitMid - rootChord * 0.42
  const rootAft = rootFore + rootChord
  const tipFore = rootFore + wingSpan * 0.95
  const tipChord = rootChord * 0.4

  for (const sign of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(rootFore, sign * halfV * 0.8)
    ctx.lineTo(tipFore, sign * (halfV + wingSpan))
    ctx.lineTo(tipFore + tipChord, sign * (halfV + wingSpan))
    ctx.lineTo(rootAft, sign * halfV * 0.8)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = edge
    ctx.stroke()

    // Engine nacelle: the detail that makes the shape unmistakable.
    const nacelleLen = rootChord * 0.52
    const nacelleW = wingSpan * 0.22
    const nu = rootFore + wingSpan * 0.36
    const nv = sign * (halfV + wingSpan * 0.46)
    roundRectPath(ctx, nu - nacelleLen * 0.6, nv - nacelleW / 2, nacelleLen, nacelleW, nacelleW / 2)
    ctx.fillStyle = withAlpha(tokens['surface-3'], 0.95)
    ctx.fill()
    ctx.stroke()

    // Tailplane, rooted on the tapering tail skin.
    //
    // The tip has to be measured OUT from the skin, not from a fraction of it.
    // Taking `skin * 0.6 + span` was fine while the tail was a 0.4 m stub --
    // the root was down near the tip where the skin is thin -- but on a real
    // tail cone the root sits at ~0.77 of the half-width, and `0.6 * 0.77 +
    // 0.62` lands within a pixel or two of the root itself: both tailplanes
    // collapsed into hairline scratches on the skin.
    const tailLen = Math.max(1, lengthPx - tailStartU)
    const stabRoot = tailStartU + tailLen * 0.46
    const skin = fuselageHalfWidth(geom, stabRoot) || halfV * 0.6
    const stabSpan = wingSpan * 0.66
    const stabChord = Math.min(rootChord * 0.62, tailLen * 0.42)
    ctx.beginPath()
    ctx.moveTo(stabRoot, sign * skin * 0.92)
    ctx.lineTo(stabRoot + stabSpan * 0.85, sign * (skin + stabSpan))
    ctx.lineTo(stabRoot + stabSpan * 0.85 + stabChord * 0.42, sign * (skin + stabSpan))
    ctx.lineTo(stabRoot + stabChord, sign * skin * 0.92)
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
  ctx.fillStyle = withAlpha(tokens.good, 0.06)
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
  const size = geom.rowLabelSize
  ctx.font = LABEL_FONT.replace('%s', size.toFixed(1))
  ctx.fillStyle = tokens['text-3']
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const offset = geom.rowLabelV
  const cabinFirst = new Set()
  for (const cabin of geom.aircraft.cabins || []) {
    const first = geom.rows.find((row) => row.cabinId === cabin.id)
    if (first) cabinFirst.add(first.rowNumber)
  }
  for (let i = 0; i < geom.rows.length; i++) {
    const row = geom.rows[i]
    const keep =
      stride === 1 ||
      i === 0 ||
      i === geom.rows.length - 1 ||
      cabinFirst.has(row.rowNumber) ||
      row.rowNumber % stride === 0
    if (!keep) continue
    // A door chevron hangs into the label lane here, so step the number past
    // the chevron rather than dropping a row number altogether. Both gutters
    // are INSIDE the queue lane: `queueLaneOffset` reserved them before the
    // lane was placed, so a label never lands on the dots or the count pill.
    const door = doorNear(geom, row.u, 1)
    const v = door ? geom.rowLabelDoorV : offset
    ctx.fillText(String(row.rowNumber), sx(geom, row.u, v), sy(geom, row.u, v))
  }
}

/** The door whose chevron would sit on top of a row label at `u`, if any. */
function doorNear(geom, u, side) {
  for (const door of geom.doors) {
    if (door.side !== side) continue
    if (Math.abs(door.u - u) < geom.halfV * 0.34) return door
  }
  return null
}

function drawSeatLetters(ctx, geom, tokens) {
  if (!geom.showLetters) return
  const size = Math.max(8, Math.min(geom.seatHeight * 0.72, 11))
  ctx.font = LABEL_FONT.replace('%s', size.toFixed(1))
  ctx.fillStyle = tokens['text-3']
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const cabins = geom.aircraft.cabins || []
  const room = size * 1.6
  const seenLayout = new Set()
  const labelled = new Set()

  // Preferred: a header just forward of the cabin, in whatever room the nose
  // or a galley leaves. Letters crushed against the row ahead look like a bug.
  for (const cabin of cabins) {
    const bounds = geom.cabinGaps.get(cabin.id)
    if (!bounds || bounds.gap < room) continue
    const key = (cabin.layout || []).join('')
    if (seenLayout.has(key)) continue
    seenLayout.add(key)
    labelled.add(cabin.id)
    paintLetterRow(ctx, geom, cabin, bounds.fore - Math.min(bounds.gap, size * 2.2) / 2)
  }

  // Fallback: the main cabin must always be labelled, even on an aircraft
  // whose classes run straight into one another. Put its header aft instead,
  // where the tail always leaves room.
  const main = biggestCabin(geom, cabins)
  if (main && !labelled.has(main.id) && !seenLayout.has((main.layout || []).join(''))) {
    const bounds = geom.cabinGaps.get(main.id)
    if (bounds) paintLetterRow(ctx, geom, main, bounds.aft + size * 1.1)
  }
}

function paintLetterRow(ctx, geom, cabin, u) {
  const lateral = geom.model.lateralByCabin.get(cabin.id)
  if (!lateral) return
  for (const [letter, units] of lateral) {
    const v = units * SEAT_UNIT_M * geom.scaleLat
    ctx.fillText(letter, sx(geom, u, v), sy(geom, u, v))
  }
}

function biggestCabin(geom, cabins) {
  let best = null
  let bestRows = 0
  for (const cabin of cabins) {
    let rows = 0
    for (const row of geom.rows) if (row.cabinId === cabin.id) rows++
    if (rows > bestRows) {
      bestRows = rows
      best = cabin
    }
  }
  return best
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
    trail: new Float32Array(paxCount),
    pstate: new Int8Array(paxCount),
    /** Aisle occupancy per (row, lane). */
    heat: new Int16Array(Math.max(1, rowCount * laneCount)),
    /** Passengers still queued, per door. */
    queueCount: new Int32Array(Math.max(1, doorCount)),
    /** Offset of the last dot drawn in each queue, px along the lane. */
    queueTail: new Float32Array(Math.max(1, doorCount)),
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
  const laneW = geom.seatHeight * 1.5
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    let total = 0
    for (let k = 0; k < lanes; k++) total += scratch.heat[r * lanes + k]
    if (!total) continue
    const intensity = Math.min(1, total / 3)

    // Faint band across the whole row...
    ctx.fillStyle = withAlpha(hotColor(tokens, intensity), 0.05 + intensity * 0.06)
    ctx.fillRect(row.u - row.pitchPx / 2, -geom.halfV, row.pitchPx, geom.halfV * 2)

    // ...and a stronger wash over the lane that is actually blocked.
    for (let k = 0; k < lanes; k++) {
      const count = scratch.heat[r * lanes + k]
      if (!count) continue
      const laneIntensity = Math.min(1, count / 3)
      ctx.fillStyle = withAlpha(
        hotColor(tokens, laneIntensity),
        0.14 + laneIntensity * 0.26,
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

/**
 * We only ever wash rows that already have somebody in them, so the cold end
 * of the ramp is dead weight — and blue would collide with the walking dots.
 * Sample the hot half only: amber for one body, red for a jam.
 */
function hotColor(tokens, intensity) {
  return heatColor(tokens, 0.42 + 0.58 * intensity)
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
      const u0 = geom.planU(trail[i])
      const u1 = geom.planU(frame.x[i])
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
      u = geom.planU(frame.x[i])
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
  const r = geom.queueDotRadius
  const waiting = tokens[stateToken(STATE.QUEUED)]
  const doors = geom.doors

  for (let d = 0; d < doors.length; d++) {
    const door = doors[d]
    const count = scratch.queueCount[d]
    if (!count) continue

    const layout = compressQueue(count, {
      length: door.laneLength,
      spacing: r * 2.5,
      minSpacing: r * 1.1,
      maxDots: 220,
      out: scratch.queueBuf,
    })
    scratch.queueBuf = layout.offsets
    const tail = layout.offsets[layout.shown - 1] || 0
    if (scratch.queueTail) scratch.queueTail[d] = tail

    const laneV = door.laneV
    const dir = door.laneDir || 1
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
    ctx.lineTo(door.u + dir * Math.max(tail, r), laneV)
    ctx.strokeStyle = withAlpha(tokens['surface-2'], 0.95)
    ctx.lineWidth = r * 2.9
    ctx.lineCap = 'round'
    ctx.stroke()

    // Shrink the dots to match however tightly the lane had to compress, so a
    // long queue still reads as individual people rather than a red bar.
    const dotR = Math.max(1.1, Math.min(r, layout.spacing * 0.42))
    ctx.fillStyle = waiting
    for (let i = 0; i < layout.shown; i++) {
      ctx.beginPath()
      ctx.arc(door.u + dir * layout.offsets[i], laneV, dotR, 0, TAU)
      ctx.fill()
    }
  }
}

/** Keep the pill's whole box on the canvas, never half of it. */
const BADGE_MARGIN = 2

/**
 * The live count on each active queue (UI_SPEC 1.1).
 *
 * The pill sits just ahead of the head of the queue, at the door, and falls
 * back to the TAIL of the queue — empty by construction — when the head end
 * has no room: a squat viewport can leave a rear door with a pill-width of
 * nothing behind it.
 *
 * It used to need a hard clamp into the canvas on top of that, because a
 * forward door landed at u <= 0 and "one pill-width further forward" was off
 * the left-hand edge: the busiest queue on the aeroplane drew eighty red dots
 * with no number against them. That was the plan-space datum being wrong, not
 * the pill, and `buildCabinModel` now puts a nose ahead of row 1 — so the
 * clamp is gone, and `test/cabin/roster.test.js` holds every count on the
 * canvas, on every airframe and every viewport, without one.
 */
function paintQueueBadges(ctx, geom, tokens, scratch) {
  const size = geom.queueBadgeSize
  ctx.font = BADGE_FONT.replace('%s', size.toFixed(1))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (let d = 0; d < geom.doors.length; d++) {
    const door = geom.doors[d]
    const count = scratch.queueCount[d]
    if (!count) continue
    const label = String(count)
    const w = ctx.measureText(label).width + size * 1.1
    const h = size * 1.6
    const dir = door.laneDir || 1

    let u = door.u - dir * size * 1.9
    if (!badgeFits(geom, u, door.laneV, w, h)) {
      const tail = scratch.queueTail ? scratch.queueTail[d] : door.laneLength
      u = door.u + dir * ((tail || 0) + w / 2 + size * 0.5)
    }
    const x = sx(geom, u, door.laneV)
    const y = sy(geom, u, door.laneV)

    roundRectPath(ctx, x - w / 2, y - h / 2, w, h, h / 2)
    ctx.fillStyle = tokens[stateToken(STATE.QUEUED)]
    ctx.fill()
    ctx.fillStyle = tokens['text-inv']
    ctx.fillText(label, x, y)
  }
}

/** Does a `w` x `h` pill centred on plan point (u, v) land wholly on canvas? */
function badgeFits(geom, u, v, w, h) {
  const x = sx(geom, u, v)
  const y = sy(geom, u, v)
  return (
    x - w / 2 >= BADGE_MARGIN &&
    x + w / 2 <= geom.width - BADGE_MARGIN &&
    y - h / 2 >= BADGE_MARGIN &&
    y + h / 2 <= geom.height - BADGE_MARGIN
  )
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
