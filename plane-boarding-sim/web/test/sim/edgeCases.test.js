/**
 * The corners: degenerate cabins, invalid input, and the deadlock sweep.
 * Mirrors `python/tests/test_edge_cases.py`.
 */
import { describe, expect, it } from 'vitest'
import { getAircraft } from '../../src/sim/aircraft.js'
import { ConfigError, buildConfig } from '../../src/sim/config.js'
import { run, simulate } from '../../src/sim/engine.js'
import { STRATEGIES } from '../../src/sim/strategies.js'
import '../../src/sim/replay.js'
import { ALL_AIRCRAFT, cfgFor } from './helpers.js'

const ALL = Object.keys(STRATEGIES)

it('boards an empty aircraft instantly', () => {
  const r = simulate(cfgFor('a320neo', 'random', 1, { loadFactor: 0 }))
  expect(r.paxCount).toBe(0)
  expect(r.totalSeconds).toBe(0)
  expect(r.completed).toBe(true)
  expect(r.perPassenger).toEqual([])
  expect(r.p50TimeToSeat).toBe(0)
  expect(r.maxTimeToSeat).toBe(0)
})

it('still completes a completely full aircraft', () => {
  const ac = getAircraft('a320neo')
  const r = simulate(cfgFor('a320neo', 'random', 1, { loadFactor: 1.0 }))
  expect(r.paxCount).toBe(ac.seatCount)
  expect(r.completed).toBe(true)
})

it('walks a single passenger straight on', () => {
  const ac = getAircraft('b777_300er')
  const r = simulate(cfgFor('b777_300er', 'random', 15, { loadFactor: 1 / ac.seatCount }))
  expect(r.paxCount).toBe(1)
  expect(r.completed).toBe(true)
  expect(r.aisleBlockEvents).toBe(0)
  expect(r.interference.none).toBe(1)
  const p = r.perPassenger[0]
  expect(p.blockers).toBe(0)
  expect(p.blockedTime).toBe(0)
})

it('makes everyone carry two bags when told to', () => {
  const r = simulate(cfgFor('a320neo', 'random', 2, { bagWeights: { 0: 0, 1: 0, 2: 1 } }))
  expect(r.perPassenger.every((p) => p.bags === 2)).toBe(true)
  expect(r.timeBreakdown.stow).toBeGreaterThan(0)
})

it('gate-checks en masse when bin capacity is squeezed to nothing', () => {
  const loose = simulate(cfgFor('a320neo', 'random', 2, { binBagsPerRowSide: 4 }))
  const tight = simulate(cfgFor('a320neo', 'random', 2, { binBagsPerRowSide: 0 }))
  expect(tight.gateChecks).toBeGreaterThan(loose.gateChecks)
  expect(tight.totalSeconds).toBeGreaterThan(loose.totalSeconds)
})

describe('rejecting bad input', () => {
  it('rejects an out-of-range load factor', () => {
    expect(() => cfgFor('a320neo', 'random', 1, { loadFactor: 1.5 })).toThrow(ConfigError)
    expect(() => cfgFor('a320neo', 'random', 1, { loadFactor: -0.1 })).toThrow(ConfigError)
  })

  it('rejects an unknown config key', () => {
    expect(() => cfgFor('a320neo', 'random', 1, { warpFactor: 9 })).toThrow(ConfigError)
  })

  it('rejects an unknown aircraft', () => {
    expect(() => getAircraft('concorde')).toThrow(ConfigError)
  })

  it('rejects an invalid door assignment and open-seating policy', () => {
    expect(() => cfgFor('a320neo', 'random', 1, { doorAssignment: 'teleport' })).toThrow(ConfigError)
    expect(() => cfgFor('a320neo', 'random', 1, { openSeatingPolicy: 'vibes' })).toThrow(ConfigError)
  })

  it('rejects a non-positive dt or sample interval', () => {
    expect(() => cfgFor('a320neo', 'random', 1, { dt: 0 })).toThrow(ConfigError)
    expect(() => cfgFor('a320neo', 'random', 1, { sampleInterval: -1 })).toThrow(ConfigError)
  })

  it('rejects a shuffle triangular whose mode is outside its range', () => {
    expect(() => cfgFor('a320neo', 'random', 1, { shuffleMoveMode: 9 })).toThrow(ConfigError)
  })

  it('refuses to board through no doors, or through a non-boarding door', () => {
    expect(() => cfgFor('a320neo', 'random', 1, { doors: [] })).not.toThrow() // config is fine
    expect(() => simulate(cfgFor('a320neo', 'random', 1, { doors: [] }))).toThrow(ConfigError)
    const ac = getAircraft('a320neo')
    const service = ac.doors.find((d) => !d.boardable)
    if (service) {
      expect(() => simulate(cfgFor('a320neo', 'random', 1, { doors: [service.id] }))).toThrow(
        ConfigError,
      )
    }
  })
})

