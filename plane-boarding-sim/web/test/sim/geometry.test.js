/**
 * Geometry resolution: does the declarative roster turn into the right cabin?
 * Mirrors `python/tests/test_geometry.py`.
 */
import { describe, expect, it } from 'vitest'
import {
  AISLE_SEAT,
  MIDDLE,
  WINDOW,
  aircraftIds,
  analyseLayout,
  geometryPayload,
  getAircraft,
} from '../../src/sim/aircraft.js'
import { ConfigError } from '../../src/sim/config.js'

/**
 * Declared totals from the cabin research. These are the numbers the roster has
 * to reproduce exactly -- a drift means a layout or a `missingSeats` entry has
 * been edited without redoing the arithmetic.
 */
const DECLARED_SEATS = {
  e175: 76,
  a320neo: 186,
  b737_max8: 197,
  a220_300: 130,
  b777_300er: 354,
  b787_9: 257,
}
const IDS = Object.keys(DECLARED_SEATS).sort()

describe.each(IDS)('%s', (aid) => {
  it('loads with the declared seat count', () => {
    expect(getAircraft(aid).seatCount).toBe(DECLARED_SEATS[aid])
  })

  it('has unique seat ids and never uses the letter I', () => {
    const ac = getAircraft(aid)
    const ids = ac.seats.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ac.seats.every((s) => s.letter !== 'I')).toBe(true)
  })

  it('maps every seat to a real aisle and a sane depth', () => {
    const ac = getAircraft(aid)
    for (const s of ac.seats) {
      expect(s.aisleIndex).toBeGreaterThanOrEqual(0)
      expect(s.aisleIndex).toBeLessThan(ac.aisleCount)
      expect(s.depth).toBeGreaterThanOrEqual(1)
      expect(s.depth).toBeLessThanOrEqual(3)
      expect(s.blockId).toBeGreaterThanOrEqual(0)
      expect(s.blockId).toBeLessThan(ac.blockCount)
      expect(s.rowSlot).toBeGreaterThanOrEqual(0)
      expect(s.rowSlot).toBeLessThan(ac.rowSlots.length)
    }
  })

  it('places rows monotonically aft and declares at least one boarding door', () => {
    const ac = getAircraft(aid)
    for (let i = 1; i < ac.rowSlots.length; i++) {
      expect(ac.rowSlots[i].x).toBeGreaterThan(ac.rowSlots[i - 1].x)
    }
    expect(ac.length).toBeGreaterThan(ac.rowSlots[ac.rowSlots.length - 1].x)
    expect(ac.boardableDoors().length).toBeGreaterThanOrEqual(1)
    expect(ac.defaultDoors().length).toBeGreaterThanOrEqual(1)
  })

  it('exposes the fields the cabin renderer reads', () => {
    const g = geometryPayload(getAircraft(aid))
    expect(g.seatCount).toBe(DECLARED_SEATS[aid])
    expect(g.rowSlots.length).toBeGreaterThan(0)
    for (const r of g.rowSlots) {
      expect(Number.isFinite(r.rowNumber)).toBe(true)
      expect(Number.isFinite(r.pitchM)).toBe(true)
    }
    for (const d of g.doors) expect(Number.isFinite(d.x)).toBe(true)
  })
})

it('the roster ids are exactly the test table', () => {
  expect(aircraftIds().slice().sort()).toEqual(IDS)
})

it('resolves the same object every time, so callers can compare by identity', () => {
  expect(getAircraft('a320neo')).toBe(getAircraft('a320neo'))
})

it('rejects an unknown aircraft id', () => {
  expect(() => getAircraft('spruce_goose')).toThrow(ConfigError)
})

