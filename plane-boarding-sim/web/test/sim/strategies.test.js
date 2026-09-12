/**
 * Each of the sixteen strategies, plus the universal post-processing pipeline.
 * Mirrors `python/tests/test_strategies.py`.
 */
import { describe, expect, it } from 'vitest'
import { ConfigError } from '../../src/sim/config.js'
import { simulate } from '../../src/sim/engine.js'
import { generate } from '../../src/sim/passengers.js'
import { PCG32 } from '../../src/sim/rng.js'
import { STRATEGIES, weibullMeanFactor } from '../../src/sim/strategies.js'
import { runBatch } from '../../src/sim/batch.js'
import { cfgFor, cleanCfg, makeQueue } from './helpers.js'

const ALL = Object.keys(STRATEGIES).sort()
const sum = (xs) => xs.reduce((a, b) => a + b, 0)
const meanOf = (xs) => sum(xs) / xs.length

it('has the sixteen documented strategies, each with printable metadata', () => {
  expect(ALL).toHaveLength(16)
  expect(ALL).toContain('southwest_2026')
  for (const key of ALL) {
    const entry = STRATEGIES[key]
    expect(entry.name).toBeTruthy()
    expect(entry.description).toBeTruthy()
    expect(entry.family).toBeTruthy()
    expect(typeof entry.fn).toBe('function')
  }
})

describe.each(['a320neo', 'b777_300er', 'e175'])('%s', (aid) => {
  describe.each(ALL)('%s', (strategy) => {
    it('returns a permutation of the manifest', () => {
      // No duplicates, no drops -- the queue must be the same set of people.
      const cfg = cfgFor(aid, strategy, 17, { loadFactor: 0.85 })
      const { ac, queue } = makeQueue(cfg)
      const pax = generate(new PCG32(cfg.seed, 1), ac, cfg)
      expect(queue.map((p) => p.id).sort((a, b) => a - b)).toEqual(
        pax.map((p) => p.id).sort((a, b) => a - b),
      )
      expect(new Set(queue).size).toBe(queue.length)
      expect(queue.map((p) => p.boardingIndex)).toEqual([...Array(queue.length).keys()])
      expect(queue.every((p) => p.groupLabel)).toBe(true)
    })
  })
})

it('wilma puts all windows before all middles before all aisles', () => {
  const { queue } = makeQueue(cleanCfg('a320neo', 'wilma', 3))
  const depths = queue.map((p) => p.depth)
  expect(depths).toEqual([...depths].sort((a, b) => b - a))
})

it('steffen_perfect alternates rows within each wave', () => {
  // Consecutive boarders in a wave must be two row slots apart -- that is the
  // entire mechanism, and it is what lets a whole wave stow simultaneously.
  const { queue } = makeQueue(cleanCfg('a320neo', 'steffen_perfect', 3))
  const waves = new Map()
  for (const p of queue) {
    let list = waves.get(p.groupLabel)
    if (list === undefined) waves.set(p.groupLabel, (list = []))
    list.push(p)
  }
  let checked = 0
  for (const members of waves.values()) {
    if (members.length < 3) continue
    checked += 1
    const slots = members.map((p) => p.rowSlot)
    expect(slots).toEqual([...slots].sort((a, b) => b - a))
    for (let i = 1; i < slots.length; i++) {
      const gap = slots[i - 1] - slots[i]
      expect(gap).toBeGreaterThanOrEqual(2)
      expect(gap % 2).toBe(0)
    }
    expect(new Set(members.map((p) => p.seat.blockId)).size).toBe(1)
    expect(new Set(members.map((p) => p.depth)).size).toBe(1)
  }
  expect(checked).toBeGreaterThanOrEqual(8)
})

it('back_to_front really is rear first', () => {
  const { queue } = makeQueue(cleanCfg('a320neo', 'back_to_front', 3))
  const first = queue.slice(0, 20).map((p) => p.rowSlot)
  const last = queue.slice(-20).map((p) => p.rowSlot)
  expect(Math.min(...first)).toBeGreaterThan(Math.max(...last))
})

