import { describe, it, expect } from 'vitest'
import {
  AIRCRAFT_BUILDERS,
  laneAssignment,
  makeReplay,
  makeSingleAisleAircraft,
  makeTwinAisleAircraft,
} from '../../src/cabin/__fixtures__/makeReplay.js'
import { STATE, replayDuration } from '../../src/cabin/playback.js'

describe('aircraft fixtures', () => {
  it('builds a 180-seat 3-3 single-aisle aeroplane', () => {
    const a = makeSingleAisleAircraft()
    expect(a.aisleCount).toBe(1)
    expect(a.seats.length).toBe(180)
    expect(a.rowSlots.length).toBe(31)
    expect(a.rowSlots.some((r) => r.rowNumber === 13)).toBe(false) // 13 is skipped
    expect(a.rowSlots.some((r) => r.isExitRow)).toBe(true)
    expect(a.doors.filter((d) => d.enabled).length).toBe(1)
    expect(a.lengthM).toBeGreaterThan(a.rowSlots[a.rowSlots.length - 1].x)
  })

  it('builds a 3-4-3 twin-aisle aeroplane with three cabins', () => {
    const a = makeTwinAisleAircraft()
    expect(a.aisleCount).toBe(2)
    expect(a.seats.length).toBe(324)
    expect(a.cabins.map((c) => c.classKey)).toEqual(['business', 'premium', 'economy'])
    expect(a.doors.filter((d) => d.enabled).length).toBe(2)
    expect(a.doors.some((d) => !d.enabled)).toBe(true) // a hollow door to draw
    expect(new Set(a.seats.map((s) => s.lane))).toEqual(new Set([0, 1]))
  })

  /**
   * The fixtures used to leave 6.2 m of nose in front of row 1 and bolt a
   * 9-13 m tail onto `lengthM`. Neither exists in `geometryPayload`, and the
   * pair of them hid the defect these tests are meant to catch: a forward
   * door, which the real payload puts at a NEGATIVE x, sat comfortably inside
   * the canvas here and off its leading edge in the app.
   */
  it('measures x from row 1 and reports the CABIN as lengthM, like the payload', () => {
    for (const build of Object.values(AIRCRAFT_BUILDERS)) {
      const a = build()
      const rows = a.rowSlots
      const last = rows[rows.length - 1]
      expect(rows[0].x, `${a.id}: row 1 is the datum`).toBe(0)
      // `aircraft.js`: length = the x cursor after the last row.
      expect(a.lengthM, `${a.id}: lengthM is the cabin`).toBeCloseTo(last.x + last.pitchM, 4)
      // ...so there is no nose in it, and no tail cone either.
      expect(a.lengthM).toBeLessThan(last.x + last.pitchM * 1.5)
      const forward = a.doors.slice().sort((x, y) => x.x - y.x)[0]
      expect(forward.x, `${a.id}: the forward door is ahead of row 1`).toBeLessThan(0)
    }
  })

  it('rows ascend monotonically in x, which the heat accumulator relies on', () => {
    for (const build of Object.values(AIRCRAFT_BUILDERS)) {
      const rows = build().rowSlots
      for (let i = 1; i < rows.length; i++) expect(rows[i].x).toBeGreaterThan(rows[i - 1].x)
    }
  })

  it('assigns lane, depth and block per ENGINE_SPEC 2.1', () => {
    const single = laneAssignment(['A', 'B', 'C', '|', 'D', 'E', 'F'])
    expect(single.get('C')).toEqual({ lane: 0, depth: 1, side: 0 }) // aisle seat
    expect(single.get('B')).toEqual({ lane: 0, depth: 2, side: 0 }) // middle
    expect(single.get('A')).toEqual({ lane: 0, depth: 3, side: 0 }) // window
    expect(single.get('D')).toEqual({ lane: 0, depth: 1, side: 1 })

    const twin = laneAssignment(['A', 'B', 'C', '|', 'D', 'E', 'F', 'G', '|', 'H', 'J', 'K'])
    expect(twin.get('D')).toEqual({ lane: 0, depth: 1, side: 1 })
    expect(twin.get('E')).toEqual({ lane: 0, depth: 2, side: 1 })
    expect(twin.get('F')).toEqual({ lane: 1, depth: 2, side: 1 })
    expect(twin.get('G')).toEqual({ lane: 1, depth: 1, side: 1 })
    expect(twin.get('H')).toEqual({ lane: 1, depth: 1, side: 2 })
  })
})

