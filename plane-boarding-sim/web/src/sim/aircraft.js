/**
 * Aircraft geometry resolution.
 *
 * Port of `python/plane_boarding/aircraft.py`.
 *
 * Reads the declarative roster in `parity/aircraft.json` -- the same file the
 * Python engine reads -- and turns it into the numbers the engine actually
 * needs: where every row sits in metres, which aisle serves each seat, how many
 * bodies a passenger must climb over to reach it, and where the doors are.
 *
 * Two ideas do most of the work.
 *
 * **Row slots vs row numbers.** The number printed on a boarding pass is not a
 * coordinate. Airlines skip 13 and renumber freely between cabins, so geometry
 * is indexed by a contiguous *row slot* and a skipped number costs no cabin
 * length. A galley or lavatory bank is different -- real metres of aisle with
 * no seats in it -- and is declared separately as a `monument`.
 *
 * **Seat depth.** How blocked a seat is: the number of seats crossed to reach
 * it from its serving aisle, counting itself. Aisle = 1, middle = 2, window =
 * 3. This single integer drives WilMA, Steffen, the reverse pyramid and the
 * whole seat-shuffle model.
 *
 * Beyond the Python fields, the resolved objects also carry a few renderer
 * aliases (`rowNumber`/`pitchM` on a row slot, `lengthM`/`rowCount` on the
 * aircraft) because `src/cabin/geometry.js` spells them that way. They are
 * additive: nothing in the simulation reads them.
 */
import ROSTER from '../../../parity/aircraft.json' with { type: 'json' }
import { ConfigError, INCH } from './config.js'
import { pyRound, sortByKey } from './pyutil.js'

export const AISLE = '|'

/**
 * Seat "kind" as a passenger would describe it. Distinct from `depth`, which is
 * a geometric fact: in a 1-2-1 business cabin the A seat is both a window and
 * an aisle seat (depth 1), and the label has to say "Window" while the physics
 * uses 1.
 */
export const WINDOW = 'Window'
export const MIDDLE = 'Middle'
export const AISLE_SEAT = 'Aisle'

/** One physical seat, with everything the engine needs precomputed. */
export class Seat {
  constructor(kw) {
    Object.assign(this, kw)
  }
}

/** A boarding door, resolved to a longitudinal position. */
export class Door {
  constructor(kw) {
    Object.assign(this, kw)
  }
}

/** A contiguous physical row position. `number` is what is printed on the seat. */
export class RowSlot {
  constructor(kw) {
    Object.assign(this, kw)
  }
}

/** Fully resolved geometry. Built once per aircraft id and cached. */
export class Aircraft {
  constructor(kw) {
    Object.assign(this, kw)
  }

  boardableDoors() {
    return this.doors.filter((d) => d.boardable)
  }

  defaultDoors() {
    return this.doors.filter((d) => d.boardable && d.defaultEnabled).map((d) => d.id)
  }

  /**
   * Filter and order the enabled doors.
   *
   * Order follows the roster's declaration order, not the caller's, so the
   * release order in the engine cannot depend on how a user typed the list.
   */
  resolveDoors(requested) {
    const boardable = new Map()
    for (const d of this.doors) if (d.boardable) boardable.set(d.id, d)
    let ids
    if (requested === null || requested === undefined) {
      ids = new Set(this.defaultDoors())
    } else {
      ids = new Set(requested)
      const all = new Set(this.doors.map((d) => d.id))
      const unknown = [...ids].filter((id) => !all.has(id)).sort()
      if (unknown.length) {
        throw new ConfigError(
          `${this.id}: no such door(s): ${JSON.stringify(unknown)}. ` +
            `Doors on this aircraft: ${JSON.stringify(this.doors.map((d) => d.id))}`,
        )
      }
      const notBoardable = [...ids].filter((id) => !boardable.has(id)).sort()
      if (notBoardable.length) {
        throw new ConfigError(
          `${this.id}: door(s) ${JSON.stringify(notBoardable)} are not boarding doors ` +
            '(service doors and overwing exits cannot be used to board). ' +
            `Boardable doors: ${JSON.stringify([...boardable.keys()].sort())}`,
        )
      }
    }
    const enabled = this.doors.filter((d) => ids.has(d.id) && d.boardable)
    if (!enabled.length) {
      throw new ConfigError(
        `${this.id}: no boarding doors enabled -- a boarding scenario needs at least one. ` +
          `Boardable doors on this aircraft: ${JSON.stringify([...boardable.keys()].sort())}`,
      )
    }
    return enabled
  }
}