it('front_to_back really is front first', () => {
  const { queue } = makeQueue(cleanCfg('a320neo', 'front_to_back', 3))
  const first = queue.slice(0, 20).map((p) => p.rowSlot)
  const last = queue.slice(-20).map((p) => p.rowSlot)
  expect(Math.max(...first)).toBeLessThan(Math.min(...last))
})

it('by_bags boards light travellers first', () => {
  const { queue } = makeQueue(cleanCfg('a320neo', 'by_bags', 3))
  const bags = queue.map((p) => p.bags)
  expect(bags).toEqual([...bags].sort((a, b) => a - b))
})

it('reverse_pyramid is a diagonal, not a row sweep', () => {
  const { ac, queue } = makeQueue(cleanCfg('a320neo', 'reverse_pyramid', 3))
  const cfg = cleanCfg('a320neo', 'reverse_pyramid', 3)
  const n = queue.length
  const k = Math.max(4, Math.floor(n / 10))
  const head = queue.slice(0, k)
  const tail = queue.slice(-k)
  expect(meanOf(head.map((p) => p.depth))).toBeGreaterThan(meanOf(tail.map((p) => p.depth)))
  expect(meanOf(head.map((p) => p.rowSlot))).toBeGreaterThan(meanOf(tail.map((p) => p.rowSlot)))
  // The defining property of a diagonal, as against strict outside-in: the
  // depth bands OVERLAP in queue position.
  const at = (d) => queue.filter((p) => p.depth === d).map((p) => p.boardingIndex)
  expect(Math.max(...at(3))).toBeGreaterThan(Math.min(...at(2)))
  expect(Math.max(...at(2))).toBeGreaterThan(Math.min(...at(1)))
  const labels = new Set(queue.map((p) => p.groupLabel))
  expect(labels.size).toBeGreaterThanOrEqual(2)
  expect(labels.size).toBeLessThanOrEqual(ac.maxDepth * cfg.zoneCount)
})

it('rotating_zone alternates the two ends of the cabin', () => {
  const { queue } = makeQueue(cleanCfg('a320neo', 'rotating_zone', 3, { zoneCount: 4 }))
  const seen = []
  for (const p of queue) if (!seen.length || seen[seen.length - 1] !== p.groupLabel) seen.push(p.groupLabel)
  const means = seen.map((label) =>
    meanOf(queue.filter((p) => p.groupLabel === label).map((p) => p.rowSlot)),
  )
  expect(means[0]).toBeGreaterThan(means[1])
  expect(means[1]).toBeLessThan(means[2])
})

it('common_sense_5tier uses exactly five groups and boards premium first', () => {
  const { queue } = makeQueue(cleanCfg('b777_300er', 'common_sense_5tier', 3))
  const labels = []
  for (const p of queue) if (!labels.includes(p.groupLabel)) labels.push(p.groupLabel)
  expect(labels).toHaveLength(5)
  expect(labels[0]).toContain('premium')
  const premium = queue.filter((p) => p.seat.classKey !== 'economy')
  expect(premium.every((p) => p.boardingIndex < premium.length)).toBe(true)
})

// The §7 #2 correction, as a property. The old rule put elites at the front of
// the group their SEAT earned, which on an outside-in scheme is perverse: aisles
// are called last and elites disproportionately sit in aisles, so a top-tier
// flyer boarded behind every basic-economy window passenger. Status is now an
// input to the group itself.
it('common_sense_5tier merges status into the group rather than sorting inside it', () => {
  const { queue } = makeQueue(cleanCfg('a320neo', 'common_sense_5tier', 11, { loadFactor: 1.0 }))
  const aisles = queue.filter((p) => p.seat.kind === 'Aisle')
  const top = aisles.filter((p) => p.tier === 'elite_top').map((p) => p.boardingIndex)
  const basic = aisles.filter((p) => p.tier === 'basic').map((p) => p.boardingIndex)
  expect(top.length).toBeGreaterThan(0)
  expect(basic.length).toBeGreaterThan(0)
  expect(meanOf(top)).toBeLessThan(meanOf(basic))

  // And the whole point: an elite in an AISLE seat is no longer stuck behind the
  // entire basic-economy WINDOW population.
  const basicWindows = queue
    .filter((p) => p.seat.kind === 'Window' && p.tier === 'basic')
    .map((p) => p.boardingIndex)
  expect(basicWindows.length).toBeGreaterThan(0)
  expect(meanOf(top)).toBeLessThan(Math.max(...basicWindows))
})

