/**
 * Cabin geometry: turns an `Aircraft` description into pixel coordinates.
 *
 * Everything is computed in **plan space**: `u` runs aft along the fuselage
 * from the NOSE TIP, `v` runs laterally from the centreline, both already in
 * CSS pixels. A single 2x2 transform maps plan space to the screen, so the
 * whole renderer works in one coordinate system and "rotate to vertical on
 * narrow screens" is a matrix swap rather than a second code path.
 *
 * Physical constants come from docs/ENGINE_SPEC.md 2.
 *
 * ## Plan space is NOT engine space
 *
 * The engine measures x in metres from ROW 1, and `aircraft.lengthM` is the
 * CABIN -- row 1 to the last row -- because those are the distances a
 * passenger walks. It knows nothing of a nose or a tail cone, and it must not:
 * `geometry_hash` in the parity digest pins every one of those numbers to the
 * Python engine bit for bit.
 *
 * A nose and a tail are presentation, so this module adds them. `originM` is
 * the engine x that lands on the nose tip (a NEGATIVE number: the nose is
 * ahead of row 1), and `planU(x)` is the only sanctioned way to turn an engine
 * x into a plan u. Skipping it is how door 1L -- half a row pitch ahead of row
 * 1, i.e. at a negative engine x -- used to be painted at u < 0, off the
 * left-hand edge of the canvas on every airframe in the roster.
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
export const WING_SPAN_FACTOR = 0.42

// --- nose and tail ---------------------------------------------------------
//
// Presentation only. Both are sized off the fuselage HALF-WIDTH rather than
// off the cabin, because that is what makes a silhouette read as the right
// aeroplane: a widebody's nose and tail cone are longer than a narrowbody's in
// proportion to how much fatter the tube is, near enough, and a stretched
// variant of an airframe grows in the middle and nowhere else. On the roster
// this puts ~4.9 m of nose ahead of row 1 on an E175, ~6.5 m on an A320neo and
// ~10.5 m on a 777-300ER, with tail cones a little over half again as long --
// all within a metre or so of the real aeroplanes.

/** Nose ahead of row 1, as a multiple of the fuselage half-width. */
export const NOSE_LENGTH_FACTOR = 3.4
/** Tail cone aft of the last row, as a multiple of the fuselage half-width. */
export const TAIL_LENGTH_FACTOR = 5.4
/**
 * How much of the nose allowance is tapering skin. The remainder is the
 * full-width forward vestibule the door 1 pair opens onto -- without it the
 * forward door would sit on the slope of the radome.
 */
export const NOSE_TAPER_FRACTION = 0.86
/** Half-width at the very tip of the tail cone, as a fraction of `halfV`. */
export const TAIL_TIP_FRACTION = 0.09
/** Shortest nose and tail worth drawing, metres. */
export const MIN_NOSE_M = 2.4
export const MIN_TAIL_M = 4
/**
 * Lateral offset of the jet-bridge queue lane, as a multiple of half-width.
 *
 * A FLOOR, not the answer: `queueLaneOffset` below pushes the lane further out
 * when the row-number gutter would otherwise be underneath it.
 */
export const QUEUE_LANE_FACTOR = 1.18
/** A queue lane never runs further aft than this fraction of the aeroplane. */
export const QUEUE_LANE_MAX_FRACTION = 0.46
/** Clear air between the outermost row label and the queue lane, px. */
export const QUEUE_LABEL_GAP = 2

/** Below these pixel sizes labels are dropped rather than crushed. */
export const MIN_PX_FOR_LETTERS = 8.5
export const MIN_PX_FOR_ROW_NUMBERS = 7.5

/**
 * Row pitch, px, at or above which every Nth row number is worth drawing.
 *
 * Descending. Once the aeroplane includes its nose and tail cone a widebody
 * is half again as long as its cabin, so a 777 or a 787 on a phone lands just
 * under the old 11 px floor -- and dropping the row numbers entirely there
 * would take the gutter with them. Ten rows apart at 8 px is sparse; it is
 * still an index.
 */
export const ROW_NUMBER_STRIDES = [[18, 1], [11, 5], [MIN_PX_FOR_ROW_NUMBERS, 10]]

/** How often to draw a row number at this pitch; 0 = not at all. */
export function rowNumberStrideFor(minPitchPx) {
  for (const [floor, stride] of ROW_NUMBER_STRIDES) {
    if (minPitchPx >= floor) return stride
  }
  return 0
}