// ---------------------------------------------------------------------------
// Layout analysis
// ---------------------------------------------------------------------------

/**
 * Work out, for every letter in a cabin layout, which aisle serves it, how deep
 * it sits, which side-of-aisle block it belongs to and which overhead bin run
 * it stows under. (ENGINE_SPEC 2.1.)
 *
 *   * a seat is served by the aisle it is nearest to, counted in seats; ties go
 *     to the lower aisle index (this matters for the middle seat of a 3-3-3
 *     centre block, equidistant from both aisles);
 *   * depth counts the seats from the serving aisle up to and including this
 *     one, so the aisle seat is 1;
 *   * a *block* is (serving aisle, side of it) -- the unit a passenger must
 *     climb across, and the unit the shuffle model reasons about;
 *   * a *bin run* is a maximal group of seats between two aisles (or an aisle
 *     and the fuselage) -- a 3-4-3 row has three, and they are what the
 *     overhead bins physically span.
 */
export function analyseLayout(layout) {
  const aislePositions = []
  for (let i = 0; i < layout.length; i++) if (layout[i] === AISLE) aislePositions.push(i)
  if (!aislePositions.length) {
    throw new ConfigError(`layout ${JSON.stringify(layout)} has no '${AISLE}' aisle marker`)
  }

  // Everything below is keyed by seat LETTER, and `resolve` looks the letter up
  // again per row to build the seats. A layout that repeats a letter would
  // therefore silently collapse two physically distinct positions onto one set
  // of geometry -- both "D" seats in a 3-3-3 would get the depth, block and bin
  // run of whichever came last, and the error would show up only as a boarding
  // time that is quietly wrong. Fail at load instead.
  const seenLetters = new Map()
  for (let i = 0; i < layout.length; i++) {
    const c = layout[i]
    if (c === AISLE) continue
    if (seenLetters.has(c)) {
      throw new ConfigError(
        `layout ${JSON.stringify(layout)} repeats seat letter ${JSON.stringify(c)} at ` +
          `positions ${seenLetters.get(c)} and ${i}. Seat letters index this cabin's ` +
          `per-letter geometry (aisle, depth, block, bin run), so they must be unique ` +
          `within a layout.`,
      )
    }
    seenLetters.set(c, i)
  }

  // Bin runs: maximal seat groups between aisle markers.
  const runs = []
  let current = []
  for (let i = 0; i < layout.length; i++) {
    if (layout[i] === AISLE) {
      runs.push(current)
      current = []
    } else {
      current.push(i)
    }
  }
  runs.push(current)

  const runOfPos = new Map()
  for (let ri = 0; ri < runs.length; ri++) {
    for (const pos of runs[ri]) runOfPos.set(pos, ri)
  }

  const nRuns = runs.length
  const info = new Map()
  const blockKeys = []

  for (let pos = 0; pos < layout.length; pos++) {
    const letter = layout[pos]
    if (letter === AISLE) continue
    let bestAisle = 0
    let bestDepth = 1e9
    for (let ai = 0; ai < aislePositions.length; ai++) {
      const apos = aislePositions[ai]
      const lo = apos < pos ? apos : pos
      const hi = apos < pos ? pos : apos
      // Count real seats between the aisle marker and this seat, inclusive of
      // the seat. Crossing another aisle marker is possible in theory, but the
      // nearest-aisle rule means it never wins.
      let depth = 0
      for (let j = lo; j <= hi; j++) if (layout[j] !== AISLE) depth += 1
      if (depth < bestDepth) {
        bestDepth = depth
        bestAisle = ai
      }
    }
    const side = pos > aislePositions[bestAisle] ? 1 : -1
    const key = `${bestAisle},${side}`
    if (!blockKeys.includes(key)) blockKeys.push(key)
    const runIndex = runOfPos.get(pos)
    const run = runs[runIndex]
    // Window = an outboard end of an outboard run, i.e. actually against the
    // fuselage. Everything else that is not an aisle seat is a middle.
    const isWindow =
      (runIndex === 0 && pos === run[0]) || (runIndex === nRuns - 1 && pos === run[run.length - 1])
    let kind
    if (isWindow) kind = WINDOW
    else if (bestDepth === 1) kind = AISLE_SEAT
    else kind = MIDDLE
    info.set(letter, {
      aisleIndex: bestAisle,
      depth: bestDepth,
      blockKey: key,
      binRun: runIndex,
      kind,
      layoutPos: pos,
      side,
    })
  }

  sortByKey(blockKeys, (k) => {
    let best = Infinity
    for (const v of info.values()) if (v.blockKey === k && v.layoutPos < best) best = v.layoutPos
    return best
  })
  for (const v of info.values()) {
    v.blockId = blockKeys.indexOf(v.blockKey)
    v.runCount = nRuns
  }
  return info
}

