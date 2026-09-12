/**
 * The defects a code review and a QA pass found in the app layer, each pinned
 * by the smallest test that would have caught it.
 */
import { describe, expect, it } from 'vitest'
import {
  coerceToSchema,
  makeConfigReducer,
  sanitizeConfig,
  sanitizeDoors,
} from '../../src/state/configReducer.js'
import { defaultDoorsFor, effectiveDefaults } from '../../src/state/configDefaults.js'
import { aggregateBatch, isTruncatedRun, summariseStrategy, readSummaries, tCritical95 } from '../../src/state/aggregate.js'
import { pairedDifference, rankRows, sharedRanksPaired } from '../../src/state/paired.js'
import { baseSeedOf, seedForRun } from '../../src/lib/seed.js'
import { defaults, a320, e175, engine } from './fixtures.js'

const reducer = makeConfigReducer(defaults, engine)

/** An airframe with the roster's real shape: most of its doors cannot board. */
const REGIONAL = {
  id: 'regional',
  name: 'Regional',
  doors: [
    { id: '1L', kind: 'jetbridge', boardable: true, defaultEnabled: true, rowBefore: 1 },
    { id: '1R', kind: 'service', boardable: false, defaultEnabled: false, rowBefore: 1 },
    { id: '2L', kind: 'service', boardable: false, defaultEnabled: true, rowBefore: null },
  ],
  rowSlots: [{ slot: 0, number: 1 }, { slot: 1, number: 2 }],
}

describe('B2 — a corrupt shared link never blanks the app', () => {
  it('holds string-valued fields to being strings', () => {
    const out = coerceToSchema({ aircraftId: 42, strategy: null, doorAssignment: ['x'] }, defaults)
    expect(out.aircraftId).toBe(defaults.aircraftId)
    expect(out.strategy).toBe(defaults.strategy)
    expect(out.doorAssignment).toBe(defaults.doorAssignment)
  })

  it('resolves an unknown aircraft id against the engine registry', () => {
    const out = sanitizeConfig({ ...defaults, aircraftId: 'concorde' }, a320, defaults, engine)
    expect(out.aircraftId).toBe(defaults.aircraftId)
    expect(engine.AIRCRAFT[out.aircraftId]).toBeTruthy()
  })

  it('resolves an unknown strategy, and drops unknown ones from the comparison', () => {
    const out = sanitizeConfig(
      { ...defaults, strategy: 'teleport', compareStrategies: ['wilma', 'teleport'] },
      a320,
      defaults,
      engine,
    )
    expect(out.strategy).toBe(defaults.strategy)
    expect(out.compareStrategies).toEqual(['wilma'])
  })

  it('keeps ids it does know', () => {
    const out = sanitizeConfig({ ...defaults, aircraftId: 'e175', strategy: 'wilma' }, e175, defaults, engine)
    expect(out.aircraftId).toBe('e175')
    expect(out.strategy).toBe('wilma')
  })
})

describe('P3 — a null number is not zero', () => {
  it('falls back to the default rather than coercing to 0', () => {
    expect(coerceToSchema({ loadFactor: null }, defaults).loadFactor).toBe(defaults.loadFactor)
    expect(coerceToSchema({ loadFactor: '' }, defaults).loadFactor).toBe(defaults.loadFactor)
    expect(coerceToSchema({ loadFactor: [] }, defaults).loadFactor).toBe(defaults.loadFactor)
    expect(coerceToSchema({ loadFactor: false }, defaults).loadFactor).toBe(defaults.loadFactor)
  })

  it('still accepts a real number, including a numeric string', () => {
    expect(coerceToSchema({ loadFactor: 0.5 }, defaults).loadFactor).toBe(0.5)
    expect(coerceToSchema({ loadFactor: '0.5' }, defaults).loadFactor).toBe(0.5)
    expect(coerceToSchema({ loadFactor: 0 }, defaults).loadFactor).toBe(0)
  })
})

