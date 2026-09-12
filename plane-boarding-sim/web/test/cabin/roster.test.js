// @vitest-environment jsdom
/**
 * The cabin renderer against the REAL roster.
 *
 * Every other test in this directory runs on `__fixtures__/makeReplay.js`,
 * which is the right default -- the renderer is meant to stand on its own. But
 * a fixture is only as honest as whoever wrote it, and this one was not: it
 * left 6.2 m of nose in front of row 1 and bolted a 9-13 m tail onto
 * `lengthM`, neither of which `geometryPayload` has. So door 1L -- which the
 * engine places half a row pitch AHEAD of row 1, at a negative x -- landed
 * comfortably inside the canvas in the tests and entirely off its leading edge
 * in the app, on all six airframes at once.
 *
 * These tests read `src/sim`'s own geometry payload, so the thing under test
 * is the aeroplane the user actually sees.
 */
import { describe, it, expect } from 'vitest'
import { aircraftIds, geometryPayload, getAircraft } from '../../src/sim/index.js'
import {
  buildCabinModel,
  computeGeometry,
  doorGlyphSizePx,
  fuselageHalfWidth,
  queueBadgeSizePx,
} from '../../src/cabin/geometry.js'
import { drawDynamicLayer, drawStaticLayer, makeScratch } from '../../src/cabin/draw.js'
import { STATE } from '../../src/cabin/playback.js'
import { readTokens } from '../../src/cabin/tokens.js'
import { callsOf, makeStubContext } from './stubContext.js'

const ROSTER = aircraftIds().map((id) => geometryPayload(getAircraft(id)))

const VIEWPORTS = [
  ['desktop horizontal', { width: 1280, height: 460, orientation: 'horizontal' }],
  ['phone vertical', { width: 380, height: 760, orientation: 'vertical' }],
  ['squat strip', { width: 900, height: 96, orientation: 'horizontal' }],
]

/** The most forward boardable door -- 1L on every airframe in the roster. */
function forwardDoorOf(aircraft) {
  return aircraft.doors
    .filter((d) => d.boardable !== false)
    .reduce((best, d) => (best === null || d.x < best.x ? d : best), null)
}

/**
 * Project the aeroplane with the forward door switched on, whatever the
 * roster's default is (the 787-9 boards through 2L by default).
 */
function project(aircraft, viewport) {
  const model = buildCabinModel(aircraft)
  const forward = forwardDoorOf(aircraft)
  const enabled = aircraft.doors
    .filter((d) => d.id === forward.id || d.defaultEnabled)
    .map((d) => d.id)
  const geom = computeGeometry(aircraft, { ...viewport, padding: 14, model, enabledDoorIds: enabled })
  return { model, geom, door: geom.doors.find((d) => d.id === forward.id) }
}

/**
 * One frame with the whole aeroplane still queued, split between the enabled
 * doors by which one is nearest -- the worst case for every lane at once.
 */
function paintQueuedFrame(aircraft, viewport) {
  const { model, geom, door } = project(aircraft, viewport)
  const lanes = geom.laneV.length
  const open = geom.doors.filter((d) => d.enabled)
  const nearest = (x) => {
    const u = geom.planU(x)
    return open.reduce((a, b) => (Math.abs(b.u - u) < Math.abs(a.u - u) ? b : a)).id
  }
  const passengers = aircraft.seats.map((seat, i) => ({
    id: i,
    seatRow: seat.rowNumber,
    seatLetter: seat.letter,
    seatX: seat.x,
    lane: Math.min(lanes - 1, seat.aisleIndex || 0),
    doorId: nearest(seat.x),
  }))
  const n = passengers.length
  const scratch = makeScratch(n, geom.rows.length, lanes, geom.doors.length)
  const ctx = makeStubContext()
  drawDynamicLayer(
    ctx,
    geom,
    readTokens(),
    1,
    {
      replay: { passengers },
      x: new Float32Array(n),
      state: new Int8Array(n).fill(STATE.QUEUED),
      trailX: null,
      seatIndex: new Int32Array(n),
      showQueue: true,
      showHeat: false,
      hoveredId: -1,
    },
    scratch,
  )
  return { model, geom, door, ctx, scratch, open }
}