describe.each(['aisle_first', 'window_first', 'front_first', 'avoid_neighbours'])(
  'open seating / %s',
  (policy) => {
    it('fills the cabin without leaving anybody standing', () => {
      const ac = getAircraft('e175')
      const r = simulate(
        cfgFor('e175', 'open_seating', 4, { openSeatingPolicy: policy, loadFactor: 1.0 }),
      )
      expect(r.completed).toBe(true)
      expect(r.paxCount).toBe(ac.seatCount)
      expect(new Set(r.perPassenger.map((p) => p.seat)).size).toBe(ac.seatCount)
    })
  },
)

describe.each(['single', 'split_by_row', 'split_by_aisle'])('door assignment / %s', (assignment) => {
  it('works on a twin-aisle aircraft', () => {
    const r = simulate(
      cfgFor('b777_300er', 'random', 5, { doorAssignment: assignment, doors: ['1L', '2L'] }),
    )
    expect(r.completed).toBe(true)
    const used = new Set(r.perPassenger.map((p) => p.doorId))
    if (assignment === 'single') expect(used).toEqual(new Set(['1L']))
    else expect(used.size).toBe(2)
  })
})

it('boards faster through two doors than one', () => {
  const one = simulate(cfgFor('b737_max8', 'random', 5, { doors: ['1L'] }))
  const two = simulate(cfgFor('b737_max8', 'random', 5, { doors: ['1L', '2L'] }))
  expect(two.totalSeconds).toBeLessThan(one.totalSeconds)
})

describe.each(ALL_AIRCRAFT)('%s', (aid) => {
  it('completes every strategy at its default configuration', () => {
    // The broad guard. Two-door open seating used to deadlock here: passengers
    // from the forward and aft doors chose seats on each other's side of the
    // cabin, walked head-on down a single-file aisle and neither could yield.
    for (const strategy of ALL) {
      const r = simulate(cfgFor(aid, strategy, 2))
      expect(r.completed, `${aid}/${strategy} hit MAX_SIM_SECONDS`).toBe(true)
      expect(r.totalSeconds).toBeLessThan(3600)
    }
  })

  it('completes every strategy through every boardable door combination', () => {
    // The deadlock sweep. Partial aisle blocking changed the interaction rules
    // exactly where two deadlocks already lived, so every strategy is run
    // against every door configuration on every aircraft.
    const ac = getAircraft(aid)
    const boardable = ac.boardableDoors().map((d) => d.id)
    const combos = []
    for (let mask = 1; mask < 1 << boardable.length; mask++) {
      combos.push(boardable.filter((_, i) => mask & (1 << i)))
    }
    for (const strategy of ALL) {
      for (const doors of combos) {
        const r = simulate(cfgFor(aid, strategy, 2, { doors }))
        expect(r.completed, `${aid}/${strategy}/${doors} hit MAX_SIM_SECONDS`).toBe(true)
        expect(r.totalSeconds).toBeLessThan(3600)
      }
    }
  })
})

