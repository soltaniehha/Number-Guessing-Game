/**
 * Each of the fifteen strategies, plus the universal post-processing pipeline.
 * Mirrors `python/tests/test_strategies.py`.
 */
import { describe, expect, it } from 'vitest'
import { ConfigError } from '../../src/sim/config.js'
import { simulate } from '../../src/sim/engine.js'
import { generate } from '../../src/sim/passengers.js'
import { PCG32 } from '../../src/sim/rng.js'
import { STRATEGIES } from '../../src/sim/strategies.js'
import { runBatch } from '../../src/sim/batch.js'
import { cfgFor, cleanCfg, makeQueue } from './helpers.js'

const ALL = Object.keys(STRATEGIES).sort()
const sum = (xs) => xs.reduce((a, b) => a + b, 0)
const meanOf = (xs) => sum(xs) / xs.length

it('has the fifteen documented strategies, each with printable metadata', () => {
  expect(ALL).toHaveLength(15)
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

it('priority_5tier boards basic economy last', () => {
  const { queue } = makeQueue(cleanCfg('a320neo', 'priority_5tier', 3))
  const basic = queue.filter((p) => p.tier === 'basic').map((p) => p.boardingIndex)
  const others = queue.filter((p) => p.tier !== 'basic').map((p) => p.boardingIndex)
  expect(Math.min(...basic)).toBeGreaterThan(Math.max(...others))
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

it('lifts preboards to the front', () => {
  const { queue } = makeQueue(cfgFor('a320neo', 'random', 5, { preboardRate: 0.15 }))
  const pre = queue.filter((p) => p.isPreboard)
  expect(pre.length).toBeGreaterThan(0)
  expect(Math.max(...pre.map((p) => p.boardingIndex))).toBeLessThan(pre.length + 30)
  expect(pre.every((p) => p.groupLabel === 'Preboard')).toBe(true)
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

it('rejects an unknown strategy clearly', () => {
  expect(() => simulate(cfgFor('a320neo', 'random', 1).replace({ strategy: 'teleport' }))).toThrow(
    ConfigError,
  )
})
