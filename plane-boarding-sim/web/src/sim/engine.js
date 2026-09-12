/**
 * The simulation loop (ENGINE_SPEC 6).
 *
 * Port of `python/plane_boarding/engine.py`, statement for statement. Where the
 * Python uses a list indexed by passenger id, this uses a typed array of the
 * same length and the same contents; where it uses a dict keyed by a tuple,
 * this uses a Map on a packed integer key. Nothing about the ORDER of anything
 * -- loops, draws, comparisons -- differs.
 *
 * Continuous space, discrete time. Passengers hold a real-valued position along
 * a one-dimensional aisle lane and the world advances in fixed `dt` steps.
 *
 * Three service-time models do most of the work, all three Schultz's
 * field-calibrated ones rather than convenient guesses:
 *
 * * **Door arrivals** are exponential with mean 3.7 s. Easy to overlook and it
 *   dominates: a 186-seat single-door boarding cannot finish in under 11.5
 *   minutes no matter how clever the ordering is.
 * * **Stowing** is the sum of one Weibull(1.7, 16 s) draw per piece of luggage.
 *   Summing per piece rather than fitting a per-passenger total is what gives
 *   the right super-linear variance for two-bag passengers.
 * * **Seat shuffles** are an integer number of elementary movements, each
 *   Triangular(1.8, 2.4, 3.0) s. The count depends on *which* seats block, not
 *   merely how many: aisle-blocked is 4 movements, middle-blocked-window 5,
 *   both-blocked-window 9. Even an unobstructed passenger pays 1 movement just
 *   to sit down.
 */
import { getAircraft } from './aircraft.js'
import {
  BODY_DEPTH,
  ConfigError,
  DESIRED_HEADWAY,
  DOOR_STREAM_BASE,
  MAX_SIM_SECONDS,
  MIN_SPEED_FRACTION,
  ORDER_STREAM,
  PAX_STREAM,
  QUEUED,
  SEATED,
  SERVICE_PHASE_BIN,
  SERVICE_PHASE_SHUFFLE,
  SERVICE_PHASE_STOW,
  SERVICE_STREAM_BASE,
  SERVICE_STREAM_STRIDE,
  SHUFFLING,
  STOWING,
  WALKING,
  ticksFor,
} from './config.js'
import { percentile } from './metrics.js'
import { generate } from './passengers.js'
import { PCG32 } from './rng.js'
import { STRATEGIES, buildOrder } from './strategies.js'
import {
  bisectLeft,
  floorDiv,
  minByTuple,
  pyRound,
  pyRoundInt,
  removeFirst,
  sortByKey,
  sortByTuple,
} from './pyutil.js'

export const OPEN_SEATING = 'open_seating'

/** Packed key for the `(rowSlot, blockId)` and `(rowSlot, binRun)` maps. */
const pack = (a, b) => a * 64 + b

// ---------------------------------------------------------------------------
// Door assignment (ENGINE_SPEC 5)
// ---------------------------------------------------------------------------

/** Midpoints between consecutive doors, sorted fore to aft. */
function splitBoundaries(doors) {
  const xs = doors.map((d) => d.x).sort((a, b) => a - b)
  const out = []
  for (let i = 0; i < xs.length - 1; i++) out.push((xs[i] + xs[i + 1]) * 0.5)
  return out
}

const doorForX = (doorsSorted, bounds, x) => doorsSorted[bisectLeft(bounds, x)]

/** Stamp `doorId` on every passenger. */
export function assignDoors(queue, ac, doors, cfg, openSeating) {
  if (doors.length === 1 || cfg.doorAssignment === 'single') {
    for (const p of queue) p.doorId = doors[0].id
    return
  }

  if (openSeating) {
    // Nobody has a seat yet, so a seat-based split is meaningless. Ground staff
    // feed the queue into both doors at once -- but the split must be
    // proportional to how many seats each door's HALF OF THE CABIN holds, not a
    // flat round robin. If a door outran its own region, its remaining
    // passengers would have to walk past the other door to find a seat, and two
    // streams walking head-on down a single-file aisle deadlock: neither can
    // pass and neither will ever yield. Quota-ing by region capacity makes that
    // geometrically impossible rather than merely unlikely.
    const caps = doorRegions(ac, doors).map((v) => v.length)
    const left = caps.slice()
    for (const p of queue) {
      let best = 0
      let bestKey = -1.0
      for (let i = 0; i < caps.length; i++) {
        const c = caps[i]
        const key = c ? left[i] / c : -1.0
        if (key > bestKey) {
          best = i
          bestKey = key
        }
      }
      left[best] -= 1
      p.doorId = doors[best].id
    }
    return
  }

  const byX = sortByKey(doors.slice(), (d) => d.x)
  const bounds = splitBoundaries(byX)

  if (cfg.doorAssignment === 'split_by_row') {
    for (const p of queue) p.doorId = doorForX(byX, bounds, p.seat.x).id
    return
  }

  // split_by_aisle: use the door feeding your seat's aisle, ties broken by row.
  const perAisle = new Map()
  for (const d of byX) {
    let list = perAisle.get(d.aisleIndex)
    if (list === undefined) {
      list = []
      perAisle.set(d.aisleIndex, list)
    }
    list.push(d)
  }
  const fallbackBounds = bounds
  for (const p of queue) {
    const cand = perAisle.get(p.seat.aisleIndex)
    if (!cand || !cand.length) p.doorId = doorForX(byX, fallbackBounds, p.seat.x).id
    else if (cand.length === 1) p.doorId = cand[0].id
    else p.doorId = doorForX(cand, splitBoundaries(cand), p.seat.x).id
  }
}

/**
 * Partition every seat to the nearest door, splitting at the midpoints between
 * consecutive doors. Same rule as `split_by_row`, reused so the open seating
 * quota and the assigned-seat door split cannot disagree.
 */
