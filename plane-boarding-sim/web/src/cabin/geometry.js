/**
 * Cabin geometry: turns an `Aircraft` description into pixel coordinates.
 *
 * Everything is computed in **plan space**: `u` runs aft along the fuselage
 * from the nose datum, `v` runs laterally from the centreline, both already in
 * CSS pixels. A single 2x2 transform maps plan space to the screen, so the
 * whole renderer works in one coordinate system and "rotate to vertical on
 * narrow screens" is a matrix swap rather than a second code path.
 *
 * Physical constants come from docs/ENGINE_SPEC.md 2.
 */

/** Lateral pitch of one seat, metres. 0.46 m puts a 3-3 tube at ~3.8 m. */
export const SEAT_UNIT_M = 0.46
/** Aisle width expressed in seat units (1.15 * 0.46 = 0.53 m). */
export const AISLE_UNITS = 1.15
/** Sidewall thickness outside the outermost seat, metres. */
export const WALL_M = 0.26
/**
 * Lateral exaggeration cap. A real airliner is ~10:1, which wastes a wide
 * viewport, so we stretch across the fuselage by up to this factor when there
 * is spare room. It still reads unmistakably as an aeroplane.
 */
export const MAX_LATERAL_EXAGGERATION = 2.4
/** Wing half-span as a multiple of the fuselage half-width. */
export const WING_SPAN_FACTOR = 0.85
/** Lateral offset of the jet-bridge queue lane, as a multiple of half-width. */
export const QUEUE_LANE_FACTOR = 1.42

/** Below these pixel sizes labels are dropped rather than crushed. */
export const MIN_PX_FOR_LETTERS = 8.5
export const MIN_PX_FOR_ROW_NUMBERS = 11

const DEFAULT_PITCH_M = 0.79

// ---------------------------------------------------------------------------
// Lateral layout
// ---------------------------------------------------------------------------

/**
 * Work out where each aisle sits laterally, in seat units, from the widest
 * cabin layout. Aisles are shared by every cabin so a 1-2-1 business section
 * lines up with the 3-4-3 economy behind it.
 */
export function computeAisleUnits(cabins, aisleCount) {
  const lanes = Math.max(1, aisleCount || 1)
  if (lanes === 1) return [0]

  // Widest middle block decides how far apart the two aisles sit.
  let widestMiddle = 0
  for (const cabin of cabins || []) {
    const blocks = splitLayout(cabin.layout)
    for (let b = 1; b < blocks.length - 1; b++) {
      if (blocks[b].length > widestMiddle) widestMiddle = blocks[b].length
    }
  }
  if (!widestMiddle) widestMiddle = 4
  const half = widestMiddle / 2 + AISLE_UNITS / 2
  const out = []
  for (let k = 0; k < lanes; k++) {
    out.push(-half + (k * 2 * half) / Math.max(1, lanes - 1))
  }
  return out
}

/** Split a layout array on `'|'` into seat blocks. */
export function splitLayout(layout) {
  const blocks = [[]]
  for (const cell of layout || []) {
    if (cell === '|') blocks.push([])
    else blocks[blocks.length - 1].push(cell)
  }
  return blocks
}

/**
 * Lateral position, in seat units, of every seat letter in one cabin.
 *
 * Outer blocks are packed against their aisle; middle blocks are centred in
 * the gap between the two aisles they sit between.
 */
export function cabinLateralUnits(layout, aisleUnits) {
  const blocks = splitLayout(layout)
  const half = AISLE_UNITS / 2
  const out = new Map()
  const lanes = aisleUnits.length

  for (let b = 0; b < blocks.length; b++) {
    const seats = blocks[b]
    if (!seats.length) continue
    const leftAisle = b - 1 // aisle index immediately left of this block
    const rightAisle = b // aisle index immediately right of this block

    if (leftAisle < 0) {
      // Outboard block on the port side: pack leftwards from aisle 0.
      const edge = aisleUnits[0] - half
      for (let s = 0; s < seats.length; s++) {
        out.set(seats[s], edge - (seats.length - s - 0.5))
      }
    } else if (rightAisle >= lanes) {
      // Outboard block on the starboard side.
      const edge = aisleUnits[lanes - 1] + half
      for (let s = 0; s < seats.length; s++) out.set(seats[s], edge + s + 0.5)
    } else {
      // Centre block between two aisles.
      const lo = aisleUnits[leftAisle] + half
      const hi = aisleUnits[rightAisle] - half
      const mid = (lo + hi) / 2
      const start = mid - seats.length / 2
      for (let s = 0; s < seats.length; s++) out.set(seats[s], start + s + 0.5)
    }
  }
  return out
}

