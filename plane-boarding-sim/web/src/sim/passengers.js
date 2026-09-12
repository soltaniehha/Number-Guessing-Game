/**
 * Passenger generation (ENGINE_SPEC 3.1, stream `pax`).
 *
 * Port of `python/plane_boarding/passengers.py`.
 *
 * The draw order in here is part of the wire contract. Every `random()` is
 * specified down to the call site, because the Python engine consumes the
 * identical stream. Adding, removing or reordering a draw is a breaking change
 * even when it does not change the distribution of anything.
 */
import { pyRoundInt, sortByKey } from './pyutil.js'

/**
 * Economy status buckets that concentrate in the FORWARD rows, and the fare
 * bucket that concentrates in the rear. Anything else in `eliteMix` (i.e.
 * `standard`) is spatially neutral and keeps its weight at every row.
 */
const STATUS_TIERS = new Set(['elite_top', 'elite_mid', 'cardholder'])
const BASIC_TIER = 'basic'

/**
 * One traveller.
 *
 * Fields are declared in the constructor rather than assigned ad hoc so the
 * shape stays monomorphic: a 777 run creates 354 of these per replication and a
 * Monte Carlo sweep creates hundreds of thousands.
 */
export class Passenger {
  constructor(id, seat, partyId, partySize) {
    this.id = id
    this.seat = seat
    this.partyId = partyId
    this.partySize = partySize
    this.bags = 0
    this.walkSpeed = 0.0
    this.stowMultiplier = 1.0
    this.isPreboard = false
    this.isSlow = false
    this.hasChild = false
    this.tier = 'standard'
    this.groupLabel = ''
    this.boardingIndex = -1
    this.doorId = ''
  }

  // Convenience accessors used all over the strategy code. Open seating nulls
  // `seat` out at the door, so these tolerate a seatless passenger.
  get depth() {
    return this.seat !== null && this.seat !== undefined ? this.seat.depth : 0
  }

  get rowSlot() {
    return this.seat !== null && this.seat !== undefined ? this.seat.rowSlot : 0
  }
}

/**
 * Draw party sizes until they cover `nPax`, truncating the last one.
 *
 * One `random()` per party. Truncating rather than rejecting keeps the draw
 * count a deterministic function of the sizes drawn, which is what the parity
 * harness needs.
 */
export function formParties(rng, cfg, nPax) {
  const sizes = []
  let total = 0
  while (total < nPax) {
    let size = rng.weightedPick(cfg.partyKeys, cfg.partyWeights)
    if (size < 1) size = 1
    if (total + size > nPax) size = nPax - total
    sizes.push(size)
    total += size
  }
  return sizes
}

/**
 * Shuffle the seat map, then hand each party a contiguous run if one exists.
 *
 * Real seat assignment is not uniform-random: a family of four ends up in four
 * seats on one side of one row. Modelling that matters, because a party that
 * sits together generates no seat interference among themselves and boards as a
 * single blob -- which is precisely what erodes a Steffen ordering.
 */
export function assignSeats(rng, ac, partySizes) {
  const pool = ac.seats.slice()
  rng.shuffle(pool)

  const taken = new Uint8Array(ac.seatCount)
  // Free seats per (rowSlot, blockId), in layout order, so "take k of them
  // left-to-right" is well defined.
  const byBlock = new Map()
  for (const s of ac.seats) {
    const key = `${s.rowSlot},${s.blockId}`
    let group = byBlock.get(key)
    if (group === undefined) {
      group = []
      byBlock.set(key, group)
    }
    group.push(s)
  }
  for (const group of byBlock.values()) sortByKey(group, (s) => s.layoutPos)

  // The two scans below both skip already-taken seats and `taken` only ever
  // goes false -> true, so a cursor past the taken prefix of `pool` is exactly
  // equivalent to rescanning from zero -- and turns the party loop from
  // quadratic into linear in the common case.
  let poolStart = 0
  const out = []
  for (const k of partySizes) {
    while (poolStart < pool.length && taken[pool[poolStart].index]) poolStart += 1
    let chosen = null
    if (k > 1) {
      for (let pi = poolStart; pi < pool.length; pi++) {
        const s = pool[pi]
        if (taken[s.index]) continue
        const block = byBlock.get(`${s.rowSlot},${s.blockId}`)
        const free = []
        for (const b of block) if (!taken[b.index]) free.push(b)
        if (free.length >= k) {
          chosen = free.slice(0, k)
          break
        }
      }
    }
    if (chosen === null) {
      chosen = []
      for (let pi = poolStart; pi < pool.length; pi++) {
        const s = pool[pi]
        if (!taken[s.index]) {
          chosen.push(s)
          if (chosen.length === k) break
        }
      }
    }
    for (const s of chosen) taken[s.index] = 1
    out.push(chosen)
  }
  return out
}