describe('makeReplay', () => {
  it('is deterministic for the same options', () => {
    const a = makeReplay({ aircraft: 'single', seed: 7 })
    const b = makeReplay({ aircraft: 'single', seed: 7 })
    expect(a.frameCount).toBe(b.frameCount)
    expect(Array.from(a.frames.x[10])).toEqual(Array.from(b.frames.x[10]))
    expect(a.passengers).toEqual(b.passengers)
  })

  it('changes with the seed', () => {
    const a = makeReplay({ aircraft: 'single', seed: 1 })
    const b = makeReplay({ aircraft: 'single', seed: 2 })
    expect(a.duration).not.toBe(b.duration)
  })

  it('emits the Replay shape the renderer expects', () => {
    const r = makeReplay({ aircraft: 'twin' })
    expect(r.frameInterval).toBe(0.25)
    expect(r.frames.x.length).toBe(r.frameCount)
    expect(r.frames.state.length).toBe(r.frameCount)
    expect(r.frames.x[0]).toBeInstanceOf(Float32Array)
    expect(r.frames.state[0]).toBeInstanceOf(Int8Array)
    expect(replayDuration(r)).toBeCloseTo(r.duration, 6)
    for (const p of r.passengers) {
      expect(typeof p.seatRow).toBe('number')
      expect(typeof p.seatLetter).toBe('string')
      expect(p.seatX).toBeGreaterThanOrEqual(0) // row 1 sits on the datum
      expect(p.seatDepth).toBeGreaterThanOrEqual(1)
      expect(p.lane).toBeGreaterThanOrEqual(0)
      expect(p.bags).toBeGreaterThanOrEqual(0)
      expect(p.party).toBeGreaterThanOrEqual(1)
      expect(p.doorId).toBeTruthy()
    }
  })

  it('can emit plain arrays instead of typed arrays', () => {
    const r = makeReplay({ aircraft: 'single', typedFrames: false, loadFactor: 0.2 })
    expect(Array.isArray(r.frames.x[0])).toBe(true)
  })

  it('boards everybody: all queued at t=0, all seated at the end', () => {
    for (const kind of ['single', 'twin']) {
      const r = makeReplay({ aircraft: kind })
      const first = r.frames.state[0]
      const last = r.frames.state[r.frameCount - 1]
      for (let i = 0; i < r.passengers.length; i++) {
        expect(first[i]).toBe(STATE.QUEUED)
        expect(last[i]).toBe(STATE.SEATED)
      }
    }
  })

  it('never lets a passenger walk past their own seat', () => {
    const r = makeReplay({ aircraft: 'single' })
    for (let f = 0; f < r.frameCount; f += 7) {
      const xs = r.frames.x[f]
      for (let i = 0; i < r.passengers.length; i++) {
        expect(xs[i]).toBeLessThanOrEqual(r.passengers[i].seatX + 1e-3)
      }
    }
  })

  it('moves passengers monotonically aft while walking', () => {
    const r = makeReplay({ aircraft: 'single' })
    for (let f = 1; f < r.frameCount; f++) {
      const prev = r.frames.x[f - 1]
      const now = r.frames.x[f]
      for (let i = 0; i < r.passengers.length; i++) {
        if (r.frames.state[f - 1][i] === STATE.QUEUED) continue
        expect(now[i]).toBeGreaterThanOrEqual(prev[i] - 1e-4)
      }
    }
  })

  it('splits passengers between doors on the twin-aisle aeroplane', () => {
    const r = makeReplay({ aircraft: 'twin' })
    const byDoor = new Map()
    for (const p of r.passengers) byDoor.set(p.doorId, (byDoor.get(p.doorId) || 0) + 1)
    expect(byDoor.size).toBe(2)
    for (const count of byDoor.values()) expect(count).toBeGreaterThan(20)
  })

  it('gives a plausible boarding time', () => {
    const r = makeReplay({ aircraft: 'single' })
    expect(r.duration).toBeGreaterThan(180)
    expect(r.duration).toBeLessThan(2400)
    expect(r.result.paxCount).toBe(r.passengers.length)
    expect(r.result.seatedCurve[0].seated).toBe(0)
    expect(r.result.seatedCurve.at(-1).seated).toBeGreaterThan(0)
  })

  it('supports every strategy and honours the load factor', () => {
    for (const strategy of ['random', 'back_to_front', 'wilma']) {
      const r = makeReplay({ aircraft: 'single', strategy, loadFactor: 0.5 })
      expect(r.strategy).toBe(strategy)
      expect(r.passengers.length).toBe(90)
      expect(new Set(r.passengers.map((p) => p.groupLabel)).size).toBeGreaterThan(0)
    }
  })
})

describe('door configuration', () => {
  it('honours an explicit door list', () => {
    const r = makeReplay({ aircraft: 'single', doors: ['1L', '2L'] })
    expect(r.aircraft.doors.filter((d) => d.enabled).map((d) => d.id)).toEqual(['1L', '2L'])
    // The rear door sits behind every seat, so everybody still boards at 1L —
    // the renderer must cope with an enabled door that has no queue.
    const used = new Set(r.passengers.map((p) => p.doorId))
    expect(used.has('1L')).toBe(true)
  })

  it('falls back to the first door when none are enabled', () => {
    const r = makeReplay({ aircraft: 'single', doors: [] })
    expect(new Set(r.passengers.map((p) => p.doorId))).toEqual(new Set(['1L']))
  })
})