// Eight groups, seat location as the base rank, status shifting whole groups.
// Checked as structure: eight is what Southwest prints, and window-before-aisle
// is what they announced.
it('southwest_2026 is wilma_zoned with a status ladder merged in', () => {
  const { queue } = makeQueue(cleanCfg('a320neo', 'southwest_2026', 4, { loadFactor: 1.0 }))
  const labels = []
  for (const p of queue) if (!labels.includes(p.groupLabel)) labels.push(p.groupLabel)
  expect(labels).toHaveLength(8)

  const meanSlot = (kind) =>
    meanOf(queue.filter((p) => p.seat.kind === kind).map((p) => p.boardingIndex))
  expect(meanSlot('Window')).toBeLessThan(meanSlot('Middle'))
  expect(meanSlot('Middle')).toBeLessThan(meanSlot('Aisle'))

  const elite = queue.filter((p) => p.tier === 'elite_top').map((p) => p.boardingIndex)
  const basic = queue.filter((p) => p.tier === 'basic').map((p) => p.boardingIndex)
  expect(elite.length).toBeGreaterThan(0)
  expect(basic.length).toBeGreaterThan(0)
  expect(meanOf(elite)).toBeLessThan(meanOf(basic))
})

// Every carrier that boards by seat location promotes the whole booking to its
// earliest-boarding member -- United's "same and highest applicable",
// Lufthansa's "and companions". A run with `keepPartiesTogether` off is not a
// model of anything anyone operates, so these strategies force it on.
describe.each(['common_sense_5tier', 'southwest_2026'])('%s', (strategy) => {
  it('makes party cohesion mandatory', () => {
    const { queue } = makeQueue(
      cfgFor('a320neo', strategy, 8, {
        keepPartiesTogether: false,
        nonComplianceRate: 0.0,
        lateRate: 0.0,
      }),
    )
    const seen = new Map()
    queue.forEach((p, i) => {
      if (!seen.has(p.partyId)) seen.set(p.partyId, [])
      seen.get(p.partyId).push(i)
    })
    const multi = [...seen.values()].filter((v) => v.length > 1)
    expect(multi.length).toBeGreaterThan(0)
    for (const slots of multi) {
      const want = slots.map((_, k) => slots[0] + k)
      expect(slots).toEqual(want)
    }
  })
})

it('priority_5tier boards basic economy last', () => {
  const { queue } = makeQueue(cleanCfg('a320neo', 'priority_5tier', 3))
  const basic = queue.filter((p) => p.tier === 'basic').map((p) => p.boardingIndex)
  const others = queue.filter((p) => p.tier !== 'basic').map((p) => p.boardingIndex)
  expect(Math.min(...basic)).toBeGreaterThan(Math.max(...others))
})

// RESEARCH_AIRLINES 7 #6, as a property of the manifest rather than of any one
// strategy: status is drawn front-biased, so the early groups of any
// status-ordered scheme are spatially front-loaded rather than spread.
it('concentrates status in the forward rows', () => {
  const { ac, queue } = makeQueue(cfgFor('a320neo', 'random', 12, { loadFactor: 1.0 }))
  const slotOf = (tier) => meanOf(queue.filter((p) => p.tier === tier).map((p) => p.seat.rowSlot))
  const mid = (ac.rowSlots.length - 1) / 2
  // All three status buckets share one tilt -- the model says "status sits
  // forward", not "top tier sits further forward than cardholders" -- so the
  // assertion is on status-vs-basic, not on an ordering within status.
  const status = meanOf(
    queue
      .filter((p) => ['elite_top', 'elite_mid', 'cardholder'].includes(p.tier))
      .map((p) => p.seat.rowSlot),
  )
  expect(status).toBeLessThan(mid)
  expect(slotOf('basic')).toBeGreaterThan(mid)
  expect(status).toBeLessThan(slotOf('basic'))
})