// ---------------------------------------------------------------------------
// Roster loading
// ---------------------------------------------------------------------------

const RESOLVED_CACHE = new Map()

export function loadRoster() {
  return ROSTER
}

export function aircraftIds() {
  return ROSTER.aircraft.map((a) => a.id)
}

/** Resolve (and cache) an aircraft's geometry. */
export function getAircraft(aircraftId) {
  const cached = RESOLVED_CACHE.get(aircraftId)
  if (cached) return cached
  for (const spec of ROSTER.aircraft) {
    if (spec.id === aircraftId) {
      const ac = resolveSpec(spec)
      RESOLVED_CACHE.set(aircraftId, ac)
      return ac
    }
  }
  throw new ConfigError(`unknown aircraft '${aircraftId}'; known: ${JSON.stringify(aircraftIds())}`)
}

function resolveSpec(spec) {
  const cabins = spec.cabins
  const monuments = new Map()
  for (const m of spec.monuments || []) monuments.set(Math.trunc(Number(m.afterRow)), Number(m.lengthM))

  // --- row slots, fore to aft, in declared cabin order --------------------
  const rowSlots = []
  const seenNumbers = new Set()
  let x = 0.0
  for (const cabin of cabins) {
    const pitch = Number(cabin.pitchIn) * INCH
    for (const raw of cabin.rows) {
      const number = Math.trunc(Number(raw))
      if (seenNumbers.has(number)) {
        throw new ConfigError(`${spec.id}: row number ${number} declared twice`)
      }
      seenNumbers.add(number)
      const exitRows = cabin.exitRows || []
      rowSlots.push(
        new RowSlot({
          slot: rowSlots.length,
          number,
          x,
          pitch,
          cabinId: cabin.id,
          binCaps: [],
          // renderer aliases
          rowNumber: number,
          pitchM: pitch,
          isExitRow: exitRows.includes(number),
          classKey: cabin.classKey,
        }),
      )
      x += pitch
      if (monuments.has(number)) {
        // A galley/lav bank: real aisle length, no seats. Passengers walking
        // past it pay for the distance, which is the point.
        x += monuments.get(number)
      }
    }
  }
  if (!rowSlots.length) throw new ConfigError(`${spec.id}: no rows declared`)
  const length = x
  const rowSlotByNumberObj = new Map()
  for (const rs of rowSlots) rowSlotByNumberObj.set(rs.number, rs)

  // --- seats in canonical order -------------------------------------------
  const seats = []
  let maxDepth = 0
  let blockCount = 0
  for (const cabin of cabins) {
    const info = analyseLayout(cabin.layout)
    const missing = new Set(cabin.missingSeats || [])
    const exitRows = new Set((cabin.exitRows || []).map((r) => Math.trunc(Number(r))))
    let localMax = -1
    for (const v of info.values()) if (v.blockId > localMax) localMax = v.blockId
    if (localMax + 1 > blockCount) blockCount = localMax + 1
    for (const raw of cabin.rows) {
      const number = Math.trunc(Number(raw))
      const rs = rowSlotByNumberObj.get(number)
      for (const letter of cabin.layout) {
        if (letter === AISLE) continue
        const seatId = `${number}${letter}`
        if (missing.has(seatId)) continue
        const m = info.get(letter)
        if (m.depth > maxDepth) maxDepth = m.depth
        seats.push(
          new Seat({
            index: seats.length,
            rowNumber: number,
            letter,
            id: seatId,
            cabinId: cabin.id,
            classKey: cabin.classKey,
            rowSlot: rs.slot,
            x: rs.x,
            aisleIndex: m.aisleIndex,
            depth: m.depth,
            blockId: m.blockId,
            binRun: m.binRun,
            kind: m.kind,
            layoutPos: m.layoutPos,
            // Lateral offset in metres, used only by the open-seating
            // "avoid_neighbours" policy to measure real distance.
            lateral: m.layoutPos * 0.5,
            isExitRow: exitRows.has(number),
            // renderer aliases
            lane: m.aisleIndex,
            side: m.side,
          }),
        )
      }
    }
  }

  // --- overhead bin capacity per (row slot, bin run) ----------------------
  // A run with no surviving seats at this row (the tapered tail of a 787, the
  // galley side of 737 row 1) has no bin above it either.
  const binBags = Math.trunc(Number(spec.binBagsPerRowSide))
  const runCounts = new Map()
  for (const cabin of cabins) {
    let n = 0
    for (const cell of cabin.layout) if (cell === AISLE) n += 1
    runCounts.set(cabin.id, n + 1)
  }
  const seatsPerRun = new Map()
  for (const s of seats) {
    const key = `${s.rowSlot},${s.binRun}`
    seatsPerRun.set(key, (seatsPerRun.get(key) || 0) + 1)
  }
  for (const rs of rowSlots) {
    const nRuns = runCounts.get(rs.cabinId)
    const caps = new Array(nRuns)
    for (let r = 0; r < nRuns; r++) {
      caps[r] = (seatsPerRun.get(`${rs.slot},${r}`) || 0) > 0 ? binBags : 0
    }
    rs.binCaps = caps
  }

  // --- doors ---------------------------------------------------------------
  const doors = []
  for (const d of spec.doors) {
    const rb = d.rowBefore
    let dx
    if (rb === null || rb === undefined) {
      const last = rowSlots[rowSlots.length - 1]
      dx = last.x + 0.5 * last.pitch
    } else {
      const rs = rowSlotByNumberObj.get(Math.trunc(Number(rb)))
      if (rs === undefined) {
        throw new ConfigError(
          `${spec.id}: door ${d.id} references row ${rb}, which has no seats`,
        )
      }
      dx = rs.x - 0.5 * rs.pitch
    }
    doors.push(
      new Door({
        id: d.id,
        name: d.name,
        x: dx,
        aisleIndex: Math.trunc(Number(d.aisleIndex)),
        kind: d.kind,
        boardable: d.boardable === undefined ? true : Boolean(d.boardable),
        defaultEnabled: Boolean(d.defaultEnabled),
        rowBefore: rb === undefined ? null : rb,
      }),
    )
  }
  if (!doors.some((d) => d.boardable)) {
    throw new ConfigError(`${spec.id}: declares no boardable door`)
  }

  const aisleCount = Math.trunc(Number(spec.aisleCount))
  let maxAisle = -1
  for (const s of seats) if (s.aisleIndex > maxAisle) maxAisle = s.aisleIndex
  if (maxAisle >= 0 && maxAisle + 1 !== aisleCount) {
    throw new ConfigError(
      `${spec.id}: declares aisleCount=${aisleCount} but the layouts use ${maxAisle + 1}`,
    )
  }

  const economySet = new Set()
  for (const s of seats) if (s.classKey === 'economy') economySet.add(s.rowSlot)
  const economyRowSlots = [...economySet].sort((a, b) => a - b)

  const seatByPos = new Map()
  for (const s of seats) seatByPos.set(s.id, s)
  const rowSlotByNumber = new Map()
  for (const rs of rowSlots) rowSlotByNumber.set(rs.number, rs.slot)
  const cabinById = new Map()
  for (const c of cabins) cabinById.set(c.id, { ...c })

  return new Aircraft({
    id: spec.id,
    name: spec.name,
    manufacturer: spec.manufacturer || '',
    description: spec.description || '',
    aisleCount,
    seatPitchIn: Number(spec.seatPitchIn),
    binBagsPerRowSide: binBags,
    defaultConfig: spec.defaultConfig || {},
    cabins: cabins.map((c) => ({ ...c })),
    seats,
    doors,
    rowSlots,
    seatCount: seats.length,
    maxDepth,
    blockCount,
    length,
    seatByPos,
    rowSlotByNumber,
    economyRowSlots,
    cabinById,
    // renderer aliases
    lengthM: length,
    rowCount: rowSlots.length,
  })
}