// ---------------------------------------------------------------------------
// Sizes shared with the painter
// ---------------------------------------------------------------------------
//
// `draw.js` paints the row numbers, the door chevrons, the queue dots and the
// count pill; this module decides where the queue lane goes. Those two have to
// agree to the pixel or the lane lands on the labels, so the sizes live here
// and the painter reads them off the geometry rather than recomputing them.

/** Font size of a row number, px. */
export const rowLabelSizePx = (minPitchPx) => Math.max(8, Math.min(minPitchPx * 0.62, 11))
/** Half-height of a door chevron, px — it hangs into the label gutter. */
export const doorGlyphSizePx = (halfV) => Math.max(5, Math.min(halfV * 0.3, 13))
/** Font size of the jet-bridge queue count pill, px. */
export const queueBadgeSizePx = (halfV) => Math.max(9, Math.min(halfV * 0.22, 12))
/** Radius of one dot in a jet-bridge queue, px. */
export const queueDotRadiusPx = (dotRadius) => Math.max(1.5, dotRadius * 0.82)

/**
 * Where the queue lane sits laterally, in plan px, measured from the
 * centreline.
 *
 * Row numbers run down the starboard flank, stepping outboard where a door
 * chevron is in the way. On a widebody the plain `QUEUE_LANE_FACTOR` lane then
 * lands on top of them: 787-9 rows 20-21 and 777-300ER rows 14-15 sat
 * underneath door 2L's queue dots and its count pill. So the label gutter is
 * reserved FIRST and the lane starts outboard of it — unless the viewport is
 * too shallow to give it the room, in which case nothing is gained by moving
 * the queue and the old offset stands.
 */
export function queueLaneOffset({ halfV, minPitchPx, dotRadius, acrossHalf }) {
  const floor = halfV * QUEUE_LANE_FACTOR
  const label = rowLabelSizePx(minPitchPx)
  const outermostLabel =
    Math.max(rowLabelV(halfV, label), rowLabelDoorV(halfV, label)) + label * 0.6
  const half = queueHalfExtent(halfV, dotRadius)
  const wanted = outermostLabel + half + QUEUE_LABEL_GAP
  const room = Math.max(floor, (acrossHalf || 0) - half)
  return Math.max(floor, Math.min(wanted, room))
}

/** Lateral centre of a row number in the plain gutter, plan px. */
export const rowLabelV = (halfV, labelSize) => halfV + labelSize * 1.15
/** Lateral centre of a row number stepped clear of a door chevron, plan px. */
export const rowLabelDoorV = (halfV, labelSize) =>
  halfV + doorGlyphSizePx(halfV) * 0.92 + labelSize * 0.95

/** Half the lateral thickness of a queue lane: dots, backing and count pill. */
export const queueHalfExtent = (halfV, dotRadius) =>
  Math.max(queueBadgeSizePx(halfV) * 0.8, queueDotRadiusPx(dotRadius) * 1.45)

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

/** Clamp, resolving a crossed range in favour of the ceiling. */
const clamp = (v, lo, hi) => (hi < lo ? hi : Math.min(Math.max(v, lo), hi))