describe('B6/B7 — only boarding doors', () => {
  it('defaults to the airframe\'s own boardable doors', () => {
    // `2L` is defaultEnabled but not boardable: it must not be picked.
    expect(defaultDoorsFor(REGIONAL)).toEqual(['1L'])
  })

  it('drops non-boardable ids instead of passing them to the engine', () => {
    expect(sanitizeDoors(['1L', '2L'], REGIONAL)).toEqual(['1L'])
    expect(sanitizeDoors(['1R', '2L'], REGIONAL)).toEqual(['1L'])
  })

  it('gives a config that names an airframe but no doors THAT airframe\'s doors', () => {
    expect(effectiveDefaults(defaults, REGIONAL).doors).toEqual(['1L'])
  })

  it('loads a bare {aircraftId} without inheriting the default airframe\'s doors', () => {
    const loaded = reducer(defaults, { type: 'LOAD_CONFIG', config: { aircraftId: 'e175' }, aircraft: e175 })
    const boardable = e175.doors.filter((d) => d.boardable !== false).map((d) => d.id)
    expect(loaded.doors.every((id) => boardable.includes(id))).toBe(true)
  })
})

describe('S5 — the shuffle-movement triangle stays ordered', () => {
  const set = (config, field, value) =>
    reducer(config, { type: 'SET_FIELD', field, value, aircraft: a320 })
  const ordered = (c) => c.shuffleMoveMin <= c.shuffleMoveMode && c.shuffleMoveMode <= c.shuffleMoveMax

  it('survives every extreme of all three sliders', () => {
    for (const field of ['shuffleMoveMin', 'shuffleMoveMode', 'shuffleMoveMax']) {
      for (const value of [0, 0.5, 1, 1.5, 4, 6, 9]) {
        expect(ordered(set(defaults, field, value)), `${field}=${value}`).toBe(true)
      }
    }
  })

  it('lets the slider the user moved win', () => {
    expect(set(defaults, 'shuffleMoveMin', 4).shuffleMoveMin).toBe(4)
    expect(set(defaults, 'shuffleMoveMax', 1.5).shuffleMoveMax).toBe(1.5)
    expect(set(defaults, 'shuffleMoveMode', 6).shuffleMoveMode).toBe(6)
  })

  it('orders a triangle that arrives inverted from a link', () => {
    const out = sanitizeConfig(
      { ...defaults, shuffleMoveMin: 8, shuffleMoveMode: 2, shuffleMoveMax: 1 },
      a320,
      defaults,
      engine,
    )
    expect(ordered(out)).toBe(true)
  })
})

describe('S6 — one seed helper, not two', () => {
  it('does not wrap at 2^31 the way `| 0` did', () => {
    expect(baseSeedOf({ seed: 3_000_000_000 })).toBe(3_000_000_000)
    expect(3_000_000_000 | 0).not.toBe(3_000_000_000)
  })

  it('reads a numeric string the way the worker does', () => {
    expect(baseSeedOf({ seed: '3000000000' })).toBe(3_000_000_000)
    expect('3000000000' | 0).toBe(-1_294_967_296)
  })

  it('falls back to 0 for anything that is not a number', () => {
    expect(baseSeedOf({ seed: 'banana' })).toBe(0)
    expect(baseSeedOf({})).toBe(0)
    expect(seedForRun({ seed: 100 }, 3)).toBe(103)
  })
})

describe('statistics', () => {
  it('uses t(n-1), not a flat 1.96', () => {
    expect(tCritical95(4)).toBe(2.776)
    expect(tCritical95(60)).toBe(1.96)
    const values = [600, 620, 640, 660, 680]
    const entry = summariseStrategy('x', values.map((v) => ({ totalSeconds: v, completed: true })))
    // sd = 31.62, n = 5 -> t(4) * sd/sqrt(5) = 39.3, against 1.96 -> 27.7
    expect(entry.totalSeconds.ci95).toBeCloseTo(2.776 * (31.6228 / Math.sqrt(5)), 0)
  })
})