/**
 * Round to 6 dp the way `geometry_payload` does -- which means Python's
 * `round(x, 6)`, i.e. half-to-EVEN decided on the exact binary value.
 *
 * `Math.round(v * 1e6) / 1e6` is not that: it is half-UP on a rounded product,
 * so `0.0000005` gives `1e-6` here and `0.0` in Python. Every value in the
 * current roster happens to agree, which is precisely what made this a latent
 * hazard rather than a visible bug -- a new airframe whose pitch landed on a tie
 * would have broken replay parity silently. `pyRound` exists for exactly this
 * and every other file in the port already uses it.
 */
const r6 = (v) => pyRound(v, 6)
const r4 = (v) => pyRound(v, 4)

/**
 * The resolved geometry, JSON-ready, for the replay format and the renderer.
 *
 * Mirrors `aircraft.geometry_payload`, plus the renderer's spelling of the same
 * fields (`rowNumber`/`pitchM`/`isExitRow` on rows) so `src/cabin/geometry.js`
 * can consume a replay directly.
 */
export function geometryPayload(ac) {
  return {
    id: ac.id,
    name: ac.name,
    manufacturer: ac.manufacturer,
    description: ac.description,
    aisleCount: ac.aisleCount,
    seatCount: ac.seatCount,
    maxDepth: ac.maxDepth,
    lengthM: r6(ac.length),
    binBagsPerRowSide: ac.binBagsPerRowSide,
    cabins: ac.cabins.map((c) => ({
      id: c.id,
      name: c.name,
      classKey: c.classKey,
      rows: [...c.rows],
      layout: [...c.layout],
      pitchIn: c.pitchIn,
      exitRows: [...(c.exitRows || [])],
      missingSeats: [...(c.missingSeats || [])],
    })),
    rows: ac.rowSlots.map((r) => ({
      slot: r.slot,
      number: r.number,
      x: r6(r.x),
      pitch: r6(r.pitch),
      cabinId: r.cabinId,
      rowNumber: r.number,
      pitchM: r6(r.pitch),
      isExitRow: Boolean(r.isExitRow),
    })),
    rowSlots: ac.rowSlots.map((r) => ({
      slot: r.slot,
      number: r.number,
      rowNumber: r.number,
      x: r6(r.x),
      pitch: r6(r.pitch),
      pitchM: r6(r.pitch),
      cabinId: r.cabinId,
      isExitRow: Boolean(r.isExitRow),
    })),
    seats: ac.seats.map((s) => ({
      index: s.index,
      id: s.id,
      row: s.rowNumber,
      rowNumber: s.rowNumber,
      letter: s.letter,
      cabinId: s.cabinId,
      classKey: s.classKey,
      rowSlot: s.rowSlot,
      x: r6(s.x),
      aisle: s.aisleIndex,
      aisleIndex: s.aisleIndex,
      lane: s.aisleIndex,
      side: s.side,
      depth: s.depth,
      blockId: s.blockId,
      binRun: s.binRun,
      kind: s.kind,
      layoutPos: s.layoutPos,
      exitRow: s.isExitRow,
    })),
    doors: ac.doors.map((d) => ({
      id: d.id,
      name: d.name,
      x: r6(d.x),
      aisle: d.aisleIndex,
      aisleIndex: d.aisleIndex,
      kind: d.kind,
      boardable: d.boardable,
      defaultEnabled: d.defaultEnabled,
      rowBefore: d.rowBefore,
    })),
    rowCount: ac.rowSlots.length,
  }
}

export { r4 }
