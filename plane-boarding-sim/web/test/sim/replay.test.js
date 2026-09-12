/**
 * The replay document the web visualiser consumes.
 * Mirrors `python/tests/test_replay.py`, plus the fields `src/cabin/` reads.
 */
import { describe, expect, it } from 'vitest'
import { getAircraft } from '../../src/sim/aircraft.js'
import { QUEUED, SEATED, WALKING } from '../../src/sim/config.js'
import { run } from '../../src/sim/engine.js'
import '../../src/sim/replay.js'
import { AIRCRAFT, DEFAULTS, STRATEGIES, resolveAircraft, runReplay, runSimulation } from '../../src/sim/index.js'
import { cfgFor } from './helpers.js'

const cfg = cfgFor('a220_300', 'common_sense_5tier', 6, { loadFactor: 0.8 })
const { result, replay } = run(cfg, null, true, 0.25)

describe('the replay document', () => {
  it('has the documented shape', () => {
    for (const key of [
      'aircraft',
      'config',
      'strategy',
      'seed',
      'frameInterval',
      'frameCount',
      'duration',
      'passengers',
      'frames',
      'result',
    ]) {
      expect(replay).toHaveProperty(key)
    }
    expect(replay.strategy).toBe(cfg.strategy)
    expect(replay.seed).toBe(cfg.seed)
    expect(replay.frameInterval).toBe(0.25)
    expect(replay.duration).toBe(result.totalSeconds)
  })

  it('has rectangular frame arrays indexed by passenger', () => {
    const n = replay.passengers.length
    expect(n).toBe(result.paxCount)
    expect(replay.frameCount).toBe(replay.frames.state.length)
    expect(replay.frameCount).toBe(replay.frames.x.length)
    for (let f = 0; f < replay.frameCount; f++) {
      expect(replay.frames.state[f]).toHaveLength(n)
      expect(replay.frames.x[f]).toHaveLength(n)
      expect(replay.frames.state[f].every((s) => s >= 0 && s <= 4)).toBe(true)
    }
  })

  it('spans the whole boarding', () => {
    expect(new Set(replay.frames.state[0]).size).toBeLessThanOrEqual(2)
    for (const s of replay.frames.state[0]) expect([QUEUED, WALKING]).toContain(s)
    for (const s of replay.frames.state[replay.frameCount - 1]) expect(s).toBe(SEATED)
    const expected = Math.trunc(result.totalSeconds / replay.frameInterval) + 1
    expect(Math.abs(replay.frameCount - expected)).toBeLessThanOrEqual(2)
  })

  it('carries what the renderer needs on each passenger', () => {
    for (const p of replay.passengers) {
      expect(Object.keys(p).sort()).toEqual([
        'bags',
        'cabinId',
        'doorId',
        'groupLabel',
        'id',
        'lane',
        'party',
        'seatDepth',
        'seatLetter',
        'seatRow',
        'seatX',
        'tier',
      ])
      expect(p.seatRow).not.toBeNull()
      expect(p.doorId).toBeTruthy()
    }
  })

  it('carries the geometry fields src/cabin/geometry.js reads', () => {
    const g = replay.aircraft
    expect(Number.isFinite(g.lengthM)).toBe(true)
    expect(g.aisleCount).toBeGreaterThanOrEqual(1)
    for (const c of g.cabins) expect(Array.isArray(c.layout)).toBe(true)
    for (const r of g.rowSlots) {
      expect(Number.isFinite(r.rowNumber)).toBe(true)
      expect(Number.isFinite(r.pitchM)).toBe(true)
      expect(Number.isFinite(r.x)).toBe(true)
    }
    for (const s of g.seats) {
      expect(s.cabinId).toBeTruthy()
      expect(s.letter).toBeTruthy()
      expect(Number.isFinite(s.rowNumber)).toBe(true)
    }
    for (const d of g.doors) expect(Number.isFinite(d.x)).toBe(true)
  })

  it('round-trips through JSON', () => {
    expect(JSON.parse(JSON.stringify(replay)).frameCount).toBe(replay.frameCount)
  })

  it('reports the seat actually taken under open seating', () => {
    const { replay: rep } = run(cfgFor('e175', 'open_seating', 3), null, true, 0.25)
    const ac = getAircraft('e175')
    const valid = new Set(ac.seats.map((s) => `${s.rowNumber}${s.letter}`))
    const taken = rep.passengers.map((p) => `${p.seatRow}${p.seatLetter}`)
    expect(new Set(taken).size).toBe(taken.length)
    expect(taken.every((t) => valid.has(t))).toBe(true)
  })
})

describe('the public interface src/lib/engineBridge.js expects', () => {
  it('exports the six documented members', () => {
    expect(Object.keys(AIRCRAFT).sort()).toEqual(
      ['a220_300', 'a320neo', 'b737_max8', 'b777_300er', 'b787_9', 'e175'],
    )
    expect(Object.keys(STRATEGIES)).toHaveLength(15)
    for (const [key, entry] of Object.entries(STRATEGIES)) {
      expect(entry).toEqual({
        key,
        name: expect.any(String),
        description: expect.any(String),
        family: expect.any(String),
      })
    }
    expect(DEFAULTS.loadFactor).toBe(0.92)
    expect(resolveAircraft('a320neo').seatCount).toBe(186)
  })

  it('exports STRATEGIES as clonable metadata, so it survives postMessage', () => {
    expect(() => structuredClone(STRATEGIES)).not.toThrow()
  })

  it('runs a simulation from a flat app config, ignoring shell-only keys', () => {
    const appConfig = {
      ...structuredClone(DEFAULTS), // includes `_comment` and `_constants`
      aircraftId: 'a320neo',
      strategy: 'wilma',
      seed: 7,
      doors: ['1L'],
      runs: 200, // shell-only
      compareStrategies: ['random'], // shell-only
    }
    const r = runSimulation(appConfig)
    expect(r.strategy).toBe('wilma')
    expect(r.doors).toEqual(['1L'])
    expect(r.completed).toBe(true)
    expect(r.paxCount).toBeGreaterThan(0)
  })

  it('runReplay returns a Replay, and does not change the numbers', () => {
    const appConfig = { aircraftId: 'e175', strategy: 'random', seed: 3, loadFactor: 0.6 }
    const plain = runSimulation(appConfig)
    const rep = runReplay(appConfig)
    expect(rep.result.totalSeconds).toBe(plain.totalSeconds)
    expect(rep.duration).toBe(plain.totalSeconds)
    expect(rep.dt).toBe(rep.frameInterval)
  })

  it('produces the RunResult fields state/aggregate.js reads', () => {
    const r = runSimulation({ aircraftId: 'e175', strategy: 'random', seed: 3 })
    expect(r.seatedCurve[0]).toHaveProperty('t')
    expect(r.seatedCurve[0]).toHaveProperty('seated')
    expect(r.aisleOccupancy[0]).toHaveProperty('count')
    expect(Array.isArray(r.congestion)).toBe(true)
    expect(Array.isArray(r.congestion[0])).toBe(true)
    expect(r.perPassenger[0]).toHaveProperty('timeInAisle')
    expect(r.perPassenger[0]).toHaveProperty('seat')
    expect(Object.keys(r.timeBreakdown).sort()).toEqual(['blocked', 'shuffle', 'stow', 'walk'])
    expect(Object.keys(r.interference).sort()).toEqual(['none', 'one', 'sameParty', 'two'])
  })
})