it('never sends two doors’ traffic head-on down the same stretch of aisle', () => {
  // Structural invariant behind the deadlock fix: within one lane, everyone fed
  // by a given door travels the same way, and no two doors send opposing
  // traffic through the same stretch.
  for (const strategy of ['random', 'open_seating', 'back_to_front']) {
    const cfg = cfgFor('b737_max8', strategy, 3)
    const ac = getAircraft('b737_max8')
    const { replay } = run(cfg, ac, true, cfg.dt)
    const doorX = new Map(ac.doors.map((d) => [d.id, d.x]))
    const spans = new Map()
    for (const p of replay.passengers) {
      const dx = doorX.get(p.doorId)
      const sx = p.seatX
      const lo = Math.min(dx, sx)
      const hi = Math.max(dx, sx)
      const key = `${p.lane}|${p.doorId}`
      const prev = spans.get(key)
      spans.set(key, prev ? [Math.min(prev[0], lo), Math.max(prev[1], hi)] : [lo, hi])
    }
    const byLane = new Map()
    for (const [key, span] of spans) {
      const [lane] = key.split('|')
      let list = byLane.get(lane)
      if (list === undefined) byLane.set(lane, (list = []))
      list.push(span)
    }
    for (const entries of byLane.values()) {
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const overlap =
            Math.min(entries[i][1], entries[j][1]) - Math.max(entries[i][0], entries[j][0])
          expect(overlap).toBeLessThanOrEqual(1e-9)
        }
      }
    }
  }
})

describe('config layering', () => {
  it('applies defaults -> aircraft defaults -> overrides, in that order', () => {
    const e175 = getAircraft('e175')
    // The E175 valet-checks most roll-aboards, so it overrides bagWeights.
    expect(e175.defaultConfig.bagWeights).toBeDefined()
    const layered = buildConfig(e175.defaultConfig, { aircraftId: 'e175' })
    expect(layered.bagWeights).toEqual(
      Object.keys(e175.defaultConfig.bagWeights)
        .map(Number)
        .sort((a, b) => a - b)
        .map((k) => e175.defaultConfig.bagWeights[String(k)]),
    )
    // ...and a user override still wins over the airframe.
    const overridden = buildConfig(e175.defaultConfig, {
      aircraftId: 'e175',
      bagWeights: { 0: 0, 1: 1 },
    })
    expect(overridden.bagKeys).toEqual([0, 1])
    expect(overridden.bagWeights).toEqual([0, 1])
  })

  it('ignores `_`-prefixed documentation keys', () => {
    const cfg = buildConfig({ _comment: 'ignored', walkSpeedMean: 1.1 }, null)
    expect(cfg.walkSpeedMean).toBe(1.1)
    expect(cfg.raw._comment).toBeUndefined()
  })

  it('sorts integer-keyed weight maps numerically, not by JSON order', () => {
    const cfg = buildConfig(null, { bagWeights: { 2: 0.5, 0: 0.2, 1: 0.3 } })
    expect(cfg.bagKeys).toEqual([0, 1, 2])
    expect(cfg.bagWeights).toEqual([0.2, 0.3, 0.5])
  })

  it('keeps string-keyed weight maps in insertion order', () => {
    const cfg = buildConfig(null, { eliteMix: { z: 1, a: 2, m: 3 } })
    expect(cfg.eliteKeys).toEqual(['z', 'a', 'm'])
    expect(cfg.eliteWeights).toEqual([1, 2, 3])
  })
})

// The second axis of the deadlock sweep. `dt` and `stowPassSpeedFactor` are both
// plain sliders in the shipped UI (max 0.5 and 1.0), and their product governs
// how far a squeezing passenger travels in one step -- exactly the quantity the
// squeeze-past wedge was a function of. Every pair below reproduced that wedge
// before the fix; dt 0.5 x factor 1.0 failed on 3 of 5 seeds.
const SQUEEZE_STEP_GRID = []
for (const dt of [0.3, 0.4, 0.5]) for (const f of [0.6, 0.8, 1.0]) SQUEEZE_STEP_GRID.push([dt, f])

describe.each(ALL_AIRCRAFT)('%s', (aid) => {
  it('completes every strategy at every time step and squeeze factor', () => {
    // Sweeping strategies against doors alone could not have caught the
    // squeeze-past deadlock: the default `dt` of 0.1 never advances a passer far
    // enough in one step to land inside a second stower's zone. The combination
    // is reachable from the shipped UI by dragging two sliders.
    for (const strategy of ALL) {
      for (const [dt, factor] of SQUEEZE_STEP_GRID) {
        const r = simulate(cfgFor(aid, strategy, 2, { dt, stowPassSpeedFactor: factor }))
        expect(
          r.completed,
          `${aid}/${strategy}/dt=${dt}/factor=${factor} hit MAX_SIM_SECONDS`,
        ).toBe(true)
        expect(r.totalSeconds).toBeLessThan(3600)
      }
    }
  })
})