/** Build the passenger manifest. Draw order is normative -- see module docstring. */
export function generate(rng, ac, cfg) {
  const seatCount = ac.seatCount
  let nPax = pyRoundInt(cfg.loadFactor * seatCount)
  nPax = Math.max(0, Math.min(seatCount, nPax))
  if (nPax === 0) return []

  const partySizes = formParties(rng, cfg, nPax)
  const partySeats = assignSeats(rng, ac, partySizes)

  // ids follow canonical SEAT order, not party order, so the attribute draws
  // below are indexed by a stable quantity that does not depend on how the
  // parties happened to fall.
  const pairs = []
  for (let pid = 0; pid < partySeats.length; pid++) {
    const seats = partySeats[pid]
    for (const s of seats) pairs.push({ seat: s, party: pid, psize: seats.length })
  }
  sortByKey(pairs, (t) => t.seat.index)

  const pax = new Array(pairs.length)
  for (let i = 0; i < pairs.length; i++) {
    pax[i] = new Passenger(i, pairs[i].seat, pairs[i].party, pairs[i].psize)
  }

  const bagKeys = cfg.bagKeys
  const bagW = cfg.bagWeights
  for (const p of pax) {
    p.bags = rng.weightedPick(bagKeys, bagW)
    p.walkSpeed = rng.truncnormal(cfg.walkSpeedMean, cfg.walkSpeedSd, 0.2, 2.0)
    p.stowMultiplier = rng.truncnormal(1.0, cfg.stowVariability, 0.35, 3.0)
    p.isPreboard = rng.bernoulli(cfg.preboardRate)
    const slow = rng.bernoulli(cfg.slowPaxRate) // draw consumed either way
    p.isSlow = slow && !p.isPreboard
    const child = rng.bernoulli(cfg.childRate) // draw consumed either way
    p.hasChild = child && p.partySize >= 2
    if (p.isSlow) {
      p.walkSpeed *= cfg.slowSpeedFactor
      p.stowMultiplier *= cfg.slowStowFactor
    }
  }

  // Tiers. A premium cabin *is* the tier; economy passengers draw a status
  // bucket, because that is what the revenue-driven boarding groups sort on.
  //
  // The draw is FRONT-BIASED, and that matters more than it looks. Status
  // flyers are concentrated in the forward economy rows -- Comfort+, Main Cabin
  // Extra, Economy Plus -- and basic-economy fares get whatever is left, which
  // is the back. Drawing status uniformly over the cabin would hand every
  // status-ordered boarding scheme a randomly spread first wave instead of the
  // front-loaded one it really gets, which is close to the worst possible order
  // and is exactly what makes real priority boarding slow.
  // See docs/RESEARCH_AIRLINES.md 7 #6.
  //
  // Exactly ONE weightedPick per economy passenger either way, so the draw
  // count is unchanged; only the weights handed to it move.
  const eliteKeys = cfg.eliteKeys
  const eliteW = cfg.eliteWeights
  const bias = cfg.eliteForwardBias
  const nSlots = ac.rowSlots.length
  const denom = nSlots > 1 ? nSlots - 1 : 1
  for (const p of pax) {
    if (p.seat.classKey !== 'economy') {
      p.tier = p.seat.classKey
    } else if (bias <= 0.0) {
      p.tier = rng.weightedPick(eliteKeys, eliteW)
    } else {
      // +1 at the nose, -1 at the tail, 0 at mid-cabin -- so the tilt
      // redistributes status forward without changing the cabin-wide mix.
      const fwd = 1.0 - 2.0 * (p.seat.rowSlot / denom)
      let up = 1.0 + bias * fwd
      let down = 1.0 - bias * fwd
      if (up < 0.0) up = 0.0
      if (down < 0.0) down = 0.0
      const tilted = new Array(eliteKeys.length)
      for (let i = 0; i < eliteKeys.length; i++) {
        const k = eliteKeys[i]
        const w = eliteW[i]
        tilted[i] = STATUS_TIERS.has(k) ? w * up : k === BASIC_TIER ? w * down : w
      }
      p.tier = rng.weightedPick(eliteKeys, tilted)
    }
  }

  return pax
}
