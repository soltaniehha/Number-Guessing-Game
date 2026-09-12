/**
 * Fixture-only geometry resolution.
 *
 * Mirrors ENGINE_SPEC section 2.1 closely enough that the shell can lay out
 * door toggles, compute max seat depth for relevance checks, and show seat
 * counts before the real engine lands. The real `resolveAircraft` from
 * `src/sim/index.js` supersedes this the moment that module exists.
 */

const INCH = 0.0254
/** Fuselage ahead of the first row and behind the last, metres. */
const NOSE_M = 5.5
const TAIL_M = 5.0

/** Nearest-aisle index and depth for every letter in a layout row. */
function seatSlots(layout) {
  const aisleAt = []
  layout.forEach((cell, i) => {
    if (cell === '|') aisleAt.push(i)
  })
  const out = []
  layout.forEach((cell, i) => {
    if (cell === '|') return
    let best = 0
    let bestDist = Infinity
    aisleAt.forEach((pos, k) => {
      const d = Math.abs(i - pos)
      if (d < bestDist) {
        bestDist = d
        best = k
      }
    })
    out.push({ letter: cell, aisleIndex: best, depth: bestDist, index: i, side: i < aisleAt[best] ? -1 : 1 })
  })
  return out
}

/**
 * Expand an aircraft spec into resolved geometry.
 * @returns {object} the spec plus `seats`, `rowSlots`, `seatCount`, `maxDepth`, `lengthM`
 */
const round4 = (n) => Math.round(n * 10000) / 10000

export function resolveAircraftSpec(spec) {
  const rowSlots = []
  let x = NOSE_M
  let prevPitch = null
  for (const cabin of spec.cabins) {
    const pitch = (cabin.pitchIn ?? spec.seatPitchIn) * INCH
    for (const rowNumber of cabin.rows) {
      if (prevPitch !== null) x += prevPitch
      rowSlots.push({
        rowNumber,
        x: round4(x),
        pitch: round4(pitch),
        // The cabin renderer reads `pitchM` and `isExitRow`.
        pitchM: round4(pitch),
        isExitRow: (cabin.exitRows || []).includes(rowNumber),
        cabinId: cabin.id,
        classKey: cabin.classKey,
      })
      prevPitch = pitch
    }
  }

  const seats = []
  let slot = 0
  for (const cabin of spec.cabins) {
    const slots = seatSlots(cabin.layout)
    for (const rowNumber of cabin.rows) {
      const geom = rowSlots.find((r) => r.rowNumber === rowNumber && r.cabinId === cabin.id)
      for (const s of slots) {
        const id = `${rowNumber}${s.letter}`
        if ((cabin.missingSeats || []).includes(id)) continue
        seats.push({
          id,
          rowNumber,
          rowSlot: rowSlots.indexOf(geom),
          letter: s.letter,
          cabinId: cabin.id,
          classKey: cabin.classKey,
          aisleIndex: s.aisleIndex,
          // The cabin renderer calls the serving aisle `lane`, and `side` is
          // -1 for seats forward of that aisle in the layout, +1 for aft of it.
          lane: s.aisleIndex,
          side: s.side,
          depth: s.depth,
          seatDepth: s.depth,
          x: geom.x,
        })
      }
      slot += 1
    }
  }

  const lastRow = rowSlots[rowSlots.length - 1]
  const cabinEndM = lastRow ? lastRow.x + lastRow.pitch : 0
  const lengthM = round4(cabinEndM + TAIL_M)
  const maxDepth = seats.reduce((m, s) => Math.max(m, s.depth), 0)

  const doors = spec.doors.map((d) => {
    let dx = cabinEndM
    if (d.rowBefore != null) {
      const idx = rowSlots.findIndex((r) => r.rowNumber === d.rowBefore)
      if (idx >= 0) dx = rowSlots[idx].x - 0.5 * rowSlots[idx].pitch
    }
    return { ...d, x: round4(dx) }
  })

  return {
    ...spec,
    doors,
    rowSlots,
    seats,
    cabinEndM,
    seatCount: seats.length,
    rowCount: rowSlots.length,
    maxDepth,
    lengthM,
    slotCount: slot,
  }
}
