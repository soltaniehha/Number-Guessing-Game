/**
 * Deterministic replay fixtures for the cabin view.
 *
 * This is NOT the engine — `src/sim/` owns that, and this module deliberately
 * has zero dependency on it so the cabin view can be developed, tested and
 * demoed on its own. It builds two plausible aircraft (a 3-3 single-aisle
 * 180-seater and a 3-4-3 twin-aisle widebody) and runs a small boarding model
 * over them to produce a `Replay` in exactly the shape the real engine emits.
 *
 * Same options in, byte-identical frames out.
 */

// --- tiny deterministic PRNG (fixtures only; parity is not a concern here) --

function mulberry32(seed) {
  let a = (seed >>> 0) || 1
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled(list, rnd) {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

function pickWeighted(rnd, entries) {
  let total = 0
  for (const e of entries) total += e[1]
  let r = rnd() * total
  for (const e of entries) {
    r -= e[1]
    if (r <= 0) return e[0]
  }
  return entries[entries.length - 1][0]
}

const INCH = 0.0254
const BODY_DEPTH = 0.4
const NOSE_M = 6.2

// ---------------------------------------------------------------------------
// Aircraft builders
// ---------------------------------------------------------------------------

/**
 * Assemble an Aircraft from a compact cabin description.
 * @param {object} spec
 */
function buildAircraft(spec) {
  const rowSlots = []
  const seats = []
  const cabins = []
  let x = NOSE_M

  for (const cabin of spec.cabins) {
    cabins.push({
      id: cabin.id,
      name: cabin.name,
      classKey: cabin.classKey,
      layout: cabin.layout,
    })
    const pitchM = cabin.pitchIn * INCH
    for (const rowNumber of cabin.rows) {
      x += pitchM / 2
      rowSlots.push({
        rowNumber,
        x: round4(x),
        pitchM: round4(pitchM),
        cabinId: cabin.id,
        isExitRow: (cabin.exitRows || []).includes(rowNumber),
      })
      const lateral = laneAssignment(cabin.layout)
      for (const cell of cabin.layout) {
        if (cell === '|') continue
        const info = lateral.get(cell)
        seats.push({
          id: `${rowNumber}${cell}`,
          rowNumber,
          rowSlot: rowSlots.length - 1,
          letter: cell,
          lane: info.lane,
          depth: info.depth,
          side: info.side,
          x: round4(x),
          cabinId: cabin.id,
        })
      }
      x += pitchM / 2
    }
    x += spec.dividerM ?? 1.7 // galley / lavatory block between cabins
  }

  const cabinEnd = x
  const doors = spec.doors.map((door) => ({
    id: door.id,
    name: door.name,
    x: door.atRow === null
      ? round4(cabinEnd + 0.4)
      : round4(rowX(rowSlots, door.atRow) - rowPitch(rowSlots, door.atRow) / 2 - 0.35),
    aisleIndex: door.aisleIndex,
    kind: door.kind,
    enabled: door.enabled,
  }))

  return {
    id: spec.id,
    name: spec.name,
    aisleCount: spec.aisleCount,
    rowSlots,
    seats,
    cabins,
    doors,
    lengthM: round4(cabinEnd + spec.tailM),
  }
}

function rowX(rowSlots, rowNumber) {
  const row = rowSlots.find((r) => r.rowNumber === rowNumber)
  return row ? row.x : NOSE_M
}
function rowPitch(rowSlots, rowNumber) {
  const row = rowSlots.find((r) => r.rowNumber === rowNumber)
  return row ? row.pitchM : 0.79
}
function round4(n) {
  return Math.round(n * 10000) / 10000
}

/**
 * For one layout, work out each letter's serving aisle, its depth from that
 * aisle (1 = aisle seat) and which seat block it belongs to.
 * Mirrors ENGINE_SPEC 2.1.
 */
export function laneAssignment(layout) {
  const aisleAt = []
  for (let i = 0; i < layout.length; i++) if (layout[i] === '|') aisleAt.push(i)
  const out = new Map()
  let side = 0
  for (let i = 0; i < layout.length; i++) {
    if (layout[i] === '|') {
      side++
      continue
    }
    let lane = 0
    let best = Infinity
    for (let k = 0; k < aisleAt.length; k++) {
      const d = Math.abs(aisleAt[k] - i)
      if (d < best) {
        best = d
        lane = k
      }
    }
    out.set(layout[i], { lane, depth: best, side })
  }
  return out
}

/** 3-3 single aisle, 180 seats: 12 in a 2-2 first cabin, 168 in economy. */
export function makeSingleAisleAircraft() {
  const economyRows = []
  for (let r = 4; r <= 32; r++) if (r !== 13) economyRows.push(r) // 28 rows
  return buildAircraft({
    id: 'a320neo',
    name: 'A320neo (3-3, 180 seats)',
    aisleCount: 1,
    tailM: 9.4,
    cabins: [
      {
        id: 'first',
        name: 'First',
        classKey: 'first',
        layout: ['A', 'B', '|', 'E', 'F'],
        rows: [1, 2, 3],
        pitchIn: 38,
      },
      {
        id: 'economy',
        name: 'Main Cabin',
        classKey: 'economy',
        layout: ['A', 'B', 'C', '|', 'D', 'E', 'F'],
        rows: economyRows,
        pitchIn: 30,
        exitRows: [16, 17],
      },
    ],
    doors: [
      { id: '1L', name: '1L', atRow: 1, aisleIndex: 0, kind: 'jetbridge', enabled: true },
      { id: '2L', name: '2L', atRow: null, aisleIndex: 0, kind: 'airstair', enabled: false },
    ],
  })
}

/** 3-4-3 twin aisle, 324 seats across business / premium / economy. */
export function makeTwinAisleAircraft() {
  const economyRows = []
  for (let r = 20; r <= 45; r++) economyRows.push(r) // 26 rows x 10
  return buildAircraft({
    id: 'b77w',
    name: '777-300ER (3-4-3, 324 seats)',
    aisleCount: 2,
    tailM: 13.5,
    cabins: [
      {
        id: 'business',
        name: 'Business',
        classKey: 'business',
        layout: ['A', '|', 'D', 'E', '|', 'K'],
        rows: [1, 2, 3, 4, 5, 6, 7, 8],
        pitchIn: 78,
      },
      {
        id: 'premium',
        name: 'Premium',
        classKey: 'premium',
        layout: ['A', 'B', '|', 'D', 'E', 'F', 'G', '|', 'J', 'K'],
        rows: [11, 12, 13, 14],
        pitchIn: 38,
      },
      {
        id: 'economy',
        name: 'Economy',
        classKey: 'economy',
        layout: ['A', 'B', 'C', '|', 'D', 'E', 'F', 'G', '|', 'H', 'J', 'K'],
        rows: economyRows,
        pitchIn: 31,
        exitRows: [30, 31],
      },
    ],
    doors: [
      { id: '1L', name: '1L', atRow: 1, aisleIndex: 0, kind: 'jetbridge', enabled: true },
      { id: '2L', name: '2L', atRow: 20, aisleIndex: 1, kind: 'jetbridge', enabled: true },
      { id: '4L', name: '4L', atRow: null, aisleIndex: 0, kind: 'jetbridge', enabled: false },
    ],
  })
}

export const AIRCRAFT_BUILDERS = {
  single: makeSingleAisleAircraft,
  twin: makeTwinAisleAircraft,
}

// ---------------------------------------------------------------------------
// Passenger generation
// ---------------------------------------------------------------------------

const TIERS = [
  ['Platinum', 6],
  ['Gold', 10],
  ['Silver', 16],
  ['Member', 30],
  ['General', 38],
]

function generatePassengers(aircraft, rnd, loadFactor) {
  const seats = aircraft.seats
  const target = Math.max(1, Math.round(loadFactor * seats.length))
  const chosen = shuffled(seats, rnd).slice(0, target)
  // Board in canonical seat order so ids are stable regardless of who boards.
  chosen.sort((a, b) => a.x - b.x || a.letter.localeCompare(b.letter))

  const cabinClass = new Map(aircraft.cabins.map((c) => [c.id, c.classKey]))
  const passengers = []
  let partyId = 0
  let partyLeft = 0

  for (let i = 0; i < chosen.length; i++) {
    const seat = chosen[i]
    if (partyLeft === 0) {
      partyId++
      partyLeft = pickWeighted(rnd, [[1, 52], [2, 30], [3, 10], [4, 8]])
    }
    partyLeft--
    const klass = cabinClass.get(seat.cabinId) || 'economy'
    passengers.push({
      id: i,
      seatRow: seat.rowNumber,
      seatLetter: seat.letter,
      seatX: seat.x,
      seatDepth: seat.depth,
      lane: seat.lane,
      side: seat.side,
      cabinId: seat.cabinId,
      tier: klass === 'economy' ? pickWeighted(rnd, TIERS) : capitalise(klass),
      groupLabel: '',
      bags: pickWeighted(rnd, [[0, 18], [1, 58], [2, 24]]),
      party: 0,
      partyId,
      doorId: '',
      walkSpeed: 0.72 + rnd() * 0.62,
      dexterity: 0.7 + rnd() * 0.7,
    })
  }

  const partySizes = new Map()
  for (const p of passengers) {
    partySizes.set(p.partyId, (partySizes.get(p.partyId) || 0) + 1)
  }
  for (const p of passengers) p.party = partySizes.get(p.partyId)

  return passengers
}

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ---------------------------------------------------------------------------
// Boarding order
// ---------------------------------------------------------------------------

const STRATEGIES = {
  random(passengers, rnd) {
    const order = shuffled(passengers, rnd)
    for (const p of order) p.groupLabel = 'Open'
    return order
  },
  back_to_front(passengers, rnd, zones = 4) {
    const rows = passengers.map((p) => p.seatRow)
    const lo = Math.min(...rows)
    const hi = Math.max(...rows)
    const span = Math.max(1, hi - lo + 1)
    for (const p of passengers) {
      const z = Math.min(zones - 1, Math.floor(((p.seatRow - lo) / span) * zones))
      p.groupLabel = `Zone ${zones - z}`
    }
    return shuffled(passengers, rnd).sort(
      (a, b) => zoneNumber(a) - zoneNumber(b),
    )
  },
  wilma(passengers, rnd) {
    const names = { 3: 'Window', 2: 'Middle', 1: 'Aisle' }
    for (const p of passengers) {
      p.groupLabel = names[p.seatDepth] || `Depth ${p.seatDepth}`
    }
    return shuffled(passengers, rnd).sort((a, b) => b.seatDepth - a.seatDepth)
  },
}

function zoneNumber(p) {
  const m = /(\d+)/.exec(p.groupLabel)
  return m ? Number(m[1]) : 0
}

// ---------------------------------------------------------------------------
// The mini boarding model
// ---------------------------------------------------------------------------

/**
 * Build a deterministic replay.
 *
 * @param {object} [options]
 * @param {'single'|'twin'|object} [options.aircraft='single']
 * @param {number} [options.seed=20240101]
 * @param {number} [options.loadFactor=0.92]
 * @param {'random'|'back_to_front'|'wilma'} [options.strategy='back_to_front']
 * @param {number} [options.frameInterval=0.25]
 * @param {string[]} [options.doors] enabled door ids, overriding the defaults
 * @param {boolean} [options.typedFrames=true] emit typed arrays like the engine
 * @returns {object} Replay
 */
export function makeReplay(options = {}) {
  const {
    seed = 20240101,
    loadFactor = 0.92,
    strategy = 'back_to_front',
    frameInterval = 0.25,
    typedFrames = true,
    maxSeconds = 3600,
  } = options

  const aircraft = typeof options.aircraft === 'object' && options.aircraft
    ? options.aircraft
    : (AIRCRAFT_BUILDERS[options.aircraft || 'single'] || makeSingleAisleAircraft)()

  const rnd = mulberry32(seed)
  const passengers = generatePassengers(aircraft, rnd, loadFactor)
  const order = (STRATEGIES[strategy] || STRATEGIES.back_to_front)(passengers, rnd)

  if (Array.isArray(options.doors)) {
    for (const door of aircraft.doors) door.enabled = options.doors.includes(door.id)
  }
  const enabledDoors = aircraft.doors.filter((d) => d.enabled)
  const doors = enabledDoors.length ? enabledDoors : [aircraft.doors[0]]
  assignDoors(passengers, doors)

  const n = passengers.length
  const laneCount = Math.max(1, aircraft.aisleCount || 1)

  // Per-passenger runtime state.
  const state = new Int8Array(n) // 0 QUEUED
  const pos = new Float32Array(n)
  const timer = new Float32Array(n)
  const enterAt = new Float32Array(n).fill(-1)
  const sitAt = new Float32Array(n).fill(-1)
  const stowTime = new Float32Array(n)
  const shuffleTime = new Float32Array(n)
  const seatedByRowSide = new Map() // `${row}:${side}` -> [depths]

  for (let i = 0; i < n; i++) {
    const p = passengers[i]
    stowTime[i] = p.bags === 0
      ? 0
      : (7.2 * Math.pow(p.bags, 0.85)) * p.dexterity * (0.75 + rnd() * 0.6)
  }

  const queues = new Map()
  for (const door of doors) queues.set(door.id, [])
  for (const p of order) {
    const q = queues.get(p.doorId)
    if (q) q.push(p.id)
  }
  const heads = new Map()
  const gateTimer = new Map()
  for (const door of doors) {
    heads.set(door.id, 0)
    gateTimer.set(door.id, 0)
  }

  const stateFrames = []
  const xFrames = []
  const dt = frameInterval
  const maxFrames = Math.ceil(maxSeconds / dt)

  let seatedCount = 0
  let t = 0
  const walkers = []

  for (let f = 0; f <= maxFrames; f++) {
    // Snapshot before advancing so frame 0 is the initial condition.
    stateFrames.push(typedFrames ? Int8Array.from(state) : Array.from(state))
    xFrames.push(typedFrames ? Float32Array.from(pos) : Array.from(pos))
    if (seatedCount === n) break

    // (a) release from door queues
    for (const door of doors) {
      const q = queues.get(door.id)
      let head = heads.get(door.id)
      gateTimer.set(door.id, gateTimer.get(door.id) - dt)
      if (head >= q.length || gateTimer.get(door.id) > 0) continue
      const id = q[head]
      const lane = passengers[id].lane
      if (!laneClear(passengers, state, pos, lane, door.x, n)) continue
      state[id] = 1
      pos[id] = door.x
      enterAt[id] = t
      heads.set(door.id, head + 1)
      gateTimer.set(door.id, 1.6 + rnd() * 2.4)
    }

    // (b) move walkers, furthest along first, per lane
    for (let lane = 0; lane < laneCount; lane++) {
      walkers.length = 0
      for (let i = 0; i < n; i++) {
        if (state[i] === 1 && passengers[i].lane === lane) walkers.push(i)
      }
      walkers.sort((a, b) => pos[b] - pos[a])
      for (const i of walkers) {
        const p = passengers[i]
        const gap = gapAhead(passengers, state, pos, lane, i, n)
        const density = Math.min(1, gap / 0.85)
        const speed = Math.max(0.15, p.walkSpeed * density)
        const allowed = Math.max(0, gap - BODY_DEPTH + 0.4)
        const step = Math.min(speed * dt, allowed, p.seatX - pos[i])
        pos[i] += Math.max(0, step)
        if (p.seatX - pos[i] < 0.02) {
          pos[i] = p.seatX
          state[i] = 2
          timer[i] = stowTime[i]
          if (timer[i] <= 0) startShuffle(i)
        }
      }
    }

    // (c) stowing / (d) shuffling countdowns
    for (let i = 0; i < n; i++) {
      if (state[i] !== 2 && state[i] !== 3) continue
      timer[i] -= dt
      if (timer[i] > 0) continue
      if (state[i] === 2) startShuffle(i)
      else sit(i)
    }

    t += dt
  }

  function startShuffle(i) {
    const p = passengers[i]
    const key = `${p.seatRow}:${p.side}`
    const seatedDepths = seatedByRowSide.get(key) || []
    let blockers = 0
    for (const d of seatedDepths) if (d < p.seatDepth) blockers++
    if (blockers === 0) {
      sit(i)
      return
    }
    shuffleTime[i] = (blockers === 1 ? 9 : 15) * p.dexterity * (0.8 + rnd() * 0.5)
    state[i] = 3
    timer[i] = shuffleTime[i]
  }

  function sit(i) {
    const p = passengers[i]
    const key = `${p.seatRow}:${p.side}`
    if (!seatedByRowSide.has(key)) seatedByRowSide.set(key, [])
    seatedByRowSide.get(key).push(p.seatDepth)
    state[i] = 4
    sitAt[i] = t
    seatedCount++
  }

  const frameCount = stateFrames.length
  const duration = (frameCount - 1) * dt

  const perPassenger = passengers.map((p, i) => ({
    id: p.id,
    seat: `${p.seatRow}${p.seatLetter}`,
    row: p.seatRow,
    letter: p.seatLetter,
    depth: p.seatDepth,
    tier: p.tier,
    groupLabel: p.groupLabel,
    doorId: p.doorId,
    bags: p.bags,
    party: p.party,
    enterTime: enterAt[i] < 0 ? null : round4(enterAt[i]),
    sitTime: sitAt[i] < 0 ? null : round4(sitAt[i]),
    queueWaitTime: enterAt[i] < 0 ? null : round4(enterAt[i]),
    stowTime: round4(stowTime[i]),
    shuffleTime: round4(shuffleTime[i]),
  }))

  const seatedCurve = []
  for (let f = 0; f < frameCount; f += Math.max(1, Math.round(1 / dt))) {
    let seated = 0
    const row = stateFrames[f]
    for (let i = 0; i < n; i++) if (row[i] === 4) seated++
    seatedCurve.push({ t: round4(f * dt), seated })
  }

  return {
    aircraft,
    strategy,
    seed,
    frameInterval: dt,
    frameCount,
    duration: round4(duration),
    passengers: passengers.map(stripRuntime),
    frames: { state: stateFrames, x: xFrames },
    result: {
      totalSeconds: round4(duration),
      totalMinutes: round4(duration / 60),
      strategy,
      aircraftId: aircraft.id,
      seed,
      paxCount: n,
      seatCount: aircraft.seats.length,
      loadFactor,
      seatedCurve,
      perPassenger,
      throughputPaxPerMin: round4(n / Math.max(1 / 60, duration / 60)),
    },
  }
}

function stripRuntime(p) {
  return {
    id: p.id,
    seatRow: p.seatRow,
    seatLetter: p.seatLetter,
    seatX: p.seatX,
    seatDepth: p.seatDepth,
    lane: p.lane,
    side: p.side,
    cabinId: p.cabinId,
    tier: p.tier,
    groupLabel: p.groupLabel,
    bags: p.bags,
    party: p.party,
    doorId: p.doorId,
  }
}

/** Nearest enabled door forward of the seat, preferring the seat's own aisle. */
function assignDoors(passengers, doors) {
  for (const p of passengers) {
    let chosen = null
    for (const door of doors) {
      if (door.x > p.seatX + 0.01) continue
      if (door.aisleIndex !== p.lane) continue
      if (!chosen || door.x > chosen.x) chosen = door
    }
    if (!chosen) {
      for (const door of doors) {
        if (door.x > p.seatX + 0.01) continue
        if (!chosen || door.x > chosen.x) chosen = door
      }
    }
    p.doorId = (chosen || doors[0]).id
  }
}

function laneClear(passengers, state, pos, lane, x, n) {
  for (let i = 0; i < n; i++) {
    const s = state[i]
    if (s === 0 || s === 4) continue
    if (passengers[i].lane !== lane) continue
    if (Math.abs(pos[i] - x) < BODY_DEPTH * 1.5) return false
  }
  return true
}

function gapAhead(passengers, state, pos, lane, self, n) {
  let best = Infinity
  const me = pos[self]
  for (let i = 0; i < n; i++) {
    if (i === self) continue
    const s = state[i]
    if (s === 0 || s === 4) continue
    if (passengers[i].lane !== lane) continue
    const d = pos[i] - me
    if (d > 0 && d < best) best = d
  }
  return best
}
