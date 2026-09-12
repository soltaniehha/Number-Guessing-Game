/**
 * Fixture-only geometry resolution.
 *
 * Mirrors ENGINE_SPEC section 2.1 closely enough that the shell can lay out
 * door toggles, compute max seat depth for relevance checks, and show seat
 * counts before the real engine lands. The real `resolveAircraft` from
 * `src/sim/index.js` supersedes this the moment that module exists.
 */

const INCH = 0.0254

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
    out.push({ letter: cell, aisleIndex: best, depth: bestDist, index: i })
  })
  return out
}

/**
 * Expand an aircraft spec into resolved geometry.
 * @returns {object} the spec plus `seats`, `rowSlots`, `seatCount`, `maxDepth`, `lengthM`
 */
export function resolveAircraftSpec(spec) {
  const rowSlots = []
  let x = 0
  let prevPitch = null
  for (const cabin of spec.cabins) {
    const pitch = (cabin.pitchIn ?? spec.seatPitchIn) * INCH
    for (const rowNumber of cabin.rows) {
      if (prevPitch !== null) x += prevPitch
      rowSlots.push({ rowNumber, x, pitch, cabinId: cabin.id, classKey: cabin.classKey })
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
          depth: s.depth,
          x: geom.x,
        })
      }
      slot += 1
    }
  }

  const lengthM = rowSlots.length ? rowSlots[rowSlots.length - 1].x + rowSlots[rowSlots.length - 1].pitch : 0
  const maxDepth = seats.reduce((m, s) => Math.max(m, s.depth), 0)

  const doors = spec.doors.map((d) => {
    let dx = lengthM
    if (d.rowBefore != null) {
      const idx = rowSlots.findIndex((r) => r.rowNumber === d.rowBefore)
      if (idx >= 0) dx = rowSlots[idx].x - 0.5 * rowSlots[idx].pitch
    }
    return { ...d, x: dx }
  })

  return {
    ...spec,
    doors,
    rowSlots,
    seats,
    seatCount: seats.length,
    rowCount: rowSlots.length,
    maxDepth,
    lengthM,
    slotCount: slot,
  }
}