/**
 * Static, size-independent description of an aircraft's cross-section and
 * length. Computed once per aircraft, reused for every resize.
 */
export function buildCabinModel(aircraft) {
  const cabins = aircraft.cabins || []
  const aisleUnits = computeAisleUnits(cabins, aircraft.aisleCount)

  const lateralByCabin = new Map()
  let maxUnits = 0
  for (const cabin of cabins) {
    const map = cabinLateralUnits(cabin.layout, aisleUnits)
    lateralByCabin.set(cabin.id, map)
    for (const value of map.values()) {
      const edge = Math.abs(value) + 0.5
      if (edge > maxUnits) maxUnits = edge
    }
  }
  if (!maxUnits) maxUnits = aisleUnits.length * 3.5

  const halfWidthM = maxUnits * SEAT_UNIT_M + WALL_M

  const rows = aircraft.rowSlots || []
  let cabinStartM = Infinity
  let cabinEndM = -Infinity
  for (const row of rows) {
    const pitch = row.pitchM > 0 ? row.pitchM : DEFAULT_PITCH_M
    if (row.x - pitch / 2 < cabinStartM) cabinStartM = row.x - pitch / 2
    if (row.x + pitch / 2 > cabinEndM) cabinEndM = row.x + pitch / 2
  }
  if (!Number.isFinite(cabinStartM)) {
    cabinStartM = halfWidthM * 3
    cabinEndM = cabinStartM + 20
  }

  const lengthM =
    Number.isFinite(aircraft.lengthM) && aircraft.lengthM > cabinEndM
      ? aircraft.lengthM
      : cabinEndM + halfWidthM * 3.4

  return {
    aisleUnits,
    lateralByCabin,
    maxUnits,
    halfWidthM,
    cabinStartM,
    cabinEndM,
    lengthM,
    /** Total lateral extent including wings, metres. */
    fullWidthM: halfWidthM * 2 * (1 + WING_SPAN_FACTOR),
  }
}

// ---------------------------------------------------------------------------
// Full pixel geometry
// ---------------------------------------------------------------------------

/**
 * Project an aircraft into a viewport.
 *
 * @param {object} aircraft
 * @param {object} opts
 * @param {number} opts.width     CSS px
 * @param {number} opts.height    CSS px
 * @param {'horizontal'|'vertical'} [opts.orientation]
 * @param {number} [opts.padding] CSS px of breathing room on every side
 * @param {object} [opts.model]   memoised `buildCabinModel` result
 */
