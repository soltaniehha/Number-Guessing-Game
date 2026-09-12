/**
 * The sixteen boarding strategies, plus the universal post-processing pipeline.
 *
 * Port of `python/plane_boarding/strategies.py`.
 *
 * A strategy is a pure function `(passengers, aircraft, cfg, rng) -> queue`. It
 * stamps `groupLabel` on each passenger and returns them in boarding order. All
 * randomness comes from the `order` stream, so changing a strategy cannot
 * perturb the passenger manifest or the runtime service times.
 *
 * The recurring trick is *shuffle first, then stable-sort by the key you
 * actually care about*. That gives "sorted by X, random within ties" in one
 * line and, crucially, consumes exactly one shuffle's worth of draws regardless
 * of how the ties fall -- which is what keeps the two implementations in step.
 *
 * The post-processing pipeline at the bottom is where theory meets reality.
 * Party cohesion alone is the single largest reason a perfect Steffen ordering
 * does not deliver its theoretical 2x in the field.
 */
import { AISLE_SEAT, MIDDLE, SeatDoorSplit, WINDOW } from './aircraft.js'
import {
  SERVICE_PHASE_BEHAVIOUR,
  SERVICE_STREAM_BASE,
  SERVICE_STREAM_STRIDE,
} from './config.js'
import { PCG32 } from './rng.js'
import { floorDiv, pyRound, sortByKey, sortByTuple } from './pyutil.js'

/** Tiers that buy you an earlier slot within your group (never ahead of everyone). */
export const ELITE_TIERS = ['first', 'business', 'premium', 'elite_top', 'elite_mid']
const ELITE_SET = new Set(ELITE_TIERS)

/**
 * How many boarding groups a status tier is worth, for the schemes that merge
 * status INTO the group assignment rather than sorting within a group.
 *
 * This is the construction every real carrier uses, and the one Southwest
 * shipped in January 2026: group = f(where you sit, what you are worth), one
 * merged ordering. The alternative -- "elites board at the front of their
 * assigned group" -- is done by nobody, and on an outside-in scheme it is
 * actively perverse: elites disproportionately buy AISLE seats, outside-in
 * calls aisles last, so it seats a top-tier flyer behind every basic-economy
 * window passenger. See docs/RESEARCH_AIRLINES.md 7 #2.
 */
const STATUS_GROUP_SHIFT = {
  first: -3,
  business: -3,
  elite_top: -3,
  premium: -2,
  elite_mid: -2,
  cardholder: -1,
  standard: 0,
  basic: 1,
}

/**
 * Groups earlier (negative) or later (positive) this passenger's status is
 * worth. A premium cabin outranks any economy status the passenger also holds.
 */