export function doorRegions(ac, doors) {
  const byX = sortByKey(doors.slice(), (d) => d.x)
  const bounds = splitBoundaries(byX)
  const order = new Map()
  for (let i = 0; i < doors.length; i++) order.set(doors[i].id, i)
  const out = doors.map(() => [])
  for (const seat of ac.seats) out[order.get(doorForX(byX, bounds, seat.x).id)].push(seat)
  return out
}

// ---------------------------------------------------------------------------
// Open seating (ENGINE_SPEC 6.5)
// ---------------------------------------------------------------------------

const KIND_RANK = {
  aisle_first: { Aisle: 0, Window: 1, Middle: 2 },
  window_first: { Window: 0, Aisle: 1, Middle: 2 },
}

/** `inf` sorts badly through a tuple key in some runtimes; cap it instead. */
const finite = (v) => (v === Infinity ? 1e9 : v)

/**
 * Chooses a seat at the moment a passenger crosses the door line.
 *
 * That timing is the whole point: the choice depends on who is already seated,
 * which is exactly the real dynamic and the reason open seating is quicker than
 * its reputation -- people spontaneously avoid climbing over strangers.
 */
class OpenSeatPicker {
  constructor(ac, policy, doors) {
    this.policy = policy
    // One free list per door, covering only that door's half of the cabin.
    // Confining the choice to your own region is what keeps two boarding
    // streams from walking into each other in a single-file aisle.
    this.free = new Map()
    const regions = doorRegions(ac, doors)
    for (let i = 0; i < doors.length; i++) this.free.set(doors[i].id, regions[i])
    // Distance from each seat to the nearest already-SEATED passenger.
    // Maintained incrementally: recomputing it per choice would be O(S^2) per
    // passenger on a 197-seat aircraft.
    this.nearest = new Float64Array(ac.seatCount).fill(Infinity)
    this.rank = KIND_RANK[policy]
  }

  /**
   * Refresh the nearest-seated-neighbour distance for every free seat.
   *
   * This is O(free seats) per seating, so O(S^2) over a boarding, and it is the
   * obvious thing to blame for open seating costing ~2-3x a normal strategy. It
   * is not the cause, and it was measured rather than reasoned about: on a b777
   * at 90% load it is **2.5% of the run**. The quadratic that actually costs is
   * the `minByTuple` in `take` below -- one linear scan of the free pool per
   * door release, ~54% of the run -- and `front_first`, which never calls this
   * method at all, is the slowest policy of the four.
   *
   * A note for whoever reaches for this again. The port left it alone on the
   * grounds that `giveBack` can reinsert a seat that missed intervening
   * updates. **That reasoning is wrong**: `take` and `giveBack` are adjacent
   * statements in the door-release loop with no `sitDown` between them, so a
   * seat is never out of the pool across an `onSeated` call. The reason to leave
   * it alone is the measurement above -- optimising 2.5% cannot help, and every
   * way of speeding up `take` that is worth having (squared distances, a spatial
   * index) changes floating-point tie-breaking, which changes which seat is
   * chosen, which changes the draw sequence. A lazily revalidated priority queue
   * in `take` WOULD be provably identical, because `nearest` only ever decreases
   * and the sort key ends in `s.index` so the order is total; that is the change
   * to make if this ever matters.
   */
  onSeated(seat) {
    if (this.policy !== 'avoid_neighbours') return
    const sx = seat.x
    const sl = seat.lateral
    const nearest = this.nearest
    for (const pool of this.free.values()) {
      for (const s of pool) {
        const dx = s.x - sx
        const dl = s.lateral - sl
        const d = Math.sqrt(dx * dx + dl * dl)
        if (d < nearest[s.index]) nearest[s.index] = d
      }
    }
  }

  /**
   * Un-commit a seat when the aisle turned out to be blocked. The pool is kept
   * in seat-index order so the retry next tick is bit-identical.
   */
  giveBack(doorId, seat) {
    const pool = this.free.get(doorId)
    let lo = 0
    let hi = pool.length
    while (lo < hi) {
      const mid = floorDiv(lo + hi, 2)
      if (pool[mid].index < seat.index) lo = mid + 1
      else hi = mid
    }
    pool.splice(lo, 0, seat)
  }

  take(doorId, doorX) {
    const pool = this.free.get(doorId)
    if (!pool.length) return null
    const policy = this.policy
    let best
    if (policy === 'front_first') {
      best = minByTuple(pool, (s) => [Math.abs(s.x - doorX), s.index])
    } else if (policy === 'avoid_neighbours') {
      const nearest = this.nearest
      best = minByTuple(pool, (s) => [-finite(nearest[s.index]), Math.abs(s.x - doorX), s.index])
    } else {
      const rank = this.rank
      best = minByTuple(pool, (s) => [rank[s.kind], s.x, s.index])
    }
    removeFirst(pool, best)
    return best
  }
}

// ---------------------------------------------------------------------------
// The simulation
// ---------------------------------------------------------------------------

/**
 * One door's jetbridge queue.
 *
 * Each door owns its own PCG32 stream, advanced once per release. The k-th
 * person to walk through a given door therefore waits the same drawn gap no
 * matter which strategy put them there, which is what makes the door arrival
 * process cancel exactly in a paired comparison (ENGINE_SPEC 1.3).
 *
 * `arrivalTick` is when the CURRENT head of the queue reaches the door, and it
 * advances by one exponential draw per release regardless of whether the aisle
 * let that passenger in. That distinction matters more than it looks: the door
 * arrival process and aisle congestion run in PARALLEL, not in series. People
 * pile up on the jetbridge while the aisle is jammed and then walk on
 * back-to-back once it clears. Adding the two delays instead of max-ing them
 * roughly doubles the modelled boarding time.
 */
class DoorState {
  constructor(door, seed, index) {
    this.door = door
    this.queue = []
    this.cursor = 0
    this.arrivalTick = 0
    this.rng = new PCG32(seed, DOOR_STREAM_BASE + index)
  }
}

