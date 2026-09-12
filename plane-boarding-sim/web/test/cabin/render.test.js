// @vitest-environment jsdom
import { beforeAll, describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { computeGeometry, mapPassengersToSeats } from '../../src/cabin/geometry.js'
import {
  drawDynamicLayer,
  drawStaticLayer,
  hitTest,
  makeScratch,
} from '../../src/cabin/draw.js'
import { STATE, frameCursor, replayDuration } from '../../src/cabin/playback.js'
import { readTokens } from '../../src/cabin/tokens.js'
import { makeReplay } from '../../src/cabin/__fixtures__/makeReplay.js'
import { callsOf, makeStubContext } from './stubContext.js'

const THEME_CSS = readFileSync(resolve(process.cwd(), 'src/theme.css'), 'utf8')

beforeAll(() => {
  const style = document.createElement('style')
  style.textContent = THEME_CSS
  document.head.appendChild(style)
})

/** Sample the replay at `t` the same way CabinView does. */
function sample(replay, t, scratch) {
  const n = replay.passengers.length
  const { i0, i1, alpha } = frameCursor(t, replay.frameInterval, replay.frameCount)
  const x0 = replay.frames.x[i0]
  const x1 = replay.frames.x[i1]
  const st = replay.frames.state[i0]
  for (let i = 0; i < n; i++) {
    scratch.px[i] = x0[i] + (x1[i] - x0[i]) * alpha
    scratch.trail[i] = scratch.px[i] - 0.4
    scratch.pstate[i] = st[i]
  }
  return scratch
}

function setup(kind, viewport, options = {}) {
  const replay = makeReplay({ aircraft: kind, ...options })
  const geom = computeGeometry(replay.aircraft, viewport)
  const scratch = makeScratch(
    replay.passengers.length,
    geom.rows.length,
    geom.laneV.length,
    geom.doors.length,
  )
  const seatIndex = mapPassengersToSeats(geom, replay.passengers)
  return { replay, geom, scratch, seatIndex }
}

const VIEWPORTS = [
  ['desktop horizontal', { width: 1280, height: 460, orientation: 'horizontal' }],
  ['phone vertical', { width: 380, height: 760, orientation: 'vertical' }],
  ['squat strip', { width: 900, height: 96, orientation: 'horizontal' }],
]

describe('drawStaticLayer', () => {
  for (const kind of ['single', 'twin']) {
    for (const [name, viewport] of VIEWPORTS) {
      it(`paints the ${kind}-aisle aeroplane on ${name} without producing NaN`, () => {
        const { geom } = setup(kind, viewport)
        const ctx = makeStubContext()
        const tokens = readTokens()
        expect(() => drawStaticLayer(ctx, geom, tokens, 2)).not.toThrow()
        expect(ctx.bad).toEqual([])
        expect(ctx.calls.length).toBeGreaterThan(100)
        // The fuselage outline, the seats and the doors all got painted.
        expect(callsOf(ctx, 'bezierCurveTo').length).toBeGreaterThanOrEqual(4)
        expect(callsOf(ctx, 'fill').length).toBeGreaterThan(10)
      })
    }
  }

  it('scales the backing store by devicePixelRatio', () => {
    const { geom } = setup('single', VIEWPORTS[0][1])
    const ctx = makeStubContext()
    drawStaticLayer(ctx, geom, readTokens(), 3)
    const first = callsOf(ctx, 'setTransform')[0]
    expect(first.args.slice(0, 4)).toEqual([3, 0, 0, 3])
  })

  it('transposes the transform when vertical', () => {
    const { geom } = setup('single', VIEWPORTS[1][1])
    const ctx = makeStubContext()
    drawStaticLayer(ctx, geom, readTokens(), 1)
    const plan = callsOf(ctx, 'setTransform').find(
      (c) => c.args[0] === 0 && c.args[1] === 1 && c.args[2] === 1,
    )
    expect(plan).toBeDefined()
  })
})

describe('drawDynamicLayer', () => {
  for (const kind of ['single', 'twin']) {
    it(`paints ${kind}-aisle passengers across the whole timeline`, () => {
      const { replay, geom, scratch, seatIndex } = setup(kind, VIEWPORTS[0][1])
      const tokens = readTokens()
      const duration = replayDuration(replay)
      for (const f of [0, 0.1, 0.25, 0.4, 0.75, 1]) {
        const t = duration * f
        sample(replay, t, scratch)
        const ctx = makeStubContext()
        const tally = drawDynamicLayer(
          ctx,
          geom,
          tokens,
          2,
          {
            replay,
            x: scratch.px,
            state: scratch.pstate,
            trailX: scratch.trail,
            seatIndex,
            showQueue: true,
            showHeat: true,
            hoveredId: 3,
          },
          scratch,
        )
        expect(ctx.bad, `NaN at t=${t}`).toEqual([])
        let total = 0
        for (const n of tally) total += n
        expect(total).toBe(replay.passengers.length)
      }
    })
  }

  it('seats everyone by the end and queues everyone at the start', () => {
    const { replay, geom, scratch, seatIndex } = setup('single', VIEWPORTS[0][1])
    const tokens = readTokens()
    const frame = (t) => {
      sample(replay, t, scratch)
      return drawDynamicLayer(
        makeStubContext(), geom, tokens, 1,
        { replay, x: scratch.px, state: scratch.pstate, trailX: null, seatIndex,
          showQueue: true, showHeat: true, hoveredId: -1 },
        scratch,
      )
    }
    expect(frame(0)[STATE.QUEUED]).toBe(replay.passengers.length)
    expect(frame(replayDuration(replay))[STATE.SEATED]).toBe(replay.passengers.length)
  })

  it('honours the showQueue and showHeat switches', () => {
    const { replay, geom, scratch, seatIndex } = setup('single', VIEWPORTS[0][1])
    const tokens = readTokens()
    sample(replay, replayDuration(replay) * 0.3, scratch)
    const base = {
      replay, x: scratch.px, state: scratch.pstate, trailX: null, seatIndex, hoveredId: -1,
    }
    const on = makeStubContext()
    drawDynamicLayer(on, geom, tokens, 1, { ...base, showQueue: true, showHeat: true }, scratch)
    const off = makeStubContext()
    drawDynamicLayer(off, geom, tokens, 1, { ...base, showQueue: false, showHeat: false }, scratch)
    expect(off.calls.length).toBeLessThan(on.calls.length)
    expect(callsOf(off, 'fillText').length).toBe(0)
    expect(callsOf(on, 'fillText').length).toBeGreaterThan(0)
  })

  it('keeps every jet-bridge dot inside its lane, even at full load', () => {
    const { replay, geom, scratch, seatIndex } = setup('single', VIEWPORTS[0][1], {
      loadFactor: 1,
    })
    // t=0: everybody is queued at door 1L.
    sample(replay, 0, scratch)
    const ctx = makeStubContext()
    drawDynamicLayer(
      ctx, geom, readTokens(), 1,
      { replay, x: scratch.px, state: scratch.pstate, trailX: null, seatIndex,
        showQueue: true, showHeat: false, hoveredId: -1 },
      scratch,
    )
    const door = geom.doors.find((d) => d.enabled)
    const arcs = callsOf(ctx, 'arc').filter((c) => Math.abs(c.args[1] - door.laneV) < 0.01)
    expect(arcs.length).toBeGreaterThan(20)
    for (const arc of arcs) {
      expect(arc.args[0]).toBeGreaterThanOrEqual(door.u - 0.01)
      expect(arc.args[0]).toBeLessThanOrEqual(door.u + door.laneLength + 0.01)
    }
  })

  it('draws motion trails only when given a trail buffer', () => {
    const { replay, geom, scratch, seatIndex } = setup('single', VIEWPORTS[0][1])
    const tokens = readTokens()
    sample(replay, replayDuration(replay) * 0.25, scratch)
    const base = {
      replay, x: scratch.px, state: scratch.pstate, seatIndex,
      showQueue: false, showHeat: false, hoveredId: -1,
    }
    const withTrail = makeStubContext()
    drawDynamicLayer(withTrail, geom, tokens, 1, { ...base, trailX: scratch.trail }, scratch)
    const without = makeStubContext()
    drawDynamicLayer(without, geom, tokens, 1, { ...base, trailX: null }, scratch)
    expect(callsOf(withTrail, 'lineTo').length).toBeGreaterThan(
      callsOf(without, 'lineTo').length,
    )
  })

  it('allocates nothing per frame beyond the scratch buffers it was given', () => {
    const { replay, geom, scratch, seatIndex } = setup('single', VIEWPORTS[0][1])
    const tokens = readTokens()
    const before = {
      px: scratch.px, trail: scratch.trail, heat: scratch.heat,
      dotX: scratch.dotX, tally: scratch.tally,
    }
    for (let i = 0; i < 20; i++) {
      sample(replay, i * 5, scratch)
      drawDynamicLayer(
        makeStubContext(), geom, tokens, 1,
        { replay, x: scratch.px, state: scratch.pstate, trailX: scratch.trail, seatIndex,
          showQueue: true, showHeat: true, hoveredId: -1 },
        scratch,
      )
    }
    for (const key of Object.keys(before)) expect(scratch[key]).toBe(before[key])
  })
})

describe('hitTest', () => {
  it('finds the nearest visible dot and nothing outside the radius', () => {
    const { replay, geom, scratch, seatIndex } = setup('single', VIEWPORTS[0][1])
    sample(replay, replayDuration(replay), scratch) // everyone seated => all visible
    drawDynamicLayer(
      makeStubContext(), geom, readTokens(), 1,
      { replay, x: scratch.px, state: scratch.pstate, trailX: null, seatIndex,
        showQueue: false, showHeat: false, hoveredId: -1 },
      scratch,
    )
    const target = 17
    const hit = hitTest(scratch, scratch.dotX[target], scratch.dotY[target], 6)
    expect(hit).toBe(target)
    expect(hitTest(scratch, -9999, -9999, 6)).toBe(-1)
  })

  it('ignores queued passengers, which have no cabin position', () => {
    const { replay, geom, scratch, seatIndex } = setup('single', VIEWPORTS[0][1])
    sample(replay, 0, scratch)
    drawDynamicLayer(
      makeStubContext(), geom, readTokens(), 1,
      { replay, x: scratch.px, state: scratch.pstate, trailX: null, seatIndex,
        showQueue: true, showHeat: false, hoveredId: -1 },
      scratch,
    )
    let visible = 0
    for (let i = 0; i < scratch.paxCount; i++) visible += scratch.dotVisible[i]
    expect(visible).toBe(0)
  })
})

describe('seat-letter headers', () => {
  const letters = (ctx) => new Set(callsOf(ctx, 'fillText').map((c) => c.args[0]))

  it('labels every distinct layout when the galleys leave room', () => {
    const { geom } = setup('twin', VIEWPORTS[0][1])
    const ctx = makeStubContext()
    drawStaticLayer(ctx, geom, readTokens(), 1)
    const drawn = letters(ctx)
    for (const letter of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K']) {
      expect(drawn.has(letter), letter).toBe(true)
    }
  })

  it('still labels the main cabin when the classes run straight together', () => {
    const replay = makeReplay({ aircraft: 'single' })
    // Squeeze every gap out: economy now butts straight up against first.
    const squeezed = {
      ...replay.aircraft,
      rowSlots: replay.aircraft.rowSlots.map((r) =>
        r.cabinId === 'economy' ? { ...r, x: r.x - 1.7 } : r,
      ),
      seats: replay.aircraft.seats.map((s) =>
        s.cabinId === 'economy' ? { ...s, x: s.x - 1.7 } : s,
      ),
    }
    const geom = computeGeometry(squeezed, VIEWPORTS[0][1])
    const ctx = makeStubContext()
    drawStaticLayer(ctx, geom, readTokens(), 1)
    expect(letters(ctx).has('C')).toBe(true) // C exists only in the 3-3 cabin
    expect(ctx.bad).toEqual([])
  })
})