export function computeGeometry(aircraft, opts) {
  const width = Math.max(1, opts.width || 1)
  const height = Math.max(1, opts.height || 1)
  const orientation = opts.orientation === 'vertical' ? 'vertical' : 'horizontal'
  const padding = opts.padding ?? 12
  const model = opts.model || buildCabinModel(aircraft)

  // In vertical mode the long axis of the aircraft runs down the screen.
  const alongPx = Math.max(1, (orientation === 'vertical' ? height : width) - padding * 2)
  const acrossPx = Math.max(1, (orientation === 'vertical' ? width : height) - padding * 2)

  let scaleLon = alongPx / model.lengthM
  let scaleLat = acrossPx / model.fullWidthM
  if (scaleLat < scaleLon) {
    // Viewport is too shallow for a to-scale aeroplane: shrink both axes.
    scaleLon = scaleLat
  } else {
    scaleLat = Math.min(scaleLat, scaleLon * MAX_LATERAL_EXAGGERATION)
  }

  const lengthPx = model.lengthM * scaleLon
  const halfV = model.halfWidthM * scaleLat
  const wingSpan = halfV * WING_SPAN_FACTOR

  // Centre the drawing inside the viewport.
  const originAlong = ((orientation === 'vertical' ? height : width) - lengthPx) / 2
  const originAcross = (orientation === 'vertical' ? width : height) / 2
  const originX = orientation === 'vertical' ? originAcross : originAlong
  const originY = orientation === 'vertical' ? originAlong : originAcross

  const matrix = orientation === 'vertical'
    ? { a: 0, b: 1, c: 1, d: 0, e: originX, f: originY }
    : { a: 1, b: 0, c: 0, d: 1, e: originX, f: originY }

  const toScreen = orientation === 'vertical'
    ? (u, v) => ({ x: originX + v, y: originY + u })
    : (u, v) => ({ x: originX + u, y: originY + v })
  const toPlan = orientation === 'vertical'
    ? (x, y) => ({ u: y - originY, v: x - originX })
    : (x, y) => ({ u: x - originX, v: y - originY })

  // --- rows -----------------------------------------------------------
  const rowSlots = aircraft.rowSlots || []
  const rows = new Array(rowSlots.length)
  let minPitchPx = Infinity
  for (let i = 0; i < rowSlots.length; i++) {
    const row = rowSlots[i]
    const pitchM = row.pitchM > 0 ? row.pitchM : DEFAULT_PITCH_M
    const pitchPx = pitchM * scaleLon
    if (pitchPx < minPitchPx) minPitchPx = pitchPx
    rows[i] = {
      rowNumber: row.rowNumber,
      cabinId: row.cabinId,
      isExitRow: !!row.isExitRow,
      u: row.x * scaleLon,
      pitchPx,
      halfPitchM: pitchM / 2,
      xM: row.x,
    }
  }
  if (!Number.isFinite(minPitchPx)) minPitchPx = 0

  // --- seats ----------------------------------------------------------
  const seatList = aircraft.seats || []
  const count = seatList.length
  const seatU = new Float32Array(count)
  const seatV = new Float32Array(count)
  const seatW = new Float32Array(count)
  const seatH = new Float32Array(count)
  const seatClass = new Array(count)
  const seatIndexById = new Map()
  const seatIndexByRowLetter = new Map()

  const cabinBysId = new Map()
  for (const cabin of aircraft.cabins || []) cabinBysId.set(cabin.id, cabin)

  const seatHeight = SEAT_UNIT_M * 0.86 * scaleLat
  for (let i = 0; i < count; i++) {
    const seat = seatList[i]
    const lateral = model.lateralByCabin.get(seat.cabinId)
    const units = lateral ? lateral.get(seat.letter) : undefined
    const cabin = cabinBysId.get(seat.cabinId)
    const rowPitch = pitchOfRow(rowSlots, seat.rowNumber)
    seatU[i] = seat.x * scaleLon
    seatV[i] = (units === undefined ? 0 : units) * SEAT_UNIT_M * scaleLat
    seatW[i] = rowPitch * 0.62 * scaleLon
    seatH[i] = seatHeight
    seatClass[i] = cabin ? cabin.classKey : 'economy'
    seatIndexById.set(seat.id, i)
    seatIndexByRowLetter.set(`${seat.rowNumber}:${seat.letter}`, i)
  }

  // --- aisle lanes ------------------------------------------------------
  const laneV = new Float32Array(model.aisleUnits.length)
  for (let k = 0; k < model.aisleUnits.length; k++) {
    laneV[k] = model.aisleUnits[k] * SEAT_UNIT_M * scaleLat
  }

  // --- doors ------------------------------------------------------------
  const doors = (aircraft.doors || []).map((door) => {
    const side = door.aisleIndex >= 1 ? 1 : -1
    return {
      id: door.id,
      name: door.name,
      kind: door.kind,
      enabled: door.enabled !== false,
      aisleIndex: door.aisleIndex || 0,
      u: door.x * scaleLon,
      v: side * halfV,
      side,
      /** Where the jet-bridge queue lane starts, just outside the skin. */
      laneV: side * halfV * QUEUE_LANE_FACTOR,
      laneLength: 0,
    }
  })
  assignQueueLaneLengths(doors, lengthPx)

  const exit = exitRowRange(rows)

  return {
    aircraft,
    model,
    orientation,
    width,
    height,
    padding,
    scaleLon,
    scaleLat,
    matrix,
    toScreen,
    toPlan,
    originX,
    originY,
    lengthPx,
    halfV,
    wingSpan,
    noseEndU: model.cabinStartM * scaleLon * 0.86,
    cabinU0: model.cabinStartM * scaleLon,
    cabinU1: model.cabinEndM * scaleLon,
    tailStartU: model.cabinEndM * scaleLon,
    exitU0: exit[0],
    exitU1: exit[1],
    rows,
    seatU,
    seatV,
    seatW,
    seatH,
    seatClass,
    seatIndexById,
    seatIndexByRowLetter,
    seatHeight,
    minPitchPx,
    laneV,
    doors,
    showLetters: seatHeight >= MIN_PX_FOR_LETTERS,
    showRowNumbers: minPitchPx >= MIN_PX_FOR_ROW_NUMBERS,
    /** Draw every Nth row number when the pitch gets tight. */
    rowNumberStride: minPitchPx >= 18 ? 1 : minPitchPx >= 11 ? 5 : 0,
    /** Radius of a passenger dot, px. */
    dotRadius: Math.max(1.6, Math.min(seatHeight * 0.34, 7)),
  }
}

