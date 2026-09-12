/**
 * The fifteen boarding strategies, plus the universal post-processing pipeline.
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
import { AISLE_SEAT, MIDDLE, WINDOW } from './aircraft.js'
import { floorDiv, sortByKey, sortByTuple } from './pyutil.js'

/** Tiers that buy you an earlier slot within your group (never ahead of everyone). */
export const ELITE_TIERS = ['first', 'business', 'premium', 'elite_top', 'elite_mid']
const ELITE_SET = new Set(ELITE_TIERS)

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

function zoned(pax, ac, cfg, rng, rearFirst) {
  const bandList = bands(ac, cfg.zoneCount)
  const buckets = bandList.map(() => [])
  for (const p of pax) buckets[bandOf(p.rowSlot, bandList)].push(p)
  const order = []
  if (rearFirst) for (let i = bandList.length - 1; i >= 0; i--) order.push(i)
  else for (let i = 0; i < bandList.length; i++) order.push(i)
  const out = []
  for (let n = 0; n < order.length; n++) {
    const bucket = label(shuffled(rng, buckets[order[n]]), zoneLabel(n, bandList.length))
    for (const p of bucket) out.push(p)
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
  const bandList = bands(ac, cfg.zoneCount)
  const out = []
  for (let d = ac.maxDepth; d > 0; d--) {
    const atDepth = pax.filter((p) => p.depth === d)
    let n = 0
    for (let bi = bandList.length - 1; bi >= 0; bi--, n++) {
      const [lo, hi] = bandList[bi]
      const bucket = shuffled(rng, atDepth.filter((p) => lo <= p.rowSlot && p.rowSlot < hi))
      for (const p of bucket) p.groupLabel = `${depthLabel(p)} ${zoneLabel(n, bandList.length)}`
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
// deterministic ordering in the set and needs neither the config nor the RNG.
function stratSteffenPerfect(pax, ac) {
  const out = []
  let nGroups = 0
  for (let side = 0; side < ac.blockCount; side++) {
    for (const parity of [0, 1]) {
      for (let d = ac.maxDepth; d > 0; d--) {
        const bucket = pax.filter(
          (p) => p.seat.blockId === side && p.rowSlot % 2 === parity && p.depth === d,
        )
        if (!bucket.length) continue
        sortByKey(bucket, (p) => -p.rowSlot)
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
  const nRows = Math.max(1, ac.rowSlots.length - 1)
  const nDepth = Math.max(1, ac.maxDepth - 1)

  // Weight the two terms so that ONE depth step is worth exactly ONE full sweep
  // of the cabin. That is what makes the wave diagonal rather than either a row
  // sweep or plain outside-in. Equal 0.5/0.5 weights do NOT do this -- with 31
  // rows and 3 depths the row term swamps the depth term and the method
  // degenerates into back-to-front.
  const wDepth = nDepth / (nDepth + 1.0)
  const wRow = 1.0 - wDepth

  // Both terms run 0..1 with HIGHER = board earlier, so the row term is
  // distance from the FRONT: the rearmost row scores 1.
  const score = (p) => {
    const rowTerm = p.rowSlot / nRows
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
  const bandList = bands(ac, cfg.zoneCount)
  const buckets = bandList.map(() => [])
  for (const p of pax) buckets[bandOf(p.rowSlot, bandList)].push(p)
  const order = []
  let lo = 0
  let hi = bandList.length - 1
  while (lo <= hi) {
    order.push(hi)
    if (lo !== hi) order.push(lo)
    lo += 1
    hi -= 1
  }
  const out = []
  for (let n = 0; n < order.length; n++) {
    for (const p of label(shuffled(rng, buckets[order[n]]), zoneLabel(n, bandList.length))) {
      out.push(p)
    }
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
  const bandList = bands(ac, cfg.zoneCount)
  const buckets = bandList.map(() => [])
  for (const p of rest) buckets[bandOf(p.rowSlot, bandList)].push(p)
  let n = 0
  for (let bi = bandList.length - 1; bi >= 0; bi--, n++) {
    for (const p of label(shuffled(rng, buckets[bi]), `Block ${n + 1}`)) out.push(p)
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
 * actually matter: outside-in kills seat shuffles, rear-first spreads the
 * aisle. Elite status buys the front of your group rather than the front of the
 * aeroplane.
 */
function stratCommonSense5tier(pax, ac, cfg, rng) {
  const econSlots = ac.economyRowSlots
  const mid = econSlots.length ? econSlots[floorDiv(econSlots.length, 2)] : 0

  const premium = []
  const groups = [[], [], [], []] // groups 2..5
  for (const p of pax) {
    if (p.seat.classKey !== 'economy') {
      premium.push(p)
      continue
    }
    const rear = p.rowSlot >= mid
    const kind = p.seat.kind
    if (kind === WINDOW) groups[rear ? 0 : 1].push(p)
    else if (kind === MIDDLE) groups[rear ? 1 : 2].push(p)
    else groups[rear ? 2 : 3].push(p)
  }

  const names = [
    'Group 1 (premium cabin)',
    'Group 2 (rear windows)',
    'Group 3 (fwd windows + rear middles)',
    'Group 4 (fwd middles + rear aisles)',
    'Group 5 (forward aisles)',
  ]
  const out = label(elitesFirst(shuffled(rng, premium)), names[0])
  for (let i = 0; i < groups.length; i++) {
    const ordered = shuffled(rng, groups[i])
    sortByKey(ordered, (p) => -p.rowSlot) // rear to front, shuffled within a row
    for (const p of label(elitesFirst(ordered), names[i + 1])) out.push(p)
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
function stratSlowestFirst(pax, ac, cfg, rng) {
  const perBag = cfg.stowWeibullScale * 0.8929795 // mean of Weibull(1.7, 1) ~ Gamma(1+1/k)
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
 */
export function applyPostProcessing(queue, cfg, rng) {
  let out = Array.from(queue)

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
  if (cfg.keepPartiesTogether) {
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
  const jitter = cfg.complianceJitter
  if (cfg.nonComplianceRate > 0 && jitter > 0) {
    const keyed = []
    for (let i = 0; i < out.length; i++) {
      let k = 0
      if (rng.bernoulli(cfg.nonComplianceRate)) k = rng.randint(2 * jitter + 1) - jitter
      keyed.push({ a: i + k, b: i, p: out[i] })
    }
    sortByTuple(keyed, (t) => [t.a, t.b])
    out = keyed.map((t) => t.p)
  }

  // 4. Late arrivals -- the sprint from the connecting gate.
  if (cfg.lateRate > 0) {
    const late = []
    const ontime = []
    for (const p of out) (rng.bernoulli(cfg.lateRate) ? late : ontime).push(p)
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
      'WilMA without losing its zero-interference property.',
    fn: stratWilmaZoned,
  },
  steffen_perfect: {
    key: 'steffen_perfect',
    name: 'Steffen (perfect)',
    family: 'optimal',
    description:
      'Alternating rows, window to aisle, alternating sides. The theoretical optimum -- and ' +
      'unimplementable, which is exactly the point.',
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
      'Diagonal wave from rear-window to front-aisle. America West measured ~20% off full ' +
      'flights with this in revenue service.',
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
    name: 'Open seating (Southwest legacy)',
    family: 'open',
    description:
      'No assigned seats; passengers choose on entering the cabin. Fast, because people ' +
      'self-select to avoid climbing over each other.',
    fn: stratOpenSeating,
  },
  priority_5tier: {
    key: 'priority_5tier',
    name: '5-tier priority (revenue)',
    family: 'commercial',
    description:
      'Preboard, premium, elites, main, basic economy. Sells queue position and has no spatial ' +
      'logic at all.',
    fn: stratPriority5tier,
  },
  common_sense_5tier: {
    key: 'common_sense_5tier',
    name: '5-tier common sense',
    family: 'commercial',
    description:
      'Premium cabin first (commercially fixed), then outside-in crossed with rear-first across ' +
      'five printable groups. The best boarding you could actually sell.',
    fn: stratCommonSense5tier,
  },
  by_bags: {
    key: 'by_bags',
    name: 'Bag-count boarding',
    family: 'experimental',
    description:
      "Zero-bag passengers first, then one, then two. Tests the 'bags are the bottleneck' " +
      'hypothesis directly.',
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
  return applyPostProcessing(queue, cfg, rng)
}