describe('the roster has a nose, and row 1 is behind it', () => {
  for (const aircraft of ROSTER) {
    it(`${aircraft.id} puts real metres of aeroplane ahead of row 1`, () => {
      const model = buildCabinModel(aircraft)
      // The payload's own datum: row 1 at x = 0, the forward door ahead of it.
      expect(aircraft.rowSlots[0].x).toBe(0)
      expect(forwardDoorOf(aircraft).x).toBeLessThan(0)

      // ...which the renderer answers with a nose, a tail and an origin shift.
      expect(model.noseM).toBeGreaterThanOrEqual(4)
      expect(model.tailM).toBeGreaterThan(model.noseM)
      expect(model.originM).toBeLessThan(0)
      expect(model.lengthM).toBeGreaterThan(model.cabinLengthM + 8)
      // Nose and tail are sized off the tube, so a widebody gets more of both.
      expect(model.noseM / model.halfWidthM).toBeCloseTo(3.4, 6)

      const geom = computeGeometry(aircraft, { ...VIEWPORTS[0][1], padding: 14, model })
      // The whole aeroplane, nose tip to tail tip, is on the canvas...
      expect(geom.lengthPx).toBeLessThanOrEqual(geom.width - 2 * geom.padding + 1e-6)
      // ...the nose tapers ahead of the cabin, rather than starting behind it
      // (`noseEndU` used to come out NEGATIVE, which is what drew a box)...
      expect(geom.noseEndU).toBeGreaterThan(0)
      expect(geom.noseEndU).toBeLessThan(geom.cabinU0)
      // ...every row, the first included, is aft of the nose...
      for (const row of geom.rows) expect(row.u).toBeGreaterThan(geom.noseEndU)
      // ...and the tail is a cone, not the 0.4 m stub `lengthM` implies.
      expect(geom.lengthPx - geom.tailStartU).toBeGreaterThan(geom.halfV)

      // The nose widens from a blunt tip to the full tube by `noseEndU`.
      expect(fuselageHalfWidth(geom, 0)).toBe(0)
      expect(fuselageHalfWidth(geom, geom.noseEndU * 0.5)).toBeLessThan(geom.halfV)
      expect(fuselageHalfWidth(geom, geom.cabinU0)).toBeCloseTo(geom.halfV, 9)
      // Every door, forward one included, is anchored to full-width skin.
      for (const door of geom.doors) {
        expect(fuselageHalfWidth(geom, door.u), door.id).toBeCloseTo(geom.halfV, 9)
      }
    })
  }
})