it('restores the uniform status mix when the forward bias is switched off', () => {
  const { ac, queue } = makeQueue(
    cfgFor('a320neo', 'random', 12, { loadFactor: 1.0, eliteForwardBias: 0.0 }),
  )
  const slotOf = (tier) => meanOf(queue.filter((p) => p.tier === tier).map((p) => p.seat.rowSlot))
  const mid = (ac.rowSlots.length - 1) / 2
  // Uniform means every tier averages around mid-cabin, within sampling noise.
  for (const tier of ['elite_top', 'cardholder', 'basic', 'standard']) {
    expect(Math.abs(slotOf(tier) - mid)).toBeLessThan(mid * 0.35)
  }
})

it('slowest_first front-loads the two-bag passengers', () => {
  const { queue } = makeQueue(cleanCfg('a320neo', 'slowest_first', 3))
  const n = Math.floor(queue.length / 4)
  const head = meanOf(queue.slice(0, n).map((p) => p.bags))
  const tail = meanOf(queue.slice(-n).map((p) => p.bags))
  expect(head).toBeGreaterThan(tail)
})

// --- the strong correctness signal -----------------------------------------

describe.each(['a320neo', 'a220_300', 'b777_300er'])('%s', (aid) => {
  describe.each(['wilma', 'wilma_zoned', 'steffen_perfect'])('%s', (strategy) => {
    it('produces zero seat interference with parties and non-compliance off', () => {
      // Boarding strictly by decreasing depth means every blocker is still at
      // the gate when you sit down. Any non-zero count is a real bug in the
      // ordering or in the blocker lookup.
      const r = simulate(cleanCfg(aid, strategy, 21, { loadFactor: 1.0 }))
      expect(r.interference.one).toBe(0)
      expect(r.interference.two).toBe(0)
      expect(r.interference.sameParty).toBe(0)
      expect(r.interference.none).toBe(r.paxCount)
    })
  })
})

it('does produce interference under random boarding', () => {
  // The control for the test above: if the counter never fires, it proves
  // nothing.
  const r = simulate(cleanCfg('a320neo', 'random', 21, { loadFactor: 1.0 }))
  expect(r.interference.one + r.interference.two).toBeGreaterThan(20)
})

// --- universal post-processing ---------------------------------------------

// Step 1 of the pipeline, checked against steps 2-4 rather than in spite of
// them. Party cohesion drags a preboard's whole party forward with them, so the
// preboard BLOCK is a property of the manifest rather than a magic number, and
// step 3 is entitled to jitter anybody. Step 4 can still draw a preboard as a
// late arrival and send them to the very back -- that is the model saying they
// missed the call, and it is covered separately below.
it('lifts preboards to the front', () => {
  const cfg = cfgFor('a320neo', 'random', 5, { preboardRate: 0.15, lateRate: 0.0 })
  const { queue } = makeQueue(cfg)
  const pre = queue.filter((p) => p.isPreboard)
  expect(pre.length).toBeGreaterThan(0)
  expect(pre.every((p) => p.groupLabel === 'Preboard')).toBe(true)
  const preParties = new Set(pre.map((p) => p.partyId))
  const block = queue.filter((p) => preParties.has(p.partyId))
  expect(Math.max(...pre.map((p) => p.boardingIndex))).toBeLessThan(
    block.length + cfg.complianceJitter,
  )
})

// The control for the test above: lateness is drawn for everybody, preboards
// included, so the `lateRate: 0` there is deliberate scoping and not a bug
// being hidden.
it('can still draw a preboard as a late arrival', () => {
  const { queue } = makeQueue(cfgFor('a320neo', 'random', 5, { preboardRate: 0.15, lateRate: 0.5 }))
  const pre = queue.filter((p) => p.isPreboard)
  expect(pre.length).toBeGreaterThan(0)
  expect(Math.max(...pre.map((p) => p.boardingIndex))).toBeGreaterThan(queue.length / 2)
})

it('can switch preboardFirst off', () => {
  const { queue } = makeQueue(
    cfgFor('a320neo', 'random', 5, {
      preboardRate: 0.15,
      preboardFirst: false,
      keepPartiesTogether: false,
      nonComplianceRate: 0.0,
      lateRate: 0.0,
    }),
  )
  const pre = queue.filter((p) => p.isPreboard).map((p) => p.boardingIndex)
  expect(Math.max(...pre)).toBeGreaterThan(Math.floor(queue.length / 2))
})