function statusShift(p) {
  const cls = p.seat ? p.seat.classKey : 'economy'
  if (cls !== 'economy') return STATUS_GROUP_SHIFT[cls] ?? 0
  return STATUS_GROUP_SHIFT[p.tier] ?? 0
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Split the physical row slots into `zoneCount` contiguous bands, fore to aft.
 *
 * Returns half-open [lo, hi) slot ranges. Bands are cut on row *slots*, not row
 * numbers, so a cabin that skips 13 still gets even-sized zones.
 */
function bands(ac, zoneCount) {
  const n = ac.rowSlots.length
  const z = n ? Math.max(1, Math.min(zoneCount, n)) : 1
  const out = new Array(z)
  for (let b = 0; b < z; b++) out[b] = [floorDiv(n * b, z), floorDiv(n * (b + 1), z)]
  return out
}

function bandOf(slot, bandList) {
  for (let i = 0; i < bandList.length; i++) {
    const [lo, hi] = bandList[i]
    if (lo <= slot && slot < hi) return i
  }
  return bandList.length - 1
}

/**
 * Where a passenger sits, measured from the door they will actually use.
 *
 * Port of `_Spatial` in `python/plane_boarding/strategies.py`.
 *
 * Every spatially-ordered strategy in this file used to measure position as
 * `rowSlot`: bigger = further aft = board earlier. That is right for one forward
 * door and WRONG the moment a second door opens, because a cabin-wide rear-first
 * order is far-end-first at 1L and **near-end-first at 2L** -- and near-end-first
 * is the front-to-back pathology in miniature. The `doorSequencing` metric
 * (ENGINE_SPEC 7) was built to measure exactly that, and it was scoring the
 * headline strategy badly at the aft door: on the shipped two-door a320neo
 * default, `common_sense_5tier` came out SLOWER than a free-for-all while
 * beating it comfortably through one door.
 *
 * So position is measured per DOOR REGION instead. The cabin is split between
 * the boarding doors by the same rule the engine uses to assign them
 * (`aircraft.SeatDoorSplit`, ENGINE_SPEC 5 -- shared code, so the strategy's idea
 * of a region and the engine's idea of a door cannot drift). Within each region a
 * passenger's rank runs from the far end of that region toward its door, bands
 * are cut inside the region, and band k of EVERY region is called together so
 * both doors are fed at once.
 *
 * With a single boarding door -- or `doorAssignment: 'single'`, or
 * `doorAwareZones: false` -- there is one region spanning the whole cabin and
 * every method below takes the old cabin-wide code path verbatim, so single-door
 * results are bit-identical to what they were.
 */
class Spatial {
  constructor(ac, cfg) {
    this.bandList = bands(ac, cfg.zoneCount)
    this.nBands = this.bandList.length
    this.nRows = Math.max(1, ac.rowSlots.length - 1)
    const doors = ac.resolveDoors(cfg.doors)
    this.single =
      !cfg.doorAwareZones || doors.length === 1 || cfg.doorAssignment === 'single'
    if (this.single) return

    const split = new SeatDoorSplit(doors, cfg.doorAssignment)
    const doorX = new Map(doors.map((d) => [d.id, d.x]))
    const order = new Map(doors.map((d, i) => [d.id, i]))

    // Which region each ROW SLOT belongs to, decided by the seats in it: a row
    // goes to whichever door serves most of its seats, ties to the lower door
    // index, so a row is never split across two zone schemes.
    const votes = new Map()
    for (const seat of ac.seats) {
      let tally = votes.get(seat.rowSlot)
      if (tally === undefined) votes.set(seat.rowSlot, (tally = new Map()))
      const did = split.ofSeat(seat).id
      tally.set(did, (tally.get(did) || 0) + 1)
    }
    const byRegion = new Map()
    for (const [slot, tally] of votes) {
      let best = null
      for (const [did, n] of tally) {
        if (best === null || n > tally.get(best) || (n === tally.get(best) && order.get(did) < order.get(best))) {
          best = did
        }
      }
      let list = byRegion.get(best)
      if (list === undefined) byRegion.set(best, (list = []))
      list.push(slot)
    }

    // Within each region, rank the slots by distance from that region's door,
    // FARTHEST FIRST. `-x` breaks a distance tie deterministically.
    this.call = new Map()
    this.fracBySlot = new Map()
    this.rank = new Map()
    this.far = new Map()
    const econ = new Set(ac.economyRowSlots)
    for (const [did, slots] of byRegion) {
      const dx = doorX.get(did)
      sortByTuple(slots, (sl) => [-Math.abs(ac.rowSlots[sl].x - dx), -ac.rowSlots[sl].x])
      const m = slots.length
      const span = Math.max(1, m - 1)
      for (let i = 0; i < m; i++) {
        const sl = slots[i]
        this.rank.set(sl, i)
        this.call.set(sl, floorDiv(i * this.nBands, m))
        this.fracBySlot.set(sl, (m - 1 - i) / span)
      }
      // "Far half" for the five-tier scheme: the far half of the ECONOMY rows of
      // this region, mirroring the cabin-wide `rowSlot >= mid`.
      const eco = slots.filter((sl) => econ.has(sl))
      const cut = floorDiv(eco.length, 2)
      const farSet = new Set(cut ? eco.slice(0, cut) : eco)
      for (const sl of slots) this.far.set(sl, farSet.has(sl))
    }
  }

  /** Band index in CALL order under a far-end-first scheme: 0 boards first. */
  callIndex(p) {
    if (this.single) return this.nBands - 1 - bandOf(p.rowSlot, this.bandList)
    return this.call.get(p.rowSlot)
  }

  /**
   * 0 at the passenger's own door, 1 at the far end of their region. In the
   * single-region case this is `rowSlot / (nRows - 1)`, i.e. distance from the
   * nose, exactly as `reverse_pyramid` computed it before.
   */
  frac(p) {
    if (this.single) return p.rowSlot / this.nRows
    return this.fracBySlot.get(p.rowSlot)
  }

  /**
   * Sort key that puts the far end of the region first. Replaces `-p.rowSlot`,
   * and IS `-p.rowSlot` in the single-region case.
   */
  distKey(p) {
    if (this.single) return -p.rowSlot
    return this.rank.get(p.rowSlot)
  }

  /**
   * Is this passenger in the far half of their region's economy rows? `mid` is
   * the cabin-wide median slot, used in the single-region case.
   */
  isFarHalf(p, mid) {
    if (this.single) return p.rowSlot >= mid
    return this.far.get(p.rowSlot)
  }
}

function label(pax, text) {
  for (const p of pax) p.groupLabel = text
  return Array.from(pax)
}

function shuffled(rng, items) {
  const out = Array.from(items)
  rng.shuffle(out)
  return out
}

const zoneLabel = (i, total) => `Zone ${i + 1} of ${total}`

/** Stable partition: elite status buys the front of your group, nothing more. */
function elitesFirst(pax) {
  const elite = []
  const rest = []
  for (const p of pax) (ELITE_SET.has(p.tier) ? elite : rest).push(p)
  return elite.concat(rest)
}

// ---------------------------------------------------------------------------
// 1-3: the zone family
// ---------------------------------------------------------------------------

function stratRandom(pax, ac, cfg, rng) {
  return label(shuffled(rng, pax), 'Free-for-all')
}

/**
 * Contiguous bands, far end of each door's region first (or nearest first).
 *
 * Buckets are indexed by CALL position rather than by physical band, which is
 * what lets the same loop serve one door and two: with one door the call order
 * is rear-to-front, with two it is middle-outward, and `Spatial` is the only
 * thing that knows the difference.
 */
function zoned(pax, ac, cfg, rng, rearFirst) {
  const sp = new Spatial(ac, cfg)
  const n = sp.nBands
  const buckets = []
  for (let i = 0; i < n; i++) buckets.push([])
  for (const p of pax) {
    const k = sp.callIndex(p)
    buckets[rearFirst ? k : n - 1 - k].push(p)
  }
  const out = []
  for (let i = 0; i < n; i++) {
    for (const p of label(shuffled(rng, buckets[i]), zoneLabel(i, n))) out.push(p)
  }
  return out
}

const stratBackToFront = (pax, ac, cfg, rng) => zoned(pax, ac, cfg, rng, true)
const stratFrontToBack = (pax, ac, cfg, rng) => zoned(pax, ac, cfg, rng, false)

// ---------------------------------------------------------------------------
// 4-5: outside-in
// ---------------------------------------------------------------------------

const DEPTH_LABEL = { [WINDOW]: 'Window', [MIDDLE]: 'Middle', [AISLE_SEAT]: 'Aisle' }
const depthLabel = (p) => DEPTH_LABEL[p.seat.kind]

/**
 * All windows, then all middles, then all aisles.
 *
 * Boarding strictly by decreasing depth guarantees ZERO seat interference: a
 * passenger's blockers all sit at shallower depth, and everyone at shallower
 * depth is still standing at the gate.
 */
function stratWilma(pax, ac, cfg, rng) {
  const out = []
  for (let d = ac.maxDepth; d > 0; d--) {
    const bucket = shuffled(rng, pax.filter((p) => p.depth === d))
    for (const p of bucket) p.groupLabel = depthLabel(p)
    for (const p of bucket) out.push(p)
  }
  return out
}

/**
 * Outside-in, and rear-to-front within each seat-column band.
 *
 * Keeps WilMA's zero-interference property (depth is still the outer loop)
 * while spreading the aisle load, which plain WilMA does not do at all.
 */
function stratWilmaZoned(pax, ac, cfg, rng) {
  const sp = new Spatial(ac, cfg)
  const out = []
  for (let d = ac.maxDepth; d > 0; d--) {
    const atDepth = pax.filter((p) => p.depth === d)
    for (let n = 0; n < sp.nBands; n++) {
      const bucket = shuffled(rng, atDepth.filter((p) => sp.callIndex(p) === n))
      for (const p of bucket) p.groupLabel = `${depthLabel(p)} ${zoneLabel(n, sp.nBands)}`
      for (const p of bucket) out.push(p)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 6-7: Steffen
// ---------------------------------------------------------------------------

/**
 * The theoretical optimum: adjacent boarders are two rows apart.
 *
 * Iterating side -> row parity -> depth -> rear-to-front means consecutive
 * passengers in the queue are two rows apart on the same side of the aisle, so
 * a whole wave of them can stow simultaneously without anyone reaching past
 * anyone else. It also inherits WilMA's zero-interference property.
 *
 * Generalised beyond 3-3: "side" is a block (serving aisle plus which side of
 * it), so a 3-4-3 has four sides and produces 8*maxDepth waves rather than 4.
 */
// Every strategy is called as `fn(pax, ac, cfg, rng)`; this one is the sole
// deterministic ordering in the set and needs no RNG.
function stratSteffenPerfect(pax, ac, cfg) {
  const sp = new Spatial(ac, cfg)
  const out = []
  let nGroups = 0
  for (let side = 0; side < ac.blockCount; side++) {
    for (const parity of [0, 1]) {
      for (let d = ac.maxDepth; d > 0; d--) {
        const bucket = pax.filter(
          (p) => p.seat.blockId === side && p.rowSlot % 2 === parity && p.depth === d,
        )
        if (!bucket.length) continue
        // Row PARITY stays physical -- "two rows apart" is a fact about the
        // cabin, not about the door -- but the order within a wave runs from the
        // far end of each door's region toward its door.
        sortByKey(bucket, (p) => sp.distKey(p))
        nGroups += 1
        for (const p of label(bucket, `Wave ${nGroups}`)) out.push(p)
      }
    }
  }
  return out
}

/**
 * Four gate-callable groups: even/odd rows crossed with side of the aisle,
 * window-first within each. Captures most of the perfect method's benefit
 * without per-passenger sequencing, which is why it is the only Steffen variant
 * an airline could actually announce.
 */
function stratSteffenModified(pax, ac, cfg, rng) {
  const out = []
  let n = 0
  for (const parity of [0, 1]) {
    for (let side = 0; side < ac.blockCount; side++) {
      let bucket = pax.filter((p) => p.rowSlot % 2 === parity && p.seat.blockId === side)
      if (!bucket.length) continue
      bucket = shuffled(rng, bucket)
      sortByKey(bucket, (p) => -p.depth)
      n += 1
      for (const p of label(bucket, `Group ${n}`)) out.push(p)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 8-10: pyramid, rotating, blocks
// ---------------------------------------------------------------------------

/**
 * A diagonal wave from rear-window toward front-aisle.
 *
 * Blends outside-in with back-to-front in a single score, which is why it lands
 * between WilMA and Steffen in practically every study, and why America West
 * measured a ~20% saving from it in revenue service.
 */
function stratReversePyramid(pax, ac, cfg, rng) {
  const sp = new Spatial(ac, cfg)
  const nDepth = Math.max(1, ac.maxDepth - 1)

  // Weight the two terms so that ONE depth step is worth exactly ONE full sweep
  // of the cabin. That is what makes the wave diagonal rather than either a row
  // sweep or plain outside-in. Equal 0.5/0.5 weights do NOT do this -- with 31
  // rows and 3 depths the row term swamps the depth term and the method
  // degenerates into back-to-front.
  const wDepth = nDepth / (nDepth + 1.0)
  const wRow = 1.0 - wDepth

  // Both terms run 0..1 with HIGHER = board earlier. The row term is distance
  // from the passenger's own DOOR, which with one door is distance from the nose
  // and the rearmost row scoring 1, exactly as before.
  const score = (p) => {
    const rowTerm = sp.frac(p)
    const depthTerm = (p.depth - 1) / nDepth
    return wRow * rowTerm + wDepth * depthTerm
  }

  const ranked = shuffled(rng, pax)
  sortByKey(ranked, (p) => -score(p))

  // QUANTISE into (depth band x row zone) stripes. Sorting on a continuous
  // score strictly degenerates into a per-passenger sequence, and the tiny
  // residual ordering inside a stripe is worth nothing while costing all the
  // aisle spreading that randomness inside a group buys you.
  const nGroups = Math.max(2, ac.maxDepth * cfg.zoneCount)
  const total = ranked.length
  const out = []
  for (let g = 0; g < nGroups; g++) {
    const lo = floorDiv(total * g, nGroups)
    const hi = floorDiv(total * (g + 1), nGroups)
    for (const p of label(shuffled(rng, ranked.slice(lo, hi)), `Wave ${g + 1}`)) out.push(p)
  }
  return out
}

/**
 * Rearmost band, then foremost, then second-rearmost, ...
 *
 * Deliberately alternates the two ends of the aisle so the two flows interleave
 * instead of one queueing behind the other.
 */
function stratRotatingZone(pax, ac, cfg, rng) {
  const sp = new Spatial(ac, cfg)
  const n = sp.nBands
  // Indexed by CALL position, 0 = the far end of the region: the alternation is
  // then between the two ends of each door's own stretch of aisle, which is what
  // the method is for, rather than between the two ends of the cabin.
  const buckets = []
  for (let i = 0; i < n; i++) buckets.push([])
  for (const p of pax) buckets[sp.callIndex(p)].push(p)
  const order = []
  let far = 0
  let near = n - 1
  while (far <= near) {
    order.push(far)
    if (far !== near) order.push(near)
    far += 1
    near -= 1
  }
  const out = []
  for (let i = 0; i < order.length; i++) {
    for (const p of label(shuffled(rng, buckets[order[i]]), zoneLabel(i, n))) out.push(p)
  }
  return out
}

/**
 * The plain vanilla scheme most airlines ran before status tiers took over:
 * premium cabin, then contiguous rear-to-front blocks.
 */
function stratBlockBoarding(pax, ac, cfg, rng) {
  const premium = pax.filter((p) => p.seat.classKey !== 'economy')
  const rest = pax.filter((p) => p.seat.classKey === 'economy')
  const out = label(shuffled(rng, premium), 'Premium cabin')
  const sp = new Spatial(ac, cfg)
  const buckets = []
  for (let i = 0; i < sp.nBands; i++) buckets.push([])
  for (const p of rest) buckets[sp.callIndex(p)].push(p)
  for (let i = 0; i < sp.nBands; i++) {
    for (const p of label(shuffled(rng, buckets[i]), `Block ${i + 1}`)) out.push(p)
  }
  return out
}

// ---------------------------------------------------------------------------
// 11: open seating
// ---------------------------------------------------------------------------

/**
 * No assigned seats. The queue is a check-in-position proxy: shuffle, with
 * elites pulled to the front. Seats are chosen at the door -- see engine 6.5.
 */
function stratOpenSeating(pax, ac, cfg, rng) {
  const out = elitesFirst(shuffled(rng, pax))
  const total = Math.max(1, out.length)
  for (let i = 0; i < out.length; i++) {
    out[i].groupLabel = 'Group ' + 'ABC'[Math.min(2, floorDiv(i * 3, total))]
  }
  return out
}

// ---------------------------------------------------------------------------
// 12-13: the five-tier pair
// ---------------------------------------------------------------------------

/**
 * The realistic modern scheme: it sells queue position and has no spatial logic
 * whatsoever. Included precisely so it can be measured against the next one,
 * which keeps the commercial constraints and adds flow logic.
 */
function stratPriority5tier(pax, ac, cfg, rng) {
  const tierOf = (p) => {
    if (p.seat.classKey === 'first' || p.seat.classKey === 'business') return 0
    if (p.tier === 'elite_top') return 0
    if (p.tier === 'elite_mid' || p.seat.classKey === 'premium' || p.tier === 'cardholder') return 1
    if (p.tier === 'basic') return 4
    return 2 // 'standard' -- split into two called groups below
  }

  const buckets = [[], [], [], [], []]
  for (const p of pax) buckets[tierOf(p)].push(p)

  // The bulk of the cabin is called as two groups, not one; airlines split it
  // by check-in time, which is uncorrelated with anything spatial.
  const standard = shuffled(rng, buckets[2])
  const half = floorDiv(standard.length, 2)
  buckets[2] = standard.slice(0, half)
  buckets[3] = standard.slice(half)

  const names = [
    'Tier 1 (premium + top elite)',
    'Tier 2 (elite / cardholder)',
    'Tier 3 (main cabin)',
    'Tier 4 (main cabin)',
    'Tier 5 (basic economy)',
  ]
  const out = []
  for (let i = 0; i < buckets.length; i++) {
    const group = i === 2 || i === 3 ? buckets[i] : shuffled(rng, buckets[i])
    for (const p of label(group, names[i])) out.push(p)
  }
  return out
}

/**
 * The headline "what a sensible airline could actually sell" strategy.
 *
 * Keeps the commercially non-negotiable parts -- premium cabin first, preboards
 * first -- and applies real flow logic to the ~85% of the aircraft that is
 * economy, using five gate-announceable groups. It is a coarse reverse pyramid
 * quantised to what a boarding pass can print, preserving the two effects that
 * actually matter: outside-in kills seat shuffles, rear-first spreads the aisle.
 *
 * **Status is an input to the group assignment, not a sort within it.** The seat
 * location proposes a group; the passenger's status ladder then moves them
 * earlier or later by a whole group or three, and the result is ONE merged
 * ordering. That is the construction Southwest shipped in 2026 and the only one
 * a revenue department will sign: a status flyer in an aisle seat lands in an
 * early group, a basic-economy flyer in an aisle seat lands in the last one. The
 * previous rule -- elites at the front of their assigned group -- looked like a
 * compromise and was in fact the worst of both worlds, since outside-in calls
 * aisles last and elites are disproportionately in aisles.
 * See docs/RESEARCH_AIRLINES.md 7 #2.
 *
 * Party cohesion is MANDATORY here rather than optional (registry flag
 * `requiresCohesion`). Every deployed carrier that boards by seat location
 * promotes the whole booking to its earliest-boarding member -- United's "same
 * and highest applicable", Lufthansa's "and companions" -- so a run of this
 * strategy with cohesion off is not a model of anything real.
 */
function stratCommonSense5tier(pax, ac, cfg, rng) {
  const sp = new Spatial(ac, cfg)
  const econSlots = ac.economyRowSlots
  const mid = econSlots.length ? econSlots[floorDiv(econSlots.length, 2)] : 0

  const names = [
    'Group 1 (premium + top status)',
    'Group 2 (rear windows)',
    'Group 3 (fwd windows + rear middles)',
    'Group 4 (fwd middles + rear aisles)',
    'Group 5 (forward aisles + basic economy)',
  ]
  const nGroups = names.length

  // Where seat location alone would put you: 0 = premium cabin, then the
  // outside-in x rear-first ladder across groups 1..4.
  const baseGroup = (p) => {
    if (p.seat.classKey !== 'economy') return 0
    // "Rear" means the far half of the passenger's own door region. With one
    // door that is the rear half of the cabin, unchanged; with two it is the
    // half of that door's stretch furthest from it, which is the whole point --
    // a cabin-wide "rear first" is near-door-first at the aft door.
    const rear = sp.isFarHalf(p, mid)
    const kind = p.seat.kind
    if (kind === WINDOW) return rear ? 1 : 2
    if (kind === MIDDLE) return rear ? 2 : 3
    return rear ? 3 : 4
  }

  const buckets = names.map(() => [])
  for (const p of pax) {
    let g = baseGroup(p) + statusShift(p)
    if (g < 0) g = 0
    else if (g >= nGroups) g = nGroups - 1
    buckets[g].push(p)
  }

  const out = []
  for (let i = 0; i < buckets.length; i++) {
    const ordered = shuffled(rng, buckets[i])
    // Premium cabin ahead of everyone inside its group, then rear to front,
    // shuffled within a row. The premium tie-break only bites in Group 1, where
    // the status shift also lands top-tier economy passengers: the premium
    // cabin boarding first is the commercially non-negotiable part this whole
    // strategy is built around conceding, and rear-first sorting alone would put
    // it behind the rear-seated elites it shares a group with.
    sortByTuple(ordered, (p) => [p.seat.classKey === 'economy' ? 1 : 0, sp.distKey(p)])
    for (const p of label(ordered, names[i])) out.push(p)
  }
  return out
}

/**
 * Southwest's post-open-seating scheme, live since 27 January 2026.
 *
 * The single most useful strategy in this file for the headline comparison,
 * because it is a real converged design rather than a strawman: an airline that
 * abandoned 53 years of open seating and, given a blank sheet, chose **WilMA x
 * back-to-front merged with fare and status into eight groups**.
 *
 * Construction (docs/RESEARCH_AIRLINES.md 1.4):
 *
 *   * seat location gives a base rank -- window before middle before aisle as
 *     the outer loop, rear before front within each -- so it is `wilma_zoned`
 *     by another name;
 *   * that rank is projected onto EIGHT groups, which is the number Southwest
 *     actually prints;
 *   * fare and status then shift you whole groups earlier (A-List Preferred,
 *     Choice Extra, cardholders) or later (Basic), producing one merged
 *     ordering rather than a status sort inside a location group.
 *
 * Eight groups rather than five is not cosmetic: finer quantisation preserves
 * more of the underlying spatial order, and it is the difference between a
 * scheme that announces its flow logic and one that only gestures at it.
 */
function stratSouthwest2026(pax, ac, cfg, rng) {
  const sp = new Spatial(ac, cfg)
  const nBands = sp.nBands
  const maxDepth = Math.max(1, ac.maxDepth)
  const nCells = maxDepth * nBands
  const nGroups = 8

  // Deepest seat (window) first, then rearmost band first: identical to the
  // emission order of `wilma_zoned`.
  const locationRank = (p) => {
    const depthRank = maxDepth - Math.max(1, Math.min(maxDepth, p.depth))
    const bandRank = sp.callIndex(p)
    return depthRank * nBands + bandRank
  }

  const buckets = []
  for (let i = 0; i < nGroups; i++) buckets.push([])
  for (const p of pax) {
    let g = floorDiv(locationRank(p) * nGroups, nCells)
    g += statusShift(p)
    if (g < 0) g = 0
    else if (g >= nGroups) g = nGroups - 1
    buckets[g].push(p)
  }

  const out = []
  for (let i = 0; i < nGroups; i++) {
    const ordered = shuffled(rng, buckets[i])
    // WilMA still runs INSIDE each group, which is what Southwest's own
    // material describes ("Group 1 ... reportedly the window subset first"). It
    // matters most for the passengers a status shift dropped into a group their
    // seat would not have earned: without this an A-List aisle seat called in
    // Group 2 would board ahead of the Group 2 windows and undo the
    // zero-interference property the scheme is built on.
    sortByTuple(ordered, (p) => [-p.depth, sp.distKey(p)])
    for (const p of label(ordered, `Group ${i + 1} of ${nGroups}`)) out.push(p)
  }
  return out
}

// ---------------------------------------------------------------------------
// 14-15: service-time based
// ---------------------------------------------------------------------------

/**
 * Zero-bag first, then one, then two. Tests the "bags are the bottleneck"
 * hypothesis directly -- and note the literature actually finds the reverse
 * (most-bin-luggage-first) shortens boarding, so this one is a foil.
 */
function stratByBags(pax, ac, cfg, rng) {
  const distinct = new Set()
  for (const p of pax) distinct.add(p.bags)
  const out = []
  for (const b of [...distinct].sort((x, y) => x - y)) {
    const bucket = shuffled(rng, pax.filter((p) => p.bags === b))
    for (const p of label(bucket, `${b} bag${b === 1 ? '' : 's'}`)) out.push(p)
  }
  return out
}

/**
 * Sorted by expected service time, slowest first: get the long stows started
 * early and let fast passengers fill in behind. Erland/Steffen find this beats
 * random mainly by cutting variance rather than the mean.
 */
/**
 * Lanczos g=7, n=9 coefficients. The same series `web/src/lib/simParams.js` uses
 * to turn a Weibull scale into a mean for the control panel's readouts.
 */
const LANCZOS_G = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
]

/**
 * log-gamma by the Lanczos series, spelled out rather than calling a library.
 *
 * Written out because Python's `math.lgamma` has no JavaScript counterpart and
 * the two engines must run the SAME arithmetic, not two library implementations
 * that happen to agree.
 */
function lgamma(z) {
  const x = z - 1.0
  let a = 0.99999999999980993
  const t = x + 7.5
  for (let k = 0; k < 8; k++) a += LANCZOS_G[k] / (x + k + 1.0)
  return 0.5 * Math.log(2.0 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}

/**
 * Mean of Weibull(shape, 1) = Gamma(1 + 1/shape), rounded to 6 dp.
 *
 * `stowWeibullShape` is a live slider (1.0 to 3.5), so this cannot be a constant
 * -- and it used to be one, hard-coded as 0.8929795 with the comment "mean of
 * Weibull(1.7, 1)". That number was also simply **wrong**: the true value at the
 * shipped shape of 1.7 is 0.892245, so the estimator was off by 8e-4 in a way
 * nothing would ever have flagged.
 *
 * **The rounding is the parity contract, not sloppiness.** `Math.log`/`Math.exp`
 * and Python's `math.log`/`exp` are not required to agree to the last bit, and
 * measured over the 51 reachable slider positions they disagree at two of them
 * -- by up to 8 ulps at shape 1.05. Rounding to 6 dp erases that difference:
 * verified identical across all 2501 shapes from 1.000 to 3.500 in steps of
 * 0.001, in both languages. Six decimal places is also several orders of
 * magnitude more precision than a ranking heuristic can use.
 */
export function weibullMeanFactor(shape) {
  return pyRound(Math.exp(lgamma(1.0 + 1.0 / shape)), 6)
}

function stratSlowestFirst(pax, ac, cfg, rng) {
  // Gamma(1 + 1/shape) computed from the CONFIGURED shape. This used to be the
  // constant 0.8929795, which stopped meaning anything the moment anybody
  // touched the `stowWeibullShape` slider -- and was wrong for 1.7 anyway.
  const perBag = cfg.stowWeibullScale * weibullMeanFactor(cfg.stowWeibullShape)
  const perMove = (cfg.shuffleMoveMin + cfg.shuffleMoveMode + cfg.shuffleMoveMax) / 3.0
  const moves = cfg.shuffleMovements

  const est = (p) => {
    const shuffleMoves = p.depth <= 1 ? moves.none : moves.aisle
    const service = (p.bags * perBag + shuffleMoves * perMove) * p.stowMultiplier
    return service + (ac.length / Math.max(0.2, p.walkSpeed)) * 0.25
  }

  const out = shuffled(rng, pax)
  sortByKey(out, (p) => -est(p))
  const total = Math.max(1, out.length)
  for (let i = 0; i < out.length; i++) {
    out[i].groupLabel = `Band ${Math.min(5, 1 + floorDiv(i * 5, total))}`
  }
  return out
}

// ---------------------------------------------------------------------------
// Universal post-processing (ENGINE_SPEC 4)
// ---------------------------------------------------------------------------

/**
 * Preboards -> party cohesion -> non-compliance -> late arrivals.
 *
 * Order matters and is normative. Together these four steps are what separates
 * a paper result from a gate result: they are the frictions that shrink
 * Steffen's theoretical 2x to the ~20-25% airlines actually measure.
 *
 * Takes no RNG. It used to take the `order` stream for the non-compliance and
 * lateness draws; those are per-passenger behaviours now and come from the
 * passenger's own sub-stream, so the `order` stream is consumed only by the
 * strategy function itself.
 */
export function requiresCohesion(strategy) {
  const entry = STRATEGIES[strategy]
  return Boolean(entry && entry.requiresCohesion)
}

export function applyPostProcessing(queue, cfg) {
  let out = Array.from(queue)
  // For most strategies `keepPartiesTogether` is a friction knob. For a
  // strategy whose group assignment is a joint function of seat location and
  // fare -- common_sense_5tier, southwest_2026 -- cohesion is part of the
  // construction, because every carrier that boards that way promotes the whole
  // booking to its earliest-boarding member. Those strategies force it on.
  const cohere = cfg.keepPartiesTogether || requiresCohesion(cfg.strategy)

  // Steps 3 and 4 draw a per-PASSENGER behaviour -- "does this person ignore
  // their group" and "does this person turn up late" -- and both used to come
  // off the shared `order` stream in queue order, which made them depend on the
  // very ordering they are supposed to perturb. Drawn from the passenger's own
  // sub-stream instead, the same traveller misbehaves in the same way under
  // every strategy, which is what a paired comparison needs. The draw sequence
  // within the stream is fixed -- compliance bernoulli, then the jitter randint
  // if and only if that bernoulli came up, then the lateness bernoulli -- and
  // its length therefore depends only on values that are themselves invariant.
  // See ENGINE_SPEC 1.3.
  const behaviourRng = (p) =>
    new PCG32(cfg.seed, SERVICE_STREAM_BASE + p.id * SERVICE_STREAM_STRIDE + SERVICE_PHASE_BEHAVIOUR)

  // 1. Preboards. Stable, so the strategy's ordering survives among them.
  if (cfg.preboardFirst) {
    const pre = out.filter((p) => p.isPreboard)
    if (pre.length) {
      for (const p of pre) p.groupLabel = 'Preboard'
      out = pre.concat(out.filter((p) => !p.isPreboard))
    }
  }

  // 2. Party cohesion. A party boards at its earliest member's slot, window
  //    first -- families self-organise so the window passenger goes in first.
  //    This deliberately runs AFTER preboarding, so a party containing a
  //    wheelchair passenger boards with them, which is what actually happens.
  //    Cohesion is PROMOTE-TO-EARLIEST: the party is emitted whole at the
  //    queue position of whichever member the strategy called first, never at a
  //    mean or a latest position. That is what every carrier with a published
  //    companion rule does (United "same and highest applicable", Lufthansa
  //    "and companions").
  if (cohere) {
    const members = new Map()
    for (const p of out) {
      let group = members.get(p.partyId)
      if (group === undefined) {
        group = []
        members.set(p.partyId, group)
      }
      group.push(p)
    }
    for (const group of members.values()) {
      sortByKey(group, (p) => -p.depth) // stable: ties keep queue order
    }
    const emitted = new Set()
    const cohered = []
    for (const p of out) {
      if (emitted.has(p.partyId)) continue
      emitted.add(p.partyId)
      for (const m of members.get(p.partyId)) cohered.push(m)
    }
    out = cohered
  }

  // 3. Non-compliance. 15% of passengers ignore the group they were called in.
  //
  // ENGINE_SPEC 1.3 pins the behaviour stream as Bernoulli(nonComplianceRate),
  // then -- ONLY IF THAT CAME UP -- randint(2*jitter+1), then
  // Bernoulli(lateRate). Both conditions in that sentence are on the Bernoulli,
  // not on `complianceJitter`, and that is the whole point: the draw sequence
  // must not be a function of the jitter WIDTH, or else who arrives late changes
  // when you move a slider that has nothing to do with lateness.
  //
  // This used to gate the entire step on `rate > 0 && jitter > 0`, so at jitter 0
  // the compliance Bernoulli was never drawn and the late Bernoulli became the
  // first draw instead of the second. Parity was never at risk (both engines did
  // the same wrong thing); the CRN property this phase separation exists to
  // provide was.
  //
  // `randint(1)` at jitter 0 consumes exactly one draw and returns 0, so drawing
  // it unconditionally costs nothing and moves nobody -- which is why the
  // sequence stays fixed while the behaviour stays correct.
  const jitter = cfg.complianceJitter
  const doJitter = cfg.nonComplianceRate > 0
  const doLate = cfg.lateRate > 0
  const behaviour = new Map()
  if (doJitter || doLate) {
    for (const p of out) behaviour.set(p.id, behaviourRng(p))
  }

  if (doJitter) {
    const keyed = []
    for (let i = 0; i < out.length; i++) {
      let k = 0
      const r = behaviour.get(out[i].id)
      if (r.bernoulli(cfg.nonComplianceRate)) k = r.randint(2 * jitter + 1) - jitter
      keyed.push({ a: i + k, b: i, p: out[i] })
    }
    sortByTuple(keyed, (t) => [t.a, t.b])
    out = keyed.map((t) => t.p)
  }

  // 4. Late arrivals -- the sprint from the connecting gate.
  if (doLate) {
    const late = []
    const ontime = []
    for (const p of out) (behaviour.get(p.id).bernoulli(cfg.lateRate) ? late : ontime).push(p)
    out = ontime.concat(late)
  }

  for (let i = 0; i < out.length; i++) out[i].boardingIndex = i
  return out
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Registry, in the canonical order of `docs/STRATEGIES.md`.
 *
 * `family` is not in the Python registry -- it exists only to group the picker
 * in `src/app/controls/StrategyPicker.jsx`, and the labels there are the
 * authority for its allowed values.
 */
export const STRATEGIES = {
  random: {
    key: 'random',
    name: 'Random / free-for-all',
    family: 'baseline',
    description:
      'Full shuffle. The literature’s inconvenient baseline: it beats most zone schemes ' +
      'because it spreads passengers along the aisle for free.',
    fn: stratRandom,
  },
  back_to_front: {
    key: 'back_to_front',
    name: 'Back-to-front zones',
    family: 'zone',
    description:
      'Contiguous row blocks, rear block first. Intuitive, and reliably among the worst: it ' +
      'concentrates everyone into one short stretch of aisle.',
    fn: stratBackToFront,
  },
  front_to_back: {
    key: 'front_to_back',
    name: 'Front-to-back zones',
    family: 'zone',
    description:
      'The pathological control. Every later passenger must walk past every earlier one.',
    fn: stratFrontToBack,
  },
  wilma: {
    key: 'wilma',
    name: 'WilMA (outside-in)',
    family: 'outside-in',
    description:
      'All windows, then middles, then aisles. Eliminates seat interference by construction. ' +
      'United’s current scheme.',
    fn: stratWilma,
  },
  wilma_zoned: {
    key: 'wilma_zoned',
    name: 'WilMA x zones (outside-in, back-to-front)',
    family: 'outside-in',
    description:
      'Outside-in, and rear-to-front within each seat-column band. Adds aisle spreading to ' +
      'WilMA without losing its zero-interference property. This is a live scheme, not a ' +
      'proposal: it is the structure Southwest went to on 27 January 2026 -- see ' +
      'southwest_2026 for the version with the fare and status ladder merged in.',
    fn: stratWilmaZoned,
  },
  steffen_perfect: {
    key: 'steffen_perfect',
    name: 'Steffen (perfect)',
    family: 'optimal',
    description:
      'Alternating rows, window to aisle, alternating sides. The theoretical optimum, and ' +
      'unimplementable -- but not mainly for the reason usually given. Ahead of passenger ' +
      'compliance come mandatory party cohesion, alliance and status contractual obligations, ' +
      'and the plain absence of any gate infrastructure for sequencing individual passengers. ' +
      'Compliance is the reason this model can measure, not the binding one.',
    fn: stratSteffenPerfect,
  },
  steffen_modified: {
    key: 'steffen_modified',
    name: 'Steffen (modified / practical)',
    family: 'optimal',
    description:
      'Four gate-callable groups: even/odd rows by side, window first. Most of the benefit, ' +
      'announceable at a gate.',
    fn: stratSteffenModified,
  },
  reverse_pyramid: {
    key: 'reverse_pyramid',
    name: 'Reverse pyramid',
    family: 'hybrid',
    description:
      'Diagonal wave from rear-window to front-aisle, and the best-evidenced flow method ever ' +
      'flown: America West measured -2 minutes (~20%) on full flights and -21% departure ' +
      'delays over the first three months (van den Briel et al., Interfaces 35(3):191-201, ' +
      '2005). It disappeared through two merger integrations and no source gives a performance ' +
      'reason. JAL\u2019s 2024 window-and-rear scheme is a coarse two-group descendant.',
    fn: stratReversePyramid,
  },
  rotating_zone: {
    key: 'rotating_zone',
    name: 'Rotating zone',
    family: 'zone',
    description:
      'Alternates rear zone and front zone so the two flows interleave rather than queue ' +
      'behind one another.',
    fn: stratRotatingZone,
  },
  block_boarding: {
    key: 'block_boarding',
    name: 'Block boarding (classic zones)',
    family: 'zone',
    description:
      'Premium cabin, then rear-to-front blocks. The pre-status-tier standard, and the slowest ' +
      'method in the Steffen-Hotchkiss experiment.',
    fn: stratBlockBoarding,
  },
  open_seating: {
    key: 'open_seating',
    name: 'Open seating (Southwest, 1971-2026)',
    family: 'open',
    description:
      'RETIRED. No assigned seats; passengers choose on entering the cabin. Fast, because ' +
      'people self-select to avoid climbing over each other. Southwest ran it for 53 years and ' +
      'ended it on 27 January 2026; no airline of consequence now uses it, so this is a ' +
      'historical baseline rather than a live option.',
    fn: stratOpenSeating,
  },
  priority_5tier: {
    key: 'priority_5tier',
    name: '5-tier priority (revenue)',
    family: 'commercial',
    description:
      'Preboard, premium, elites, main, basic economy: the revenue-only case, representing ' +
      'Delta, American and Air France. It has no DELIBERATE spatial logic, but it is not ' +
      'spatially neutral -- status and premium cabins sit forward, so selling queue position ' +
      'quietly buys front-to-back boarding. Compare against the revenue-then-flow carriers ' +
      '(United, Lufthansa, ANA, JAL, BA, Southwest) modelled by wilma and southwest_2026. Tier ' +
      'placement is carrier-dependent at the top: this models the generic US-legacy case with ' +
      'First and Business in Tier 1, where American has preboarded them since 1 May 2025.',
    fn: stratPriority5tier,
  },
  common_sense_5tier: {
    key: 'common_sense_5tier',
    name: '5-tier common sense',
    family: 'commercial',
    description:
      'Outside-in crossed with rear-first across five printable groups, with fare and status ' +
      'merged INTO the group assignment rather than sorted within it, so a status flyer in an ' +
      'aisle seat still boards early. The best boarding you could actually sell. Party cohesion ' +
      'is mandatory, as it is for every carrier that boards by seat location.',
    requiresCohesion: true,
    fn: stratCommonSense5tier,
  },
  southwest_2026: {
    key: 'southwest_2026',
    name: 'Southwest 2026 (WilMA x zones + status, 8 groups)',
    family: 'commercial',
    description:
      'The real converged design: Southwest replaced 53 years of open seating on 27 January ' +
      '2026 with window/middle/aisle boarded rear-to-front, merged with fare and Rapid Rewards ' +
      'status into eight numbered groups. Live on roughly 4,000 daily flights, which makes this ' +
      'the benchmark any proposal in this list has to beat.',
    requiresCohesion: true,
    fn: stratSouthwest2026,
  },
  by_bags: {
    key: 'by_bags',
    name: 'Bag-count boarding',
    family: 'experimental',
    description:
      "Zero-bag passengers first, then one, then two. Tests the 'bags are the bottleneck' " +
      'hypothesis directly -- and the field evidence says bags win: Spirit reportedly cut ' +
      'boarding by ~6 minutes by charging for carry-ons, roughly three times the best claimed ' +
      'ordering benefit, from a pricing change with no gate process change at all. Boarding has ' +
      'slowed from ~15 minutes in the 1970s to 30-40 for ~140 passengers today. Note the ' +
      'literature finds the REVERSE order (most luggage first) is what shortens boarding, so ' +
      'this particular sort is a foil.',
    fn: stratByBags,
  },
  slowest_first: {
    key: 'slowest_first',
    name: 'Slowest first',
    family: 'experimental',
    description:
      'Sorted by expected service time, descending. Gets the long stows started early; mainly ' +
      'reduces variance rather than the mean.',
    fn: stratSlowestFirst,
  },
}

/** Run the named strategy, then the universal pipeline. */
export function buildOrder(pax, ac, cfg, rng) {
  const entry = STRATEGIES[cfg.strategy]
  if (entry === undefined) {
    throw new Error(
      `unknown strategy '${cfg.strategy}'; known: ${JSON.stringify(Object.keys(STRATEGIES).sort())}`,
    )
  }
  const queue = entry.fn(Array.from(pax), ac, cfg, rng)
  if (queue.length !== pax.length) {
    throw new Error(
      `strategy '${cfg.strategy}' returned ${queue.length} of ${pax.length} passengers`,
    )
  }
  return applyPostProcessing(queue, cfg)
}