describe('seat depth', () => {
  it('is 2-2 on the E175, so the worst shuffle is aisle-blocked and never both', () => {
    const ac = getAircraft('e175')
    const row2 = Object.fromEntries(
      ac.seats.filter((s) => s.rowNumber === 2).map((s) => [s.letter, s.depth]),
    )
    expect(row2).toEqual({ A: 1, C: 1, D: 2 })
    const row10 = Object.fromEntries(
      ac.seats.filter((s) => s.rowNumber === 10).map((s) => [s.letter, s.depth]),
    )
    expect(row10).toEqual({ A: 2, B: 1, C: 1, D: 2 })
    expect(ac.maxDepth).toBe(2)
  })

  it('runs window 3 / middle 2 / aisle 1 across a 3-3 cabin', () => {
    const info = analyseLayout(['A', 'B', 'C', '|', 'D', 'E', 'F'])
    expect([...info.keys()].map((k) => info.get(k).depth)).toEqual([3, 2, 1, 1, 2, 3])
    expect(info.get('A').kind).toBe(WINDOW)
    expect(info.get('B').kind).toBe(MIDDLE)
    expect(info.get('C').kind).toBe(AISLE_SEAT)
    expect(info.get('F').kind).toBe(WINDOW)
    // Two blocks: one each side of the single aisle.
    expect(new Set([...info.values()].map((v) => v.blockId)).size).toBe(2)
  })

  it('breaks the 3-4-3 centre-block tie toward the LOWER aisle index', () => {
    const info = analyseLayout(['A', 'B', 'C', '|', 'D', 'E', 'F', 'G', '|', 'H', 'J', 'K'])
    // E and F are both two seats from a marker; E is nearer aisle 0, F nearer 1.
    expect(info.get('E').aisleIndex).toBe(0)
    expect(info.get('F').aisleIndex).toBe(1)
    // A 3-4-3 row has three bin runs and four blocks.
    expect(info.get('A').binRun).toBe(0)
    expect(info.get('E').binRun).toBe(1)
    expect(info.get('K').binRun).toBe(2)
    expect(new Set([...info.values()].map((v) => v.blockId)).size).toBe(4)
    // D and G are aisle seats even though they sit inside the centre block.
    expect(info.get('D').kind).toBe(AISLE_SEAT)
    expect(info.get('E').kind).toBe(MIDDLE)
    // Only the outboard ends of the outboard runs are windows.
    expect(info.get('A').kind).toBe(WINDOW)
    expect(info.get('K').kind).toBe(WINDOW)
  })

  it('calls a 1-2-1 outboard seat a Window even though its depth is 1', () => {
    const info = analyseLayout(['A', '|', 'D', 'G', '|', 'K'])
    expect(info.get('A').depth).toBe(1)
    expect(info.get('A').kind).toBe(WINDOW)
  })

  it('rejects a layout with no aisle', () => {
    expect(() => analyseLayout(['A', 'B'])).toThrow(ConfigError)
  })
})

describe('doors', () => {
  it('resolves the declared default set and rejects nonsense', () => {
    const ac = getAircraft('a320neo')
    expect(ac.resolveDoors(null).map((d) => d.id)).toEqual(ac.defaultDoors())
    expect(ac.resolveDoors(['1L']).map((d) => d.id)).toEqual(['1L'])
    expect(() => ac.resolveDoors(['9Z'])).toThrow(ConfigError)
    expect(() => ac.resolveDoors([])).toThrow(ConfigError)
  })

  it('orders enabled doors by the roster, not by how the caller typed them', () => {
    const ac = getAircraft('b777_300er')
    const declared = ac.doors.filter((d) => d.boardable).map((d) => d.id)
    const asked = [...declared].reverse()
    expect(ac.resolveDoors(asked).map((d) => d.id)).toEqual(declared)
  })
})

describe('monuments', () => {
  it('cost real aisle length on the 787 without adding a row slot', () => {
    const ac = getAircraft('b787_9')
    const gaps = []
    for (let i = 1; i < ac.rowSlots.length; i++) {
      gaps.push(ac.rowSlots[i].x - ac.rowSlots[i - 1].x - ac.rowSlots[i - 1].pitch)
    }
    // Three galley/lav banks are declared, so three inter-row gaps exceed pitch.
    expect(gaps.filter((g) => g > 1e-9).length).toBe(3)
  })
})