describe('the forward door is drawn in full, on every airframe', () => {
  for (const aircraft of ROSTER) {
    for (const [name, viewport] of VIEWPORTS) {
      it(`${aircraft.id} on ${name}`, () => {
        const { geom, door, ctx, scratch, open } = paintQueuedFrame(aircraft, viewport)
        expect(door.enabled).toBe(true)
        const queued = scratch.queueCount[geom.doors.indexOf(door)]
        expect(queued, `${aircraft.id}: nobody queued at ${door.id}`).toBeGreaterThan(3)

        const onCanvas = (x, y, what) => {
          expect(x, `${aircraft.id}/${name}: ${what} x`).toBeGreaterThanOrEqual(0)
          expect(x, `${aircraft.id}/${name}: ${what} x`).toBeLessThanOrEqual(geom.width)
          expect(y, `${aircraft.id}/${name}: ${what} y`).toBeGreaterThanOrEqual(0)
          expect(y, `${aircraft.id}/${name}: ${what} y`).toBeLessThanOrEqual(geom.height)
        }
        const plan = (u, v, what) => {
          const { x, y } = geom.toScreen(u, v)
          onCanvas(x, y, what)
        }

        // --- the doorway and the chevron, as `drawDoors` lays them out ------
        const glyph = doorGlyphSizePx(geom.halfV)
        const skin = fuselageHalfWidth(geom, door.u) || geom.halfV
        const v = door.side * skin
        plan(door.u - glyph * 0.62, v, 'doorway fore')
        plan(door.u + glyph * 0.62, v, 'doorway aft')
        plan(door.u - glyph * 0.5, v + door.side * glyph * 0.92, 'chevron fore')
        plan(door.u + glyph * 0.5, v + door.side * glyph * 0.92, 'chevron aft')

        // --- the jet-bridge stub, from the skin out to the lane ------------
        plan(door.u, door.laneV, 'jet-bridge stub')
        plan(door.u, door.laneV - door.side * geom.queueHalfExtent, 'lane outboard edge')

        // --- every queue dot ------------------------------------------------
        const dots = callsOf(ctx, 'arc').filter((c) => Math.abs(c.args[1] - door.laneV) < 0.01)
        expect(dots.length, `${aircraft.id}/${name}: no queue drawn`).toBeGreaterThan(3)
        for (const dot of dots) {
          const r = dot.args[2]
          plan(dot.args[0] - r, dot.args[1] - r, 'queue dot')
          plan(dot.args[0] + r, dot.args[1] + r, 'queue dot')
        }

        // --- the count pills, box and all -----------------------------------
        // The stub measures 6 px a character, the same arithmetic the painter
        // does. Screen space: the pill is drawn with the transform reset. No
        // clamp is involved any more -- the geometry has to put them on the
        // canvas by itself.
        const size = queueBadgeSizePx(geom.halfV)
        const pills = callsOf(ctx, 'fillText')
        expect(pills.length).toBe(open.length)
        expect(pills.map((c) => Number(c.args[0]))).toContain(queued)
        for (const [label, px, py] of pills.map((c) => c.args)) {
          const w = String(label).length * 6 + size * 1.1
          const h = size * 1.6
          onCanvas(px - w / 2, py - h / 2, `count pill ${label}`)
          onCanvas(px + w / 2, py + h / 2, `count pill ${label}`)
        }
      })
    }
  }
})

describe('the row-number gutter clears every queue, on the real roster', () => {
  /**
   * The widebodies are where this bites: 787-9 rows 20-21 and 777-300ER rows
   * 14-15 once sat underneath door 2L's queue dots and its count pill.
   * `queueLaneOffset` reserves the label gutter before it places the lane, and
   * that has to keep holding now the aeroplane -- and therefore the row pitch
   * -- has changed. Compared in PLAN space so the vertical layout, where the
   * two axes swap, is held to the same contract.
   */
  for (const aircraft of ROSTER) {
    for (const [name, viewport] of VIEWPORTS) {
      it(`${aircraft.id} on ${name}`, () => {
        const { geom } = project(aircraft, viewport)
        if (!geom.rowNumberStride) return
        const ctx = makeStubContext()
        drawStaticLayer(ctx, geom, readTokens(), 1)
        const size = geom.rowLabelSize
        const labels = callsOf(ctx, 'fillText')
          .filter((c) => /^\d+$/.test(String(c.args[0])))
          .map((c) => {
            const [text, x, y] = c.args
            const { u, v } = geom.toPlan(x, y)
            const w = String(text).length * 6
            return { text, u0: u - w / 2, u1: u + w / 2, v0: v - size * 0.6, v1: v + size * 0.6 }
          })
        expect(labels.length).toBeGreaterThan(0)

        const badge = geom.queueBadgeSize
        for (const door of geom.doors) {
          const tail = (door.laneDir || 1) * door.laneLength
          const spans = [
            { half: geom.queueHalfExtent, a: 0, b: tail },
            { half: badge * 0.8, a: -badge * 3.4, b: badge * 3.4 },
            { half: badge * 0.8, a: tail - badge * 3.4, b: tail + badge * 3.4 },
          ]
          for (const span of spans) {
            const u0 = door.u + Math.min(span.a, span.b)
            const u1 = door.u + Math.max(span.a, span.b)
            const v0 = door.laneV - span.half
            const v1 = door.laneV + span.half
            for (const label of labels) {
              const hit = label.u0 < u1 && label.u1 > u0 && label.v0 < v1 && label.v1 > v0
              expect(hit, `row ${label.text} collides with door ${door.id}`).toBe(false)
            }
          }
        }
      })
    }
  }
})