/**
 * Simulate one boarding.
 *
 * @param {import('./config.js').SimConfig} cfg
 * @param {object} [ac] resolved aircraft; looked up from `cfg` when omitted
 * @param {boolean} [recordReplay]
 * @param {number} [frameInterval]
 * @param {?function} [tickHook] called at the end of every tick as
 *   `hook(tick, t, pstate, px, plane, pdir, passing, passHolder)`. It exists so the
 *   test suite can assert invariants that involve the squeeze LOCK, which is
 *   interior state the replay format deliberately does not carry -- notably
 *   "a walker inside a stower's body-depth zone holds that stower's lock", the
 *   assertion that would have caught the squeeze-past deadlock. It is not part
 *   of the simulation: nothing it is handed may be mutated, and the default of
 *   `null` costs one comparison per tick.
 * @returns {{result: object, replay: object|null}}
 */
export function run(cfg, ac = null, recordReplay = false, frameInterval = 0.25, tickHook = null) {
  if (ac === null) ac = getAircraft(cfg.aircraftId)
  if (!Object.prototype.hasOwnProperty.call(STRATEGIES, cfg.strategy)) {
    throw new ConfigError(
      `unknown strategy '${cfg.strategy}'; known: ${JSON.stringify(Object.keys(STRATEGIES).sort())}`,
    )
  }

  const doors = ac.resolveDoors(cfg.doors)
  const openSeating = cfg.strategy === OPEN_SEATING

  const rngPax = new PCG32(cfg.seed, PAX_STREAM)
  const rngOrder = new PCG32(cfg.seed, ORDER_STREAM)

  const pax = generate(rngPax, ac, cfg)
  const queue = pax.length ? buildOrder(pax, ac, cfg, rngOrder) : []
  assignDoors(queue, ac, doors, cfg, openSeating)

  const n = queue.length
  const dt = cfg.dt
  const binCapOverride = cfg.binBagsPerRowSide

  // ---- flat state -------------------------------------------------------
  const px = new Float64Array(n)
  const ptarget = new Float64Array(n)
  const pdir = new Int8Array(n).fill(1)
  const pspeed = new Float64Array(n)
  const pstate = new Uint8Array(n).fill(QUEUED)
  const pblocked = new Float64Array(n)
  const ptrav = new Float64Array(n)
  const plane = new Int32Array(n)
  const penter = new Float64Array(n)
  const psit = new Float64Array(n)
  const pwalk = new Float64Array(n)
  const pstow = new Float64Array(n)
  const pshuf = new Float64Array(n)
  const pnblock = new Int32Array(n)
  const pwasblocked = new Uint8Array(n)
  const pgatechecked = new Int32Array(n)
  const pidx = new Int32Array(n)
  // Partial-blocking bookkeeping. A STOWING passenger stands in the seat-row
  // gap rather than the aisle centreline, so exactly ONE follower at a time may
  // squeeze past them; `passHolder` is that mutual exclusion and `passing` is
  // the follower's side of it. `stowDone` closes the squeeze to new entrants
  // the moment the stow finishes, so a stower in heavy traffic cannot be
  // starved of its chance to sit down.
  const passHolder = new Int32Array(n).fill(-1)
  const passing = new Int32Array(n).fill(-1)
  const stowDone = new Uint8Array(n)
  let pendingShuffle = []

  const pbags = new Int32Array(n)
  const pmult = new Float64Array(n).fill(1)
  const pdepth = new Int32Array(n)
  const prow = new Int32Array(n)
  const pblockid = new Int32Array(n)
  const pbinrun = new Int32Array(n)
  const pparty = new Int32Array(n)
  const ppaxid = new Int32Array(n)
  const pseat = new Array(n).fill(null)

  for (const p of queue) {
    const i = p.boardingIndex
    pbags[i] = p.bags
    pmult[i] = p.stowMultiplier
    pspeed[i] = p.walkSpeed
    pparty[i] = p.partyId
    // The PASSENGER id, not the boarding index: it is assigned in canonical
    // seat order off the `pax` stream and is therefore the same person under
    // every strategy. Keying the service streams on it is the whole point.
    ppaxid[i] = p.id
    if (!openSeating) {
      const s = p.seat
      pseat[i] = s
      pdepth[i] = s.depth
      prow[i] = s.rowSlot
      pblockid[i] = s.blockId
      pbinrun[i] = s.binRun
      plane[i] = s.aisleIndex
      ptarget[i] = s.x
    }
  }

  const picker = openSeating ? new OpenSeatPicker(ac, cfg.openSeatingPolicy, doors) : null

  // ---- lanes ------------------------------------------------------------
  const nLanes = ac.aisleCount
  const laneOcc = []
  const laneWalk = []
  for (let i = 0; i < nLanes; i++) {
    laneOcc.push([])
    laneWalk.push([])
  }

  // ---- doors ------------------------------------------------------------
  const doorStates = doors.map((d, i) => new DoorState(d, cfg.seed, i))
  const doorById = new Map()
  for (const ds of doorStates) doorById.set(ds.door.id, ds)
  for (const p of queue) doorById.get(p.doorId).queue.push(p.boardingIndex)

  // ---- overhead bins ----------------------------------------------------
  const rowCaps = []
  for (const rs of ac.rowSlots) {
    if (binCapOverride === null) rowCaps.push(rs.binCaps.slice())
    else rowCaps.push(rs.binCaps.map((c) => (c > 0 ? binCapOverride : 0)))
  }
  const binUsed = rowCaps.map((c) => new Int32Array(c.length))
  const nRows = rowCaps.length

  // ---- seated occupancy, for the shuffle model --------------------------
  // `key -> [depth, party, depth, party, ...]`, appended in seating order.
  const seatedBlock = new Map()

  // ---- congestion bucketing --------------------------------------------
  const centres = ac.rowSlots.map((rs) => rs.x)
  const edges = new Float64Array(Math.max(0, nRows - 1))
  for (let i = 0; i < nRows - 1; i++) edges[i] = (centres[i] + centres[i + 1]) * 0.5

  // ---- counters ---------------------------------------------------------
  let gateChecks = 0
  let binSearches = 0
  let blockEvents = 0
  let interNone = 0
  let interOne = 0
  let interTwo = 0
  let interSame = 0
  let seatedCount = 0

  const wake = new Map()

  // ---- per-passenger service streams (ENGINE_SPEC 1.3) ------------------
  // One PCG32 per passenger per service phase, keyed on the passenger id. Built
  // lazily: a passenger with no bags never needs a stow stream, and most
  // passengers never need a bin-search one.
  //
  // Phases are SEPARATE streams rather than a single per-passenger sequence
  // because two of them consume a number of draws that legitimately depends on
  // the boarding order -- how many bin searches you make depends on who filled
  // the bin, how many shuffle movements you make depends on who is already
  // sitting there. Sharing one stream would let that variable count shift every
  // later draw and reintroduce exactly the order dependence this removes.
  const seed = cfg.seed
  const stowStreams = new Array(n).fill(null)
  const binStreams = new Array(n).fill(null)
  const shuffleStreams = new Array(n).fill(null)

  function serviceRng(cache, pid, phase) {
    let r = cache[pid]
    if (r === null) {
      r = new PCG32(seed, SERVICE_STREAM_BASE + ppaxid[pid] * SERVICE_STREAM_STRIDE + phase)
      cache[pid] = r
    }
    return r
  }

  // ---- local bindings for the hot loop ----------------------------------
  const wShape = cfg.stowWeibullShape
  const wScale = cfg.stowWeibullScale
  const tLo = cfg.shuffleMoveMin
  const tMode = cfg.shuffleMoveMode
  const tHi = cfg.shuffleMoveMax
  const mv = cfg.shuffleMovements
  const mvNone = mv.none
  const mvAisle = mv.aisle
  const mvMid = mv.middle
  const mvBoth = mv.both
  const mvParty = cfg.shuffleSamePartyMovements
  const binRadius = cfg.binSearchRadius
  const binPenalty = cfg.binSearchPenalty
  const gatePenalty = cfg.gateCheckPenalty
  const binWeight = cfg.binCongestionWeight
  const doorMean = cfg.doorArrivalMean
  const passFactor = cfg.stowPassSpeedFactor
  const headway = DESIRED_HEADWAY
  const body = BODY_DEPTH
  const minFrac = MIN_SPEED_FRACTION

  const sampleTicks = Math.max(1, pyRoundInt(cfg.sampleInterval / dt))
  const maxTicks = Math.trunc(MAX_SIM_SECONDS / dt)

  const seatedCurve = []
  const aisleCurve = []
  const congestion = []
  for (let i = 0; i < nRows; i++) congestion.push([])

  const framesState = []
  const framesX = []
  let nextFrameT = 0.0

  // ---- helpers (called O(n) times, not O(n*ticks)) ----------------------

  function laneInsert(lane, pid) {
    const occ = laneOcc[lane]
    const x = px[pid]
    let i = occ.length
    while (i > 0 && px[occ[i - 1]] > x) i -= 1
    occ.splice(i, 0, pid)
    for (let j = i; j < occ.length; j++) pidx[occ[j]] = j
  }

  function laneRemove(lane, pid) {
    const occ = laneOcc[lane]
    const i = pidx[pid]
    occ.splice(i, 1)
    for (let j = i; j < occ.length; j++) pidx[occ[j]] = j
  }

  /**
   * Is the doorway free by one body depth?
   *
   * Stowing passengers count here even though they are soft obstructions once
   * you are walking. Releasing somebody straight into a stower's squeeze zone
   * would put them there without the squeeze lock, and if the stow then
   * finished neither could move. Keeping the doorway strictly clear removes the
   * whole failure mode, and it costs little realism -- a passenger stowing at
   * row 1 really does hold up the door.
   */
  function doorClear(lane, x) {
    const occ = laneOcc[lane]
    if (!occ.length) return true
    // occ is sorted by x, so only the two neighbours of the door position can
    // possibly be within one body depth of it.
    let lo = 0
    let hi = occ.length
    while (lo < hi) {
      const mid = floorDiv(lo + hi, 2)
      if (px[occ[mid]] < x) lo = mid + 1
      else hi = mid
    }
    if (lo < occ.length && px[occ[lo]] - x < body) return false
    if (lo > 0 && x - px[occ[lo - 1]] < body) return false
    return true
  }

  /**
   * Place `bags` in the overhead bins, returning the seconds of extra faff.
   * Searching outward and gate-checking are extrapolation, not literature -- no
   * published boarding paper puts a number on them.
   */
  function stowPenalty(pid, slot, run, bags) {
    let penalty = 0.0
    const caps = rowCaps[slot]
    let rngBin = null
    for (let b = 0; b < bags; b++) {
      if (run < caps.length && binUsed[slot][run] < caps[run]) {
        binUsed[slot][run] += 1
        continue
      }
      binSearches += 1
      if (rngBin === null) rngBin = serviceRng(binStreams, pid, SERVICE_PHASE_BIN)
      const first = rngBin.bernoulli(0.5) ? 1 : -1
      let placed = false
      for (let d = 1; d <= binRadius; d++) {
        for (const sgn of [first, -first]) {
          const r2 = slot + sgn * d
          if (r2 >= 0 && r2 < nRows) {
            const c2 = rowCaps[r2]
            if (run < c2.length && binUsed[r2][run] < c2[run]) {
              binUsed[r2][run] += 1
              penalty += binPenalty * d
              placed = true
              break
            }
          }
        }
        if (placed) break
      }
      if (!placed) {
        gateChecks += 1
        penalty += gatePenalty
      }
    }
    return penalty
  }

  /**
   * May this stower stand its neighbours up yet?
   *
   * Not while anybody is within a body depth of them -- and that is a wider
   * condition than "somebody holds the squeeze lock", because a passenger
   * released at the door can land inside a stower's zone without ever having
   * taken the lock (door clearance ignores stowers, by design). occ is sorted,
   * so only the immediate neighbours can be close enough to matter.
   */
  function stowerClear(pid) {
    const occ = laneOcc[plane[pid]]
    const i = pidx[pid]
    const x = px[pid]
    if (i > 0 && x - px[occ[i - 1]] < body - 1e-9) return false
    if (i + 1 < occ.length && px[occ[i + 1]] - x < body - 1e-9) return false
    return true
  }

  function releasePass(pid) {
    const sp = passing[pid]
    if (sp >= 0) {
      if (passHolder[sp] === pid) passHolder[sp] = -1
      passing[pid] = -1
    }
  }

  function beginShuffle(pid, t, tick) {
    const key = pack(prow[pid], pblockid[pid])
    const occupants = seatedBlock.get(key)
    const d = pdepth[pid]
    // Blockers = already-seated occupants of this (row, block) at shallower
    // depth. Held as a flat [depth, party, ...] array; the pairs are read in
    // seating order, exactly as the Python list of tuples is.
    let nb = 0
    let allSameParty = true
    let hasAisle = false
    let hasMid = false
    const party = pparty[pid]
    if (occupants !== undefined) {
      for (let k = 0; k < occupants.length; k += 2) {
        const od = occupants[k]
        if (od >= d) continue
        nb += 1
        if (occupants[k + 1] !== party) allSameParty = false
        if (od === 1) hasAisle = true
        if (od >= 2) hasMid = true
      }
    }
    pnblock[pid] = nb
    let moves
    if (nb === 0) {
      interNone += 1
      moves = mvNone
    } else if (allSameParty) {
      interSame += 1
      moves = mvParty
    } else {
      if (hasAisle && hasMid) moves = mvBoth
      else if (hasMid) moves = mvMid
      else moves = mvAisle
      if (nb === 1) interOne += 1
      else interTwo += 1
    }
    let dur = 0.0
    if (moves) {
      const rngShuf = serviceRng(shuffleStreams, pid, SERVICE_PHASE_SHUFFLE)
      for (let k = 0; k < moves; k++) dur += rngShuf.triangular(tLo, tMode, tHi)
    }
    dur *= pmult[pid]
    pshuf[pid] = dur
    if (dur > 0.0) {
      pstate[pid] = SHUFFLING
      const at = tick + ticksFor(dur, dt)
      const list = wake.get(at)
      if (list === undefined) wake.set(at, [pid])
      else list.push(pid)
    } else {
      sitDown(pid, t)
    }
  }

  function sitDown(pid, t) {
    pstate[pid] = SEATED
    psit[pid] = t
    laneRemove(plane[pid], pid)
    const key = pack(prow[pid], pblockid[pid])
    let list = seatedBlock.get(key)
    if (list === undefined) {
      list = []
      seatedBlock.set(key, list)
    }
    list.push(pdepth[pid], pparty[pid])
    seatedCount += 1
    if (picker !== null) picker.onSeated(pseat[pid])
  }

  function arrive(pid, t, tick) {
    releasePass(pid)
    pwalk[pid] = t - penter[pid]
    const bags = pbags[pid]
    if (bags <= 0) {
      pstow[pid] = 0.0
      beginShuffle(pid, t, tick)
      return
    }
    const slot = prow[pid]
    const run = pbinrun[pid]
    const caps = rowCaps[slot]
    if (run >= caps.length) {
      // The seat says it stows under bin run `run`, and that run does not exist
      // above its own row. That is a broken geometry, not a full bin: treating
      // it as one (the old `: 1.0`) silently charged the passenger the maximum
      // bin-congestion penalty and hid the fault.
      const seat = pseat[pid]
      throw new ConfigError(
        `${ac.id}: seat ${seat ? seat.id : '?'} at row slot ${slot} declares binRun ` +
          `${run}, but that row has only ${caps.length} bin run(s). The seat map and ` +
          `the per-row bin capacities disagree.`,
      )
    }
    const cap = caps[run]
    // cap === 0 is a different thing entirely and IS legitimate: a bin run
    // declared with zero capacity (binBagsPerRowSide = 0) is full because it
    // never had room, so maximum congestion is the right answer there.
    const fill = cap > 0 ? binUsed[slot][run] / cap : 1.0
    let base = 0.0
    const rngStow = serviceRng(stowStreams, pid, SERVICE_PHASE_STOW)
    for (let b = 0; b < bags; b++) base += rngStow.weibull(wShape, wScale)
    let dur = base * pmult[pid] * (1.0 + binWeight * fill * fill)
    const before = gateChecks
    dur += stowPenalty(pid, slot, run, bags)
    pgatechecked[pid] = gateChecks - before
    pstow[pid] = dur
    if (dur > 0.0) {
      pstate[pid] = STOWING
      const at = tick + ticksFor(dur, dt)
      const list = wake.get(at)
      if (list === undefined) wake.set(at, [pid])
      else list.push(pid)
    } else {
      beginShuffle(pid, t, tick)
    }
  }

  // ---- main loop --------------------------------------------------------
  let tick = 0
  let t = 0.0
  while (seatedCount < n && tick <= maxTicks) {
    t = tick * dt

    // (a) release from door queues, in declared door order
    for (const ds of doorStates) {
      if (ds.cursor >= ds.queue.length || tick < ds.arrivalTick) continue
      const pid = ds.queue[ds.cursor]
      const door = ds.door
      if (picker !== null) {
        const seat = picker.take(door.id, door.x)
        if (seat === null) continue
        pseat[pid] = seat
        pdepth[pid] = seat.depth
        prow[pid] = seat.rowSlot
        pblockid[pid] = seat.blockId
        pbinrun[pid] = seat.binRun
        plane[pid] = seat.aisleIndex
        ptarget[pid] = seat.x
      }
      const lane = plane[pid]
      if (!doorClear(lane, door.x)) {
        if (picker !== null) picker.giveBack(door.id, pseat[pid]) // retry next tick
        continue
      }
      px[pid] = door.x
      penter[pid] = t
      pdir[pid] = ptarget[pid] >= door.x ? 1 : -1
      pstate[pid] = WALKING
      laneInsert(lane, pid)
      laneWalk[lane].push(pid)
      ds.cursor += 1
      // Cumulative, NOT `tick + ...`: the jetbridge queue keeps filling while
      // the aisle is blocked, so a backlog discharges at once.
      ds.arrivalTick += ticksFor(ds.rng.exponential(doorMean), dt)
      if (Math.abs(ptarget[pid] - px[pid]) < 1e-9) {
        removeFirst(laneWalk[lane], pid)
        arrive(pid, t, tick)
      }
    }

    // (b) service completions
    const due = wake.get(tick)
    if (due !== undefined) {
      wake.delete(tick)
      for (const pid of due) {
        if (pstate[pid] === STOWING) {
          // Finished with the bin, but the seat occupants cannot stand up while
          // somebody is edging past. Closing the squeeze to new entrants
          // (stowDone) bounds the wait to one passer.
          stowDone[pid] = 1
          pendingShuffle.push(pid)
        } else if (pstate[pid] === SHUFFLING) {
          sitDown(pid, t)
        }
      }
    }
    if (pendingShuffle.length) {
      const still = []
      for (const pid of pendingShuffle) {
        if (passHolder[pid] < 0 && stowerClear(pid)) beginShuffle(pid, t, tick)
        else still.push(pid)
      }
      pendingShuffle = still
    }

    // (c) move walkers
    for (let lane = 0; lane < nLanes; lane++) {
      const walkers = laneWalk[lane]
      if (!walkers.length) continue
      const occ = laneOcc[lane]
      const nOcc = occ.length
      // Furthest-travelled moves first, so a follower sees its leader's updated
      // position within the same tick.
      //
      // A stable descending insertion sort, which is the identical permutation
      // to Python's `sort(key=..., reverse=True)` -- CPython reverses, sorts
      // ascending stably, and reverses back, so equal keys keep their original
      // order, and the `< kv` test below stops on equality for the same reason.
      // Insertion sort rather than a general sort because this runs once per
      // lane per tick and the list is almost always already ordered: `ptrav`
      // only grows, and a passenger just released at the door appends with
      // `ptrav` zero, which is exactly where descending order wants them.
      for (let a = 1; a < walkers.length; a++) {
        const v = walkers[a]
        const kv = ptrav[v]
        let b = a - 1
        while (b >= 0 && ptrav[walkers[b]] < kv) {
          walkers[b + 1] = walkers[b]
          b -= 1
        }
        walkers[b + 1] = v
      }
      const arrived = []
      for (const pid of walkers) {
        const i = pidx[pid]
        const d = pdir[pid]
        // Let go of a squeeze once fully clear of the stower.
        let sp = passing[pid]
        if (sp >= 0 && d * (px[pid] - px[sp]) > body) {
          if (passHolder[sp] === pid) passHolder[sp] = -1
          passing[pid] = -1
          sp = -1
        }

        const j = i + d
        let cap = 1.0
        let gap
        let frac
        if (j >= 0 && j < nOcc) {
          const nb = occ[j]
          let squeeze = false
          // stowPassSpeedFactor == 0 turns the mechanism off entirely and
          // restores the strict model in which a stowing passenger closes the
          // aisle outright.
          if (passFactor > 0.0 && pstate[nb] === STOWING) {
            if (sp === nb) {
              squeeze = true
            } else if (
              passHolder[nb] < 0 &&
              !stowDone[nb] &&
              d * (ptarget[pid] - px[nb]) > 1e-9
            ) {
              // Passing is only meaningful if your seat is BEYOND theirs. Two
              // passengers bound for the same row still queue: there is one
              // aisle position to stand in.
              if (sp >= 0) {
                if (passHolder[sp] === pid) passHolder[sp] = -1
                passing[pid] = -1
              }
              passHolder[nb] = pid
              passing[pid] = nb
              squeeze = true
            }
          }
          if (squeeze) {
            cap = passFactor
            // Still must not run into whoever is beyond the stower.
            //
            // The bound is the VERY NEXT body, whatever it is doing. This used
            // to skip over intervening stowers, on the theory that a squeeze can
            // carry you past more than one of them -- but a squeeze lock covers
            // exactly one stower, the one at `nb`, so skipping let a passer come
            // to rest inside a SECOND stower's exclusion zone without holding its
            // lock. When that stow then finished, `stowDone` closed the squeeze
            // to new entrants, so the passer could never acquire the lock, its
            // gap clamped to 0, and `stowerClear` saw a body within BODY_DEPTH
            // forever. Circular wait -- reachable from the shipped UI at
            // dt >= 0.4 with stowPassSpeedFactor >= 0.8.
            //
            // Bounded this way the passer can only ever be inside the zone of the
            // stower it owns, which is the invariant asserted by
            // 'a walker inside a stower’s body-depth zone holds that stower’s lock'.
            const k = j + d
            if (k >= 0 && k < nOcc) {
              gap = Math.abs(px[occ[k]] - px[pid]) - body
              if (gap < 0.0) gap = 0.0
            } else {
              gap = 1e18
            }
          } else {
            gap = Math.abs(px[nb] - px[pid]) - body
            if (gap < 0.0) gap = 0.0
          }
          frac = gap / headway
          if (frac > 1.0) frac = 1.0
          else if (frac < minFrac) frac = minFrac
        } else {
          gap = 1e18
          frac = 1.0
        }
        const free = pspeed[pid] * dt // what they could do unobstructed
        const desired = free * frac * cap // density slowdown, then the squeeze
        const allowed = gap < desired ? gap : desired
        const remaining = Math.abs(ptarget[pid] - px[pid])
        const step = allowed < remaining ? allowed : remaining
        if (step > 0.0) {
          px[pid] += d * step
          ptrav[pid] += step
          // Crossing a stower reorders the lane: keep occ sorted by x.
          const sp2 = passing[pid]
          if (sp2 >= 0 && d * (px[pid] - px[sp2]) > 0.0) {
            const a = pidx[pid]
            const b = pidx[sp2]
            if (a + d === b) {
              occ[a] = sp2
              occ[b] = pid
              pidx[pid] = b
              pidx[sp2] = a
            }
          }
        }
        // Lost time is measured against FREE FLOW, so it captures the density
        // slowdown and the squeeze as well as a hard stop -- but the final
        // partial step onto your own row is arrival, not obstruction, so
        // `remaining` is excluded from this comparison.
        if (allowed < free) {
          pblocked[pid] += dt * (1.0 - allowed / free)
          if (!pwasblocked[pid]) {
            pwasblocked[pid] = 1
            blockEvents += 1
          }
        } else {
          pwasblocked[pid] = 0
        }
        if (remaining - step < 1e-9) arrived.push(pid)
      }
      if (arrived.length) {
        for (const pid of arrived) {
          removeFirst(walkers, pid)
          arrive(pid, t, tick)
        }
      }
    }

    // (d) bookkeeping
    if (tick % sampleTicks === 0) {
      let occupied = 0
      const counts = new Int32Array(nRows)
      for (let lane = 0; lane < nLanes; lane++) {
        for (const pid of laneOcc[lane]) {
          occupied += 1
          const x = px[pid]
          if (edges.length) counts[bisectLeft(edges, x)] += 1
          else counts[0] += 1
        }
      }
      seatedCurve.push({ t: pyRound(t, 6), seated: seatedCount })
      aisleCurve.push({ t: pyRound(t, 6), count: occupied })
      // Integers, matching Python. It IS a body count; Python used to store it
      // as a float, so it serialised `0.0` where this serialises `0` and the
      // replay JSON was not byte-comparable even though the values agreed.
      // `counts` is an Int32Array, so these are already integers. See
      // ENGINE_SPEC 7.
      for (let r = 0; r < nRows; r++) congestion[r].push(counts[r])
    }

    if (recordReplay && t + 1e-9 >= nextFrameT) {
      framesState.push(Array.from(pstate))
      const row = new Array(n)
      for (let i = 0; i < n; i++) row[i] = pyRound(px[i], 4)
      framesX.push(row)
      nextFrameT += frameInterval
    }

    if (tickHook !== null) tickHook(tick, t, pstate, px, plane, pdir, passing, passHolder)

    tick += 1
  }

  const total = t
  const completed = seatedCount >= n
  if (!completed) {
    for (let pid = 0; pid < n; pid++) if (pstate[pid] !== SEATED) psit[pid] = total
  }

  // final sample so the curves close on the true end time.
  //
  // The aisle count is the REAL lane occupancy, not `n - seatedCount`. On a run
  // that hit MAX_SIM_SECONDS the difference is everybody still waiting on the
  // jetbridge -- they are QUEUED, not in the aisle -- and counting them here put
  // a spike on the end of the aisle-occupancy chart that was pure artefact. On a
  // completed run both expressions are zero.
  let finalInAisle = 0
  for (const occ of laneOcc) finalInAisle += occ.length
  seatedCurve.push({ t: pyRound(total, 6), seated: seatedCount })
  aisleCurve.push({ t: pyRound(total, 6), count: finalInAisle })
  if (recordReplay) {
    framesState.push(Array.from(pstate))
    const row = new Array(n)
    for (let i = 0; i < n; i++) row[i] = pyRound(px[i], 4)
    framesX.push(row)
  }

  // ---- results ----------------------------------------------------------
  const records = []
  let walkTotal = 0.0
  let stowTotal = 0.0
  let shufTotal = 0.0
  let blockedTotal = 0.0
  // Two different questions, kept apart on purpose (ENGINE_SPEC 7):
  //   aisleTimes = sit - enter  -- "how long was I stuck in the aisle"
  //   sits       = sit          -- "how long from doors-open until I sat down",
  //                                which includes the jetbridge queue
  const aisleTimes = []
  const sits = []
  for (const p of queue) {
    const i = p.boardingIndex
    const s = pseat[i]
    const sit = psit[i]
    const enter = penter[i]
    walkTotal += pwalk[i]
    stowTotal += pstow[i]
    shufTotal += pshuf[i]
    blockedTotal += pblocked[i]
    aisleTimes.push(sit - enter)
    sits.push(sit)
    records.push({
      id: p.id,
      seat: s ? s.id : '',
      row: s ? s.rowNumber : 0,
      letter: s ? s.letter : '',
      depth: pdepth[i],
      tier: p.tier,
      groupLabel: p.groupLabel,
      doorId: p.doorId,
      bags: p.bags,
      party: p.partyId,
      enterTime: pyRound(enter, 6),
      sitTime: pyRound(sit, 6),
      timeInAisle: pyRound(sit - enter, 6),
      walkTime: pyRound(pwalk[i], 6),
      stowTime: pyRound(pstow[i], 6),
      shuffleTime: pyRound(pshuf[i], 6),
      blockedTime: pyRound(pblocked[i], 6),
      queueWaitTime: pyRound(enter, 6),
      blockers: pnblock[i],
      gateChecked: pgatechecked[i],
    })
  }
  sortByKey(records, (r) => r.id)

  // Per-door sequencing quality. The interesting question with more than one
  // door is not "was a door idle" -- both doors admit from t=0 -- it is "did
  // each door load its FAR end first". Boarding the rows nearest a door first
  // is the front-to-back pathology in miniature, and a zone order that is right
  // for the forward door is automatically wrong for the aft one.
  //
  // Score, per door: mean distance-from-door of the first half of that door's
  // queue minus that of the second half, over the cabin length. Positive = far
  // end first (what you want); negative = the pathology; near zero = no spatial
  // logic. The reported figure is the WORST door, not the average, because a
  // cabin-wide rear-first order scores +0.25 at the forward door and -0.25 at
  // the aft one and those cancel to nothing if you average them.
  const doorStats = {}
  const doorX = new Map()
  for (const d of doors) doorX.set(d.id, d.x)
  const byDoor = new Map()
  for (const d of doors) byDoor.set(d.id, [])
  for (const p of queue) {
    const s = pseat[p.boardingIndex]
    if (s !== null && byDoor.has(p.doorId)) {
      byDoor.get(p.doorId).push([p.boardingIndex, Math.abs(s.x - doorX.get(p.doorId))])
    }
  }
  const scores = []
  const span = ac.length > 0 ? ac.length : 1.0
  for (const [did, entries] of byDoor) {
    sortByTuple(entries, (e) => e)
    const k = entries.length
    const stats = { count: k, meanWalk: 0.0, farFirst: 0.0 }
    if (k) {
      let acc = 0.0
      for (const e of entries) acc += e[1]
      stats.meanWalk = pyRound(acc / k, 6)
    }
    if (k >= 4) {
      const half = floorDiv(k, 2)
      let a = 0.0
      for (let i = 0; i < half; i++) a += entries[i][1]
      const first = a / half
      let b = 0.0
      for (let i = half; i < k; i++) b += entries[i][1]
      const second = b / (k - half)
      stats.farFirst = pyRound((first - second) / span, 6)
      scores.push(stats.farFirst)
    }
    doorStats[did] = stats
  }
  let sequencing = 0.0
  if (scores.length) {
    let m = scores[0]
    for (const v of scores) if (v < m) m = v
    sequencing = pyRound(m, 6)
  }

  const sortedAisle = aisleTimes.slice().sort((a, b) => a - b)
  const sortedSits = sits.slice().sort((a, b) => a - b)
  const result = {
    totalSeconds: pyRound(total, 6),
    totalMinutes: pyRound(total / 60.0, 6),
    strategy: cfg.strategy,
    aircraftId: ac.id,
    seed: cfg.seed,
    paxCount: n,
    seatCount: ac.seatCount,
    loadFactor: cfg.loadFactor,
    doors: doors.map((d) => d.id),
    seatedCurve,
    aisleOccupancy: aisleCurve,
    congestion,
    perPassenger: records,
    timeBreakdown: {
      walk: pyRound(walkTotal, 6),
      stow: pyRound(stowTotal, 6),
      shuffle: pyRound(shufTotal, 6),
      blocked: pyRound(blockedTotal, 6),
    },
    interference: { none: interNone, one: interOne, two: interTwo, sameParty: interSame },
    gateChecks,
    binSearches,
    aisleBlockEvents: blockEvents,
    // Time from crossing the aircraft door to being seated. This is the
    // quantity `perPassenger[].timeInAisle` already held and the one the
    // "passenger wait time" chart exists to show: a fast mean hiding a
    // miserable tail. It used to be computed off `sitTime`, which made the
    // reported maximum identically `totalSeconds` on every completed run.
    p50AisleSeconds: pyRound(percentile(sortedAisle, 0.5), 6),
    p90AisleSeconds: pyRound(percentile(sortedAisle, 0.9), 6),
    maxAisleSeconds: sortedAisle.length ? pyRound(sortedAisle[sortedAisle.length - 1], 6) : 0.0,
    // Time from the start of boarding to being seated -- the same wait plus
    // however long you stood on the jetbridge. There is deliberately no `max`
    // here: the last person to sit down sits at `totalSeconds` by definition,
    // so a maximum of this series is not a statistic.
    p50BoardingWaitSeconds: pyRound(percentile(sortedSits, 0.5), 6),
    p90BoardingWaitSeconds: pyRound(percentile(sortedSits, 0.9), 6),
    // Deprecated aliases, kept so existing consumers keep working. They now
    // carry the AISLE quantity, i.e. they are finally what their name says.
    p50TimeToSeat: pyRound(percentile(sortedAisle, 0.5), 6),
    p90TimeToSeat: pyRound(percentile(sortedAisle, 0.9), 6),
    maxTimeToSeat: sortedAisle.length ? pyRound(sortedAisle[sortedAisle.length - 1], 6) : 0.0,
    throughputPaxPerMin: total > 0 ? pyRound(n / (total / 60.0), 6) : 0.0,
    completed,
    doorStats,
    doorSequencing: sequencing,
    gateCheckRate: n ? gateChecks / n : 0.0,
  }

  let replay = null
  if (recordReplay) {
    replay = buildReplayLazy(cfg, ac, queue, pseat, plane, result, framesState, framesX, frameInterval)
  }
  return { result, replay }
}

// Broken out so `replay.js` can import `engine.js` without a cycle at module
// evaluation time; the binding is filled in by `replay.js` on first import.
let buildReplayImpl = null
export function registerBuildReplay(fn) {
  buildReplayImpl = fn
}
function buildReplayLazy(...args) {
  if (buildReplayImpl === null) {
    throw new Error('replay support not loaded: import ./replay.js before requesting a replay')
  }
  return buildReplayImpl(...args)
}

/** Convenience wrapper for the common case: one run, no replay buffer. */
export function simulate(cfg, ac = null) {
  return run(cfg, ac, false).result
}