it('keeps parties contiguous and window-first', () => {
  const { queue } = makeQueue(
    cfgFor('a320neo', 'random', 5, { nonComplianceRate: 0.0, lateRate: 0.0, preboardRate: 0.0 }),
  )
  const groups = new Map()
  for (const p of queue) {
    let list = groups.get(p.partyId)
    if (list === undefined) groups.set(p.partyId, (list = []))
    list.push(p)
  }
  const multi = [...groups.values()].filter((g) => g.length > 1)
  expect(multi.length).toBeGreaterThan(0)
  for (const g of multi) {
    const idx = g.map((p) => p.boardingIndex).sort((a, b) => a - b)
    expect(idx).toEqual([...Array(idx.length).keys()].map((i) => idx[0] + i))
    const depths = [...g].sort((a, b) => a.boardingIndex - b.boardingIndex).map((p) => p.depth)
    expect(depths).toEqual([...depths].sort((a, b) => b - a))
  }
})

it('shows party cohesion measurably degrading a Steffen ordering', () => {
  // The headline finding the simulator exists to show: a perfect Steffen order
  // is destroyed locally by families boarding together.
  const tight = runBatch(cleanCfg('a320neo', 'steffen_perfect', 31, { loadFactor: 0.9 }), 12)
  const loose = runBatch(
    cfgFor('a320neo', 'steffen_perfect', 31, {
      loadFactor: 0.9,
      nonComplianceRate: 0.0,
      lateRate: 0.0,
      preboardRate: 0.0,
      keepPartiesTogether: true,
    }),
    12,
  )
  expect(loose.interference.one + loose.interference.two).toBeGreaterThan(0)
  expect(tight.interference.one + tight.interference.two).toBe(0)
  expect(loose.mean).toBeGreaterThan(tight.mean)
})

it('keeps non-compliance local rather than reshuffling the queue', () => {
  const strict = cleanCfg('a320neo', 'back_to_front', 7)
  const sloppy = strict.replace({ nonComplianceRate: 0.9, complianceJitter: 6 })
  const a = makeQueue(strict).queue
  const b = makeQueue(sloppy).queue
  const posA = new Map(a.map((p) => [p.id, p.boardingIndex]))
  const posB = new Map(b.map((p) => [p.id, p.boardingIndex]))
  const moves = [...posA.keys()].map((id) => Math.abs(posA.get(id) - posB.get(id)))
  expect(Math.max(...moves)).toBeGreaterThan(0)
  expect(meanOf(moves)).toBeLessThan(30)
})

it('sends late arrivals to the very back', () => {
  const cfg = cfgFor('a320neo', 'front_to_back', 13, {
    lateRate: 0.25,
    nonComplianceRate: 0.0,
    keepPartiesTogether: false,
    preboardRate: 0.0,
  })
  const { ac, queue } = makeQueue(cfg)
  const tail = queue.slice(-10)
  expect(Math.max(...tail.map((p) => p.rowSlot))).toBeGreaterThan(
    Math.floor(ac.rowSlots.length / 2),
  )
})

/**
 * Recover the set of passenger ids that step 4 moved to the back.
 *
 * `buildOrder` emits `ontime + late`, both subsequences of the order the same
 * scenario produces with `lateRate = 0`, so ranking the late-enabled queue
 * against the late-free one gives two increasing runs and the split between them
 * is where the late block starts. Mirrors `_late_block` in
 * `python/tests/test_strategies.py`.
 */
function lateBlock(overrides = {}, seed = 7) {
  const s = makeQueue(cfgFor('a320neo', 'random', seed, { lateRate: 0.0, ...overrides })).queue
  const a = makeQueue(cfgFor('a320neo', 'random', seed, { lateRate: 0.3, ...overrides })).queue
  const rank = new Map(s.map((p, i) => [p.id, i]))
  const seq = a.map((p) => rank.get(p.id))
  const rising = (xs) => xs.every((v, i) => i === 0 || xs[i - 1] < v)
  for (let m = 0; m <= seq.length; m++) {
    if (rising(seq.slice(0, m)) && rising(seq.slice(m))) {
      return new Set(a.slice(m).map((p) => p.id))
    }
  }
  throw new Error('queue is not a merge of two ordered runs')
}