function pitchOfRow(rowSlots, rowNumber) {
  for (const row of rowSlots) {
    if (row.rowNumber === rowNumber) {
      return row.pitchM > 0 ? row.pitchM : DEFAULT_PITCH_M
    }
  }
  return DEFAULT_PITCH_M
}

function exitRowRange(rows) {
  let lo = Infinity
  let hi = -Infinity
  for (const row of rows) {
    if (!row.isExitRow) continue
    if (row.u < lo) lo = row.u
    if (row.u > hi) hi = row.u
  }
  if (!Number.isFinite(lo) && rows.length) {
    // No declared exit rows: hint the wings at the cabin's midpoint.
    const first = rows[0].u
    const last = rows[rows.length - 1].u
    lo = first + (last - first) * 0.42
    hi = first + (last - first) * 0.55
  }
  if (!Number.isFinite(lo)) return [0, 0]
  return [lo, Math.max(hi, lo)]
}

/**
 * Each door's queue lane runs aft from the door until the next door on the
 * same side, so two boarding queues never overlap.
 */
function assignQueueLaneLengths(doors, lengthPx) {
  for (const door of doors) {
    let limit = lengthPx * 0.94
    for (const other of doors) {
      if (other === door || other.side !== door.side) continue
      if (other.u > door.u && other.u < limit) limit = other.u
    }
    door.laneLength = Math.max(0, limit - door.u - 6)
  }
}

/**
 * Half-width of the fuselage at longitudinal position `u`, in plan pixels.
 * Nose is a quarter-ellipse, the cabin is parallel, the tail tapers to a
 * blunt tip. Used for both the outline and for anchoring doors to the skin.
 */
export function fuselageHalfWidth(geom, u) {
  const { noseEndU, tailStartU, lengthPx, halfV } = geom
  if (u <= 0 || u >= lengthPx) return 0
  if (u < noseEndU && noseEndU > 0) {
    const k = 1 - u / noseEndU
    return halfV * Math.sqrt(Math.max(0, 1 - k * k))
  }
  if (u > tailStartU && lengthPx > tailStartU) {
    const k = (u - tailStartU) / (lengthPx - tailStartU)
    return halfV * (1 - 0.9 * k * k)
  }
  return halfV
}

/**
 * Map every passenger onto a seat index in `geom`, so the draw loop can look
 * up a seated dot's position with one array read.
 *
 * @returns {Int32Array} `seatIndex[paxId]`, or 0 when the seat is unknown
 *          (open seating before the passenger has chosen).
 */
export function mapPassengersToSeats(geom, passengers) {
  const out = new Int32Array(passengers.length)
  for (let i = 0; i < passengers.length; i++) {
    const p = passengers[i]
    const key = `${p.seatRow}:${p.seatLetter}`
    const idx = geom.seatIndexByRowLetter.get(key)
    out[i] = idx === undefined ? 0 : idx
  }
  return out
}