describe('B3 — runs that hit the simulation cap', () => {
  const done = (t) => ({ totalSeconds: t, paxCount: 4, completed: true, seatedCurve: [{ t, seated: 4 }] })
  /** As the batch worker delivers it: `completed` trimmed away, curve intact. */
  const cutOffLean = (t) => ({ totalSeconds: t, paxCount: 4, seatedCurve: [{ t, seated: 3 }] })

  it('spots a truncated run through the flag, and without it', () => {
    expect(isTruncatedRun(done(600))).toBe(false)
    expect(isTruncatedRun({ ...done(7200), completed: false })).toBe(true)
    expect(isTruncatedRun(cutOffLean(7200))).toBe(true)
  })

  it('keeps truncated runs out of the boarding-time statistics', () => {
    const entry = summariseStrategy('x', [done(600), done(700), cutOffLean(7200), cutOffLean(7200)])
    expect(entry.runs).toBe(4)
    expect(entry.timedRuns).toBe(2)
    expect(entry.incomplete).toBe(2)
    expect(entry.totalSeconds.max).toBe(700)
    expect(entry.totalSeconds.values).toEqual([600, 700])
  })

  it('says so rather than dropping the strategy when every run was cut off', () => {
    const entry = summariseStrategy('x', [cutOffLean(7200), cutOffLean(7200)])
    expect(entry.allTruncated).toBe(true)
    expect(entry.incomplete).toBe(2)
    expect(entry.totalSeconds.mean).toBe(7200)
  })

  it('carries the count out to the read-outs', () => {
    const batch = aggregateBatch({
      byStrategy: { x: [done(600), cutOffLean(7200)] },
      config: defaults,
      done: 2,
      total: 2,
      complete: true,
    })
    const [row] = readSummaries(batch)
    expect(row.incomplete).toBe(1)
    expect(row.timedRuns).toBe(1)
    expect(row.mean).toBe(600)
  })
})

describe('B4 — ties are ties', () => {
  it('calls two identical series a tie and separates two clearly different ones', () => {
    const a = [600, 610, 620, 630, 640, 650, 660, 670]
    expect(pairedDifference(a, a).significant).toBe(false)
    expect(pairedDifference(a.map((v) => v + 300), a).significant).toBe(true)
  })

  // A one-second difference that is IDENTICAL on every replication is a real
  // difference, however small — that is what pairing is for. A tie is a
  // difference whose sign is not even consistent, which is what this is.
  const A = [600, 610, 620, 630, 640, 650, 660, 670]
  const B = [604, 606, 624, 626, 644, 646, 664, 666]
  const SLOW = A.map((v) => v + 400)

  it('gives tied strategies a shared rank, tested against the group leader', () => {
    expect(sharedRanksPaired([A, B, SLOW])).toEqual([1, 1, 3])
  })

  it('never crowns one of a tied set', () => {
    const rows = [
      { key: 'a', mean: 635, ci95: 8, values: A },
      { key: 'b', mean: 635, ci95: 8, values: B },
      { key: 'c', mean: 1035, ci95: 8, values: SLOW },
    ]
    const { ranks, tied, paired } = rankRows(rows)
    expect(paired).toBe(true)
    expect(ranks).toEqual([1, 1, 3])
    expect([...tied]).toEqual([1])
  })

  it('falls back to the marginal test when there is nothing to pair', () => {
    const rows = [
      { key: 'a', mean: 600, ci95: 20, values: [] },
      { key: 'b', mean: 610, ci95: 20, values: [] },
      { key: 'c', mean: 900, ci95: 20, values: [] },
    ]
    const { ranks, paired } = rankRows(rows)
    expect(paired).toBe(false)
    expect(ranks).toEqual([1, 1, 3])
  })
})

describe('chart metadata and congestion padding', () => {
  const run = (grid, total) => ({
    totalSeconds: total,
    paxCount: 2,
    completed: true,
    seatedCurve: [{ t: total, seated: 2 }],
    congestion: grid,
  })

  it('zero-pads to the longest grid instead of cropping to the shortest', () => {
    const entry = summariseStrategy('x', [run([[1, 1, 1, 1]], 4), run([[3, 3]], 2)])
    // A finished run has nobody in the aisle, so the tail is a real 0.
    expect(entry.congestionMean).toEqual([[2, 2, 0.5, 0.5]])
  })

  it('emits the column pitch and the real row numbers', () => {
    const batch = aggregateBatch({
      byStrategy: { x: [run([[1]], 1)] },
      config: { ...defaults, sampleInterval: 2.5 },
      aircraft: REGIONAL,
      done: 1,
      total: 1,
      complete: true,
    })
    expect(batch.meta.sampleInterval).toBe(2.5)
    expect(batch.meta.rowSlots).toEqual([{ slot: 0, number: 1 }, { slot: 1, number: 2 }])
  })

  it('says nothing rather than guessing when it cannot know', () => {
    const batch = aggregateBatch({ byStrategy: { x: [run([[1]], 1)] }, config: {}, done: 1, total: 1 })
    expect(batch.meta.sampleInterval).toBeUndefined()
    expect(batch.meta.rowSlots).toBeUndefined()
  })
})