it('does not let the compliance jitter decide who arrives late', () => {
  // ENGINE_SPEC 1.3: the behaviour stream is Bernoulli(nonComplianceRate), then
  // -- only if that came up -- randint(2*jitter+1), then Bernoulli(lateRate).
  // Both conditions are on the Bernoulli, so the number of draws a passenger
  // consumes before their late draw must not depend on the jitter WIDTH.
  //
  // It used to. The whole step was gated on `jitter > 0`, so at jitter 0 the
  // compliance Bernoulli was skipped and the late draw became the first draw
  // instead of the second -- which made `complianceJitter`, a slider about queue
  // discipline, silently re-roll which passengers turn up late. Both engines did
  // the same wrong thing, so parity never noticed.
  const base = lateBlock({ nonComplianceRate: 0.15, complianceJitter: 0 })
  expect(base.size, 'nobody was late -- the test proves nothing').toBeGreaterThan(0)
  for (const complianceJitter of [1, 2, 6, 12]) {
    const other = lateBlock({ nonComplianceRate: 0.15, complianceJitter })
    expect([...other].sort((x, y) => x - y), `complianceJitter=${complianceJitter}`).toEqual(
      [...base].sort((x, y) => x - y),
    )
  }
})

it('consumes the compliance Bernoulli even at zero jitter', () => {
  // The same fix from the other side: at jitter 0 the compliance draw cannot
  // move anybody, but it must still be TAKEN, so the late set differs from the
  // one you get with the rate itself at zero.
  const order = (overrides) =>
    makeQueue(cfgFor('a320neo', 'random', 7, { complianceJitter: 0, ...overrides })).queue.map(
      (p) => p.id,
    )

  // With no lateness in play, jitter 0 leaves the order untouched either way --
  // so any difference below is entirely about who is late, not about ordering.
  expect(order({ nonComplianceRate: 0.0, lateRate: 0.0 })).toEqual(
    order({ nonComplianceRate: 0.15, lateRate: 0.0 }),
  )
  expect(order({ nonComplianceRate: 0.0, lateRate: 0.3 })).not.toEqual(
    order({ nonComplianceRate: 0.15, lateRate: 0.3 }),
  )
})

// Gamma(1 + 1/shape) at nine shapes spanning the slider, pinned so a drift in
// either language's log/exp shows up here rather than as a silent parity break.
// `python/tests/test_strategies.py` pins the identical table.
const WEIBULL_MEAN_FACTORS = [
  [1.0, 1.0],
  [1.05, 0.980793],
  [1.5, 0.902745],
  [1.7, 0.892245],
  [2.0, 0.886227],
  [2.5, 0.887264],
  [3.0, 0.89298],
  [3.3, 0.897015],
  [3.5, 0.899747],
]

it('makes the Weibull mean factor track the configured shape', () => {
  // `stratSlowestFirst` used to hard-code 0.8929795 for this. Two things were
  // wrong with that: it silently stopped meaning anything as soon as anybody
  // moved the `stowWeibullShape` slider, and it was not even the right number
  // for the shipped shape -- Gamma(1 + 1/1.7) is 0.892245.
  for (const [shape, expected] of WEIBULL_MEAN_FACTORS) {
    expect(weibullMeanFactor(shape), `shape ${shape}`).toBe(expected)
  }
  expect(weibullMeanFactor(1.7)).not.toBe(0.8929795)
})

it('lets the stow shape reach the slowest-first ordering', () => {
  // The regression the hard-coded constant hid: change the shape, and the
  // ordering the strategy produces must change with it.
  const ids = (stowWeibullShape) =>
    makeQueue(cleanCfg('a320neo', 'slowest_first', 4, { stowWeibullShape })).queue.map((p) => p.id)
  expect(ids(1.2)).not.toEqual(ids(3.4))
})

it('rejects an unknown strategy clearly', () => {
  expect(() => simulate(cfgFor('a320neo', 'random', 1).replace({ strategy: 'teleport' }))).toThrow(
    ConfigError,
  )
})
