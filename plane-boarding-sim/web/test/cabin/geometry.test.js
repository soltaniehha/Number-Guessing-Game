import { describe, it, expect } from 'vitest'
import {
  AISLE_UNITS,
  MAX_LATERAL_EXAGGERATION,
  SEAT_UNIT_M,
  buildCabinModel,
  cabinLateralUnits,
  computeAisleUnits,
  computeGeometry,
  fuselageHalfWidth,
  mapPassengersToSeats,
  splitLayout,
} from '../../src/cabin/geometry.js'
import {
  makeSingleAisleAircraft,
  makeTwinAisleAircraft,
  makeReplay,
} from '../../src/cabin/__fixtures__/makeReplay.js'

const SINGLE = makeSingleAisleAircraft()
const TWIN = makeTwinAisleAircraft()
const VIEW = { width: 1200, height: 420 }

describe('lateral layout', () => {
  it('splits a layout on the aisle marker', () => {
    expect(splitLayout(['A', 'B', 'C', '|', 'D', 'E', 'F'])).toEqual([
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
    ])
    expect(splitLayout(['A', '|', 'D', 'E', '|', 'K']).length).toBe(3)
  })

  it('puts a single aisle on the centreline', () => {
    expect(computeAisleUnits([{ layout: ['A', 'B', 'C', '|', 'D', 'E', 'F'] }], 1)).toEqual([0])
  })

  it('spaces twin aisles around the widest middle block', () => {
    const aisles = computeAisleUnits(
      [{ layout: ['A', 'B', 'C', '|', 'D', 'E', 'F', 'G', '|', 'H', 'J', 'K'] }],
      2,
    )
    expect(aisles.length).toBe(2)
    expect(aisles[0]).toBeCloseTo(-(4 / 2 + AISLE_UNITS / 2), 10)
    expect(aisles[1]).toBeCloseTo(4 / 2 + AISLE_UNITS / 2, 10)
  })

  it('lays 3-3 out symmetrically about the aisle', () => {
    const units = cabinLateralUnits(['A', 'B', 'C', '|', 'D', 'E', 'F'], [0])
    expect(units.get('C')).toBeCloseTo(-(AISLE_UNITS / 2 + 0.5), 10)
    expect(units.get('D')).toBeCloseTo(AISLE_UNITS / 2 + 0.5, 10)
    expect(units.get('A')).toBeCloseTo(-units.get('F'), 10)
    // Seats are one unit apart, in order, left to right.
    const order = ['A', 'B', 'C', 'D', 'E', 'F'].map((l) => units.get(l))
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1])
  })

  it('aligns a 1-2-1 cabin to the same aisles as 3-4-3 behind it', () => {
    const aisles = computeAisleUnits(TWIN.cabins, 2)
    const business = cabinLateralUnits(['A', '|', 'D', 'E', '|', 'K'], aisles)
    const economy = cabinLateralUnits(
      ['A', 'B', 'C', '|', 'D', 'E', 'F', 'G', '|', 'H', 'J', 'K'],
      aisles,
    )
    // Business D/E straddle the centreline, economy D..G fill the middle block.
    expect(business.get('D')).toBeCloseTo(-0.5, 10)
    expect(business.get('E')).toBeCloseTo(0.5, 10)
    expect(economy.get('D')).toBeCloseTo(aisles[0] + AISLE_UNITS / 2 + 0.5, 10)
    expect(economy.get('K')).toBeCloseTo(aisles[1] + AISLE_UNITS / 2 + 2.5, 10)
  })
})

describe('buildCabinModel', () => {
  it('produces a believable single-aisle cross-section', () => {
    const model = buildCabinModel(SINGLE)
    // 3-3 at 0.46 m per seat unit lands near a real 737/A320 tube.
    expect(model.halfWidthM * 2).toBeGreaterThan(3.4)
    expect(model.halfWidthM * 2).toBeLessThan(4.2)
    expect(model.aisleUnits).toEqual([0])
    expect(model.cabinStartM).toBeGreaterThan(0)
    expect(model.cabinEndM).toBeGreaterThan(model.cabinStartM)
    expect(model.lengthM).toBeGreaterThan(model.cabinEndM)
  })

  it('produces a believable twin-aisle cross-section', () => {
    const model = buildCabinModel(TWIN)
    expect(model.halfWidthM * 2).toBeGreaterThan(5.6)
    expect(model.halfWidthM * 2).toBeLessThan(6.8)
    expect(model.aisleUnits.length).toBe(2)
  })
})