/**
 * Static, size-independent description of an aircraft's cross-section and
 * length. Computed once per aircraft, reused for every resize.
 *
 * All the `*M` fields are metres. `cabinStartM` / `cabinEndM` are in ENGINE
 * space (x from row 1); `noseM`, `tailM`, `originM` and `lengthM` describe the
 * drawn aeroplane, which is longer at both ends. See the module header.
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
    cabinStartM = 0
    cabinEndM = halfWidthM * 12
  }
  // `aircraft.lengthM` is the CABIN, not the aeroplane (module header). Where
  // it runs past the last row -- a galley bank behind it, which the engine
  // charges real walking metres for -- that is still parallel cabin, so it
  // extends the tube rather than the aircraft. Every aft door sits inside it.
  if (Number.isFinite(aircraft.lengthM) && aircraft.lengthM > cabinEndM) {
    cabinEndM = aircraft.lengthM
  }
  const cabinLengthM = cabinEndM - cabinStartM

  // Clamped against the cabin as well as the tube so a stub of an aircraft --
  // a two-row test fixture, say -- cannot end up as mostly nose.
  const noseM = clamp(halfWidthM * NOSE_LENGTH_FACTOR, MIN_NOSE_M, cabinLengthM * 0.55)
  const tailM = clamp(halfWidthM * TAIL_LENGTH_FACTOR, MIN_TAIL_M, cabinLengthM * 1.1)

  return {
    aisleUnits,
    lateralByCabin,
    maxUnits,
    halfWidthM,
    cabinStartM,
    cabinEndM,
    cabinLengthM,
    /** Nose ahead of the first row, metres. Presentation only. */
    noseM,
    /** Tail cone aft of the last row, metres. Presentation only. */
    tailM,
    /** The engine x that lands on the nose tip, i.e. on plan `u = 0`. */
    originM: cabinStartM - noseM,
    /** Nose tip to tail tip, metres -- the drawn aeroplane, not the cabin. */
    lengthM: noseM + cabinLengthM + tailM,
    /** Total lateral extent including wings and queue lanes, metres. */
    fullWidthM:
      halfWidthM * 2 * Math.max(1 + WING_SPAN_FACTOR, QUEUE_LANE_FACTOR + 0.14),
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
 * @param {string[]|Set<string>} [opts.enabledDoorIds] overrides each door's
 *        own enabled flag, for when the live config owns the door selection
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

  // Engine x (metres from row 1) -> plan u (pixels from the nose tip). The
  // offset is what puts a forward door, which the engine places at a NEGATIVE
  // x, safely inside the canvas instead of off its leading edge.
  const uOffset = -model.originM * scaleLon
  const planU = (xM) => xM * scaleLon + uOffset

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
      u: planU(row.x),
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
  /** Radius of a passenger dot, px. Sized here because the queue lane needs it. */
  const dotRadius = Math.max(1.6, Math.min(seatHeight * 0.34, 7))
  for (let i = 0; i < count; i++) {
    const seat = seatList[i]
    const lateral = model.lateralByCabin.get(seat.cabinId)
    const units = lateral ? lateral.get(seat.letter) : undefined
    const cabin = cabinBysId.get(seat.cabinId)
    const rowPitch = pitchOfRow(rowSlots, seat.rowNumber)
    seatU[i] = planU(seat.x)
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

  // --- labels and the queue lane ----------------------------------------
  // The row-number gutter is reserved before the queue is placed, so the two
  // never share pixels. See `queueLaneOffset`.
  const rowLabelSize = rowLabelSizePx(minPitchPx)
  const acrossHalf = (orientation === 'vertical' ? width : height) / 2 - padding
  const queueLaneV = queueLaneOffset({ halfV, minPitchPx, dotRadius, acrossHalf })

  // --- doors ------------------------------------------------------------
  const enabledIds = opts.enabledDoorIds
    ? new Set(opts.enabledDoorIds)
    : null
  const doors = (aircraft.doors || []).map((door) => {
    const side = door.aisleIndex >= 1 ? 1 : -1
    return {
      id: door.id,
      name: door.name,
      kind: door.kind,
      // An explicit list wins; otherwise take the door's own flag, accepting
      // ENGINE_SPEC's `defaultEnabled` spelling as well.
      enabled: enabledIds
        ? enabledIds.has(door.id)
        : (door.enabled ?? door.defaultEnabled ?? true) !== false,
      aisleIndex: door.aisleIndex || 0,
      u: planU(door.x),
      v: side * halfV,
      side,
      /** Where the jet-bridge queue lane sits, outboard of the label gutter. */
      laneV: side * queueLaneV,
      laneLength: 0,
      /** +1 = the queue trails aft of the door, -1 = forward of it. */
      laneDir: 1,
    }
  })
  const cabinU0 = planU(model.cabinStartM)
  const cabinU1 = planU(model.cabinEndM)
  assignQueueLaneLengths(doors, cabinU0, cabinU1, lengthPx * QUEUE_LANE_MAX_FRACTION)

  const exit = exitRowRange(rows)
  const cabinGaps = cabinForeGaps(aircraft, rows)

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
    /** Engine x (m) -> plan u (px). The ONLY way to place an engine value. */
    planU,
    /** The px added to `x * scaleLon` by `planU`; the nose, in other words. */
    uOffset,
    /** Where the nose stops tapering; the vestibule runs on to `cabinU0`. */
    noseEndU: model.noseM * NOSE_TAPER_FRACTION * scaleLon,
    cabinU0,
    cabinU1,
    tailStartU: cabinU1,
    exitU0: exit[0],
    exitU1: exit[1],
    rows,
    cabinGaps,
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
    rowNumberStride: rowNumberStrideFor(minPitchPx),
    /** Radius of a passenger dot, px. */
    dotRadius,
    // --- the label / queue contract, shared with draw.js -----------------
    /** Row-number font size, px. */
    rowLabelSize,
    /** Lateral centre of a row number away from a door, plan px. */
    rowLabelV: rowLabelV(halfV, rowLabelSize),
    /** Lateral centre of a row number stepped past a door chevron, plan px. */
    rowLabelDoorV: rowLabelDoorV(halfV, rowLabelSize),
    /** Lateral offset of every queue lane, plan px. */
    queueLaneV,
    /** Half the lateral thickness of a queue lane, plan px. */
    queueHalfExtent: queueHalfExtent(halfV, dotRadius),
    /** Count-pill font size, px. */
    queueBadgeSize: queueBadgeSizePx(halfV),
    /** Radius of one queued dot, px. */
    queueDotRadius: queueDotRadiusPx(dotRadius),
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

/** Two doors closer together than this share a station, in plan px. */
const SAME_STATION_PX = 0.5

/**
 * Give each door a queue lane that runs alongside the fuselage without
 * colliding with another door's queue. It normally trails aft of the door;
 * a rear door (airstairs at the back) trails forward instead, because that is
 * where the space is.
 */
function assignQueueLaneLengths(doors, cabinU0, cabinU1, cap) {
  for (const door of doors) {
    // A queue runs alongside the CABIN. It has no business out over the nose
    // cone or the tail cone, where there is no aeroplane beside it to queue
    // against and, in the vertical layout, not much canvas either.
    let aftLimit = cabinU1
    let foreLimit = cabinU0
    for (const other of doors) {
      if (other === door || other.side !== door.side) continue
      // Doors come in L/R pairs at the same station, and on a single-aisle
      // aeroplane every one of them maps to the port flank -- so a door was
      // bounding its OWN lane through its opposite number. `2R` pinned `2L`'s
      // lane to 5 px on the A320neo, the 737 MAX and the A220, and forty-odd
      // queued passengers rendered as a count pill with a single dot beside
      // it. A door at the same station is not in the way.
      if (other.u > door.u + SAME_STATION_PX) aftLimit = Math.min(aftLimit, other.u)
      else if (other.u < door.u - SAME_STATION_PX) foreLimit = Math.max(foreLimit, other.u)
    }
    const aft = Math.max(0, aftLimit - door.u - 6)
    const fore = Math.max(0, door.u - foreLimit - 6)
    // Queues normally trail aft of their door, which is how people read them.
    // Only a door with little room behind it (airstairs at the back) flips.
    door.laneDir = aft >= Math.min(cap * 0.6, fore) ? 1 : -1
    door.laneLength = Math.min(cap, door.laneDir === 1 ? aft : fore)
  }
}

/**
 * Clear space forward of each cabin, in plan pixels — the gap a galley or the
 * nose leaves. Seat-letter headers are only drawn where one of these is wide
 * enough to hold them.
 */
function cabinForeGaps(aircraft, rows) {
  const gaps = new Map()
  // The first cabin's clear space is the forward vestibule, which starts at
  // the nose tip -- `paintLetterRow` only ever uses a couple of characters of
  // it, so the header lands in the vestibule and never on the radome.
  let previousAft = 0
  for (const cabin of aircraft.cabins || []) {
    let fore = Infinity
    let aft = -Infinity
    for (const row of rows) {
      if (row.cabinId !== cabin.id) continue
      fore = Math.min(fore, row.u - row.pitchPx / 2)
      aft = Math.max(aft, row.u + row.pitchPx / 2)
    }
    if (!Number.isFinite(fore)) continue
    gaps.set(cabin.id, { fore, aft, gap: fore - previousAft })
    previousAft = aft
  }
  return gaps
}

/**
 * Half-width of the fuselage at longitudinal position `u`, in plan pixels.
 *
 * Nose is an ogive, the cabin (vestibule included) is parallel, the tail cone
 * tapers to a blunt tip. Used for the outline, for anchoring doors and the
 * jet-bridge stubs to the skin, and for rooting the tailplane.
 */
export function fuselageHalfWidth(geom, u) {
  const { noseEndU, tailStartU, lengthPx, halfV } = geom
  if (u <= 0 || u >= lengthPx) return 0
  if (u < noseEndU && noseEndU > 0) {
    // `(1 - k^2)^0.62` rather than the circular `sqrt`: it holds the width
    // longer and then rounds off, which is the shape of a radome instead of
    // the shoulder of an ellipse.
    const k = 1 - u / noseEndU
    return halfV * Math.pow(Math.max(0, 1 - k * k), 0.62)
  }
  if (u > tailStartU && lengthPx > tailStartU) {
    const k = (u - tailStartU) / (lengthPx - tailStartU)
    return halfV * (1 - (1 - TAIL_TIP_FRACTION) * Math.pow(k, 1.55))
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