describe('computeGeometry', () => {
  it('places every seat at a finite position inside the fuselage', () => {
    const geom = computeGeometry(SINGLE, VIEW)
    expect(geom.seatU.length).toBe(SINGLE.seats.length)
    for (let i = 0; i < geom.seatU.length; i++) {
      expect(Number.isFinite(geom.seatU[i])).toBe(true)
      expect(Math.abs(geom.seatV[i])).toBeLessThan(geom.halfV)
      expect(geom.seatW[i]).toBeGreaterThan(0)
      expect(geom.seatH[i]).toBeGreaterThan(0)
    }
  })

  it('never exaggerates the cross-section beyond the cap', () => {
    const geom = computeGeometry(SINGLE, { width: 800, height: 2000 })
    expect(geom.scaleLat / geom.scaleLon).toBeLessThanOrEqual(MAX_LATERAL_EXAGGERATION + 1e-9)
    expect(geom.scaleLat).toBeGreaterThanOrEqual(geom.scaleLon - 1e-9)
  })

  it('shrinks both axes rather than clipping in a shallow viewport', () => {
    const geom = computeGeometry(SINGLE, { width: 4000, height: 60 })
    expect(geom.scaleLat).toBeCloseTo(geom.scaleLon, 9)
    expect(geom.lengthPx).toBeLessThanOrEqual(4000)
  })

  it('gives each aisle its own lane, twin-aisle included', () => {
    expect(computeGeometry(SINGLE, VIEW).laneV.length).toBe(1)
    const twin = computeGeometry(TWIN, VIEW)
    expect(twin.laneV.length).toBe(2)
    expect(twin.laneV[0]).toBeLessThan(0)
    expect(twin.laneV[1]).toBeGreaterThan(0)
  })

  it('rotates to vertical by transposing the projection', () => {
    const h = computeGeometry(SINGLE, { ...VIEW, orientation: 'horizontal' })
    const v = computeGeometry(SINGLE, { width: 420, height: 1200, orientation: 'vertical' })
    expect(h.toScreen(100, 20)).toEqual({ x: h.originX + 100, y: h.originY + 20 })
    expect(v.toScreen(100, 20)).toEqual({ x: v.originX + 20, y: v.originY + 100 })
    // Nose is at the top when vertical: increasing u goes down the screen.
    expect(v.toScreen(200, 0).y).toBeGreaterThan(v.toScreen(0, 0).y)
  })

  it('round-trips screen coordinates back to plan space in both orientations', () => {
    for (const orientation of ['horizontal', 'vertical']) {
      const geom = computeGeometry(SINGLE, { ...VIEW, orientation })
      const { x, y } = geom.toScreen(137, -42)
      const plan = geom.toPlan(x, y)
      expect(plan.u).toBeCloseTo(137, 9)
      expect(plan.v).toBeCloseTo(-42, 9)
    }
  })

  it('anchors doors to the skin and gives each a non-overlapping queue lane', () => {
    const twin = computeGeometry(TWIN, VIEW)
    expect(twin.doors.length).toBe(TWIN.doors.length)
    const [d1, d2] = twin.doors
    expect(d1.side).toBe(-1) // aisle 0 -> port edge
    expect(d2.side).toBe(1) // aisle 1 -> starboard edge
    expect(Math.abs(d1.laneV)).toBeGreaterThan(twin.halfV)
    for (const door of twin.doors) expect(door.laneLength).toBeGreaterThan(0)

    // Two doors on the same side must not share lane space: the forward one
    // trails aft, the rear one trails forward, and the two never meet.
    const single = computeGeometry(SINGLE, VIEW)
    const [a, b] = single.doors
    expect(a.side).toBe(b.side)
    expect(a.laneDir).toBe(1)
    expect(b.laneDir).toBe(-1)
    expect(a.u + a.laneLength).toBeLessThanOrEqual(b.u + 1e-6)
    expect(b.u - b.laneLength).toBeGreaterThanOrEqual(a.u - 1e-6)
  })

  it('drops labels rather than crushing them at small sizes', () => {
    const tiny = computeGeometry(SINGLE, { width: 260, height: 90 })
    const big = computeGeometry(SINGLE, { width: 1600, height: 700 })
    expect(tiny.showLetters).toBe(false)
    expect(tiny.rowNumberStride).toBe(0)
    expect(big.showLetters).toBe(true)
    expect(big.rowNumberStride).toBeGreaterThan(0)
  })
})

describe('fuselageHalfWidth', () => {
  it('is zero at the tips, full through the cabin, and never negative', () => {
    const geom = computeGeometry(SINGLE, VIEW)
    expect(fuselageHalfWidth(geom, 0)).toBe(0)
    expect(fuselageHalfWidth(geom, geom.lengthPx)).toBe(0)
    expect(fuselageHalfWidth(geom, (geom.cabinU0 + geom.cabinU1) / 2)).toBeCloseTo(geom.halfV, 9)
    for (let u = 0; u <= geom.lengthPx; u += geom.lengthPx / 200) {
      const h = fuselageHalfWidth(geom, u)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(geom.halfV + 1e-9)
    }
  })

  it('widens monotonically through the nose', () => {
    const geom = computeGeometry(SINGLE, VIEW)
    let previous = -1
    for (let u = 0; u < geom.noseEndU; u += geom.noseEndU / 40) {
      const h = fuselageHalfWidth(geom, u)
      expect(h).toBeGreaterThanOrEqual(previous)
      previous = h
    }
  })
})

describe('mapPassengersToSeats', () => {
  it('resolves every passenger to their own seat', () => {
    for (const kind of ['single', 'twin']) {
      const replay = makeReplay({ aircraft: kind })
      const geom = computeGeometry(replay.aircraft, VIEW)
      const index = mapPassengersToSeats(geom, replay.passengers)
      expect(index.length).toBe(replay.passengers.length)
      for (let i = 0; i < index.length; i++) {
        const seat = replay.aircraft.seats[index[i]]
        expect(seat.rowNumber).toBe(replay.passengers[i].seatRow)
        expect(seat.letter).toBe(replay.passengers[i].seatLetter)
        // The dot must land on the seat, not merely in the right row.
        expect(geom.seatU[index[i]]).toBeCloseTo(replay.passengers[i].seatX * geom.scaleLon, 3)
      }
    }
  })

  it('agrees with the seat unit constant', () => {
    const geom = computeGeometry(SINGLE, VIEW)
    const a = geom.seatIndexByRowLetter.get('20:A')
    const b = geom.seatIndexByRowLetter.get('20:B')
    expect(Math.abs(geom.seatV[a] - geom.seatV[b])).toBeCloseTo(SEAT_UNIT_M * geom.scaleLat, 4)
  })
})

describe('door enablement', () => {
  it("accepts ENGINE_SPEC's defaultEnabled spelling and defaults to enabled", () => {
    const aircraft = {
      ...SINGLE,
      doors: [
        { id: 'a', name: 'a', x: 8, aisleIndex: 0, kind: 'jetbridge', defaultEnabled: true },
        { id: 'b', name: 'b', x: 14, aisleIndex: 0, kind: 'jetbridge', defaultEnabled: false },
        { id: 'c', name: 'c', x: 20, aisleIndex: 0, kind: 'jetbridge' },
      ],
    }
    expect(computeGeometry(aircraft, VIEW).doors.map((d) => d.enabled)).toEqual([
      true, false, true,
    ])
  })

  it('lets an explicit id list override every door flag', () => {
    const geom = computeGeometry(SINGLE, { ...VIEW, enabledDoorIds: ['2L'] })
    expect(geom.doors.map((d) => [d.id, d.enabled])).toEqual([['1L', false], ['2L', true]])
  })
})
