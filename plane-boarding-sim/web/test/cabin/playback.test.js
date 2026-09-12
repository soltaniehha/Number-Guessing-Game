import { describe, it, expect } from 'vitest'
import {
  MAX_WALL_DELTA,
  SMOOTH_SPEED_LIMIT,
  SPEEDS,
  STATE,
  advanceTime,
  clampWallDelta,
  compressQueue,
  formatClock,
  formatDuration,
  frameCursor,
  interpolateX,
  isAtEnd,
  replayDuration,
  sampleSeries,
  scrubToTime,
  seatedSeries,
  shouldRenderTrail,
  stateAtTime,
  stateTally,
  stepTime,
  timeToFraction,
} from '../../src/cabin/playback.js'

// Two passengers, five frames, 0.25 s apart => 1.0 s of replay.
const FRAMES = {
  x: [
    Float32Array.from([0, 10]),
    Float32Array.from([1, 12]),
    Float32Array.from([2, 12]),
    Float32Array.from([4, 12]),
    Float32Array.from([8, 12]),
  ],
  state: [
    Int8Array.from([STATE.QUEUED, STATE.WALKING]),
    Int8Array.from([STATE.WALKING, STATE.WALKING]),
    Int8Array.from([STATE.WALKING, STATE.STOWING]),
    Int8Array.from([STATE.WALKING, STATE.SHUFFLING]),
    Int8Array.from([STATE.STOWING, STATE.SEATED]),
  ],
}
const REPLAY = {
  frameInterval: 0.25,
  frameCount: 5,
  duration: 1,
  frames: FRAMES,
  passengers: [{ id: 0 }, { id: 1 }],
}

describe('frameCursor', () => {
  it('brackets a time between two frames', () => {
    expect(frameCursor(0.25, 0.25, 5)).toEqual({ i0: 1, i1: 2, alpha: 0 })
    const mid = frameCursor(0.375, 0.25, 5)
    expect(mid.i0).toBe(1)
    expect(mid.i1).toBe(2)
    expect(mid.alpha).toBeCloseTo(0.5, 10)
  })

  it('clamps below zero onto the first frame', () => {
    expect(frameCursor(-5, 0.25, 5)).toEqual({ i0: 0, i1: 0, alpha: 0 })
  })

  it('clamps past the end onto the last frame', () => {
    expect(frameCursor(1, 0.25, 5)).toEqual({ i0: 4, i1: 4, alpha: 0 })
    expect(frameCursor(99, 0.25, 5)).toEqual({ i0: 4, i1: 4, alpha: 0 })
  })

  it('degenerates safely for a single-frame replay', () => {
    expect(frameCursor(0.4, 0.25, 1)).toEqual({ i0: 0, i1: 0, alpha: 0 })
  })
})

describe('interpolateX', () => {
  it('lands exactly on sampled frames', () => {
    expect(interpolateX(FRAMES, 0, 0, 0.25, 5)).toBe(0)
    expect(interpolateX(FRAMES, 0, 0.25, 0.25, 5)).toBe(1)
    expect(interpolateX(FRAMES, 0, 0.75, 0.25, 5)).toBe(4)
  })

  it('interpolates linearly between frames', () => {
    // Halfway between frames 3 (x=4) and 4 (x=8).
    expect(interpolateX(FRAMES, 0, 0.875, 0.25, 5)).toBeCloseTo(6, 6)
    // Quarter of the way between frames 0 (x=0) and 1 (x=1).
    expect(interpolateX(FRAMES, 0, 0.0625, 0.25, 5)).toBeCloseTo(0.25, 6)
  })

  it('is clamped at both ends', () => {
    expect(interpolateX(FRAMES, 1, -3, 0.25, 5)).toBe(10)
    expect(interpolateX(FRAMES, 1, 500, 0.25, 5)).toBe(12)
  })

  it('handles plain nested arrays as well as typed arrays', () => {
    const plain = { x: [[0], [10]], state: [[0], [1]] }
    expect(interpolateX(plain, 0, 0.125, 0.25, 2)).toBeCloseTo(5, 6)
  })
})

describe('stateAtTime', () => {
  it('takes the nearest preceding frame and never blends', () => {
    expect(stateAtTime(FRAMES, 1, 0.0, 0.25, 5)).toBe(STATE.WALKING)
    expect(stateAtTime(FRAMES, 1, 0.49, 0.25, 5)).toBe(STATE.WALKING)
    expect(stateAtTime(FRAMES, 1, 0.5, 0.25, 5)).toBe(STATE.STOWING)
    expect(stateAtTime(FRAMES, 1, 0.74, 0.25, 5)).toBe(STATE.STOWING)
    expect(stateAtTime(FRAMES, 1, 0.75, 0.25, 5)).toBe(STATE.SHUFFLING)
    expect(stateAtTime(FRAMES, 1, 9, 0.25, 5)).toBe(STATE.SEATED)
  })
})

describe('replayDuration', () => {
  it('is derived from the frame buffer', () => {
    expect(replayDuration(REPLAY)).toBeCloseTo(1, 10)
    expect(replayDuration({ frameInterval: 0.25, frames: { x: [[0]] } })).toBe(0)
  })
})

describe('advanceTime', () => {
  it('runs one simulated second per wall second at 1x', () => {
    // Sixty jittery animation frames adding up to exactly 1.0 s of wall clock.
    const deltas = []
    let total = 0
    for (let i = 0; i < 60; i++) {
      const d = i % 2 === 0 ? 0.014 : 0.0193333333333
      deltas.push(d)
      total += d
    }
    expect(total).toBeCloseTo(1, 6)
    let t = 0
    for (const d of deltas) t = advanceTime(t, d, 1, 600)
    expect(t).toBeCloseTo(1, 6)
  })

  it('multiplies wall time by the speed at every stop', () => {
    for (const speed of SPEEDS) {
      let t = 0
      for (let i = 0; i < 10; i++) t = advanceTime(t, 0.1, speed, 100000)
      expect(t).toBeCloseTo(speed, 6)
    }
  })

  it('advances by larger deltas rather than more frames above 25x', () => {
    const slow = advanceTime(0, 1 / 60, 25, 1e6)
    const fast = advanceTime(0, 1 / 60, 100, 1e6)
    expect(fast / slow).toBeCloseTo(4, 6)
  })

  it('clamps the wall delta so a hidden tab cannot jump the clock', () => {
    expect(clampWallDelta(12)).toBe(MAX_WALL_DELTA)
    expect(clampWallDelta(-1)).toBe(0)
    expect(clampWallDelta(Number.NaN)).toBe(0)
    expect(advanceTime(0, 30, 1, 1000)).toBe(MAX_WALL_DELTA)
  })

  it('never overruns the duration', () => {
    expect(advanceTime(9.99, 0.25, 100, 10)).toBe(10)
    expect(isAtEnd(10, 10)).toBe(true)
    expect(isAtEnd(9.5, 10)).toBe(false)
  })
})

describe('scrubbing', () => {
  it('maps a fraction onto simulated seconds and back', () => {
    expect(scrubToTime(0, 120)).toBe(0)
    expect(scrubToTime(0.25, 120)).toBe(30)
    expect(scrubToTime(1, 120)).toBe(120)
    expect(scrubToTime(4, 120)).toBe(120)
    expect(scrubToTime(-1, 120)).toBe(0)
    expect(timeToFraction(30, 120)).toBeCloseTo(0.25, 10)
    expect(timeToFraction(500, 120)).toBe(1)
    expect(timeToFraction(30, 0)).toBe(0)
  })

  it('round-trips', () => {
    for (const f of [0, 0.13, 0.5, 0.77, 1]) {
      expect(timeToFraction(scrubToTime(f, 523.75), 523.75)).toBeCloseTo(f, 10)
    }
  })
})

describe('stepTime', () => {
  it('moves exactly one frame and snaps to the frame grid', () => {
    expect(stepTime(0, 1, 0.25, 10)).toBeCloseTo(0.25, 10)
    expect(stepTime(0.31, 1, 0.25, 10)).toBeCloseTo(0.5, 10)
    expect(stepTime(0.31, -1, 0.25, 10)).toBeCloseTo(0, 10)
    expect(stepTime(0, -1, 0.25, 10)).toBe(0)
    expect(stepTime(10, 1, 0.25, 10)).toBe(10)
  })

  it('does not drift over many steps', () => {
    let t = 0
    for (let i = 0; i < 400; i++) t = stepTime(t, 1, 0.25, 1000)
    expect(t).toBeCloseTo(100, 9)
  })
})

describe('compressQueue', () => {
  it('uses the preferred spacing when the queue is short', () => {
    const q = compressQueue(4, { length: 200, spacing: 10, minSpacing: 3 })
    expect(q.shown).toBe(4)
    expect(q.hidden).toBe(0)
    expect(q.spacing).toBe(10)
    expect(Array.from(q.offsets.slice(0, 4))).toEqual([0, 10, 20, 30])
  })

  it('compresses so the whole queue fits the lane', () => {
    const q = compressQueue(50, { length: 200, spacing: 10, minSpacing: 1 })
    expect(q.shown).toBe(50)
    expect(q.hidden).toBe(0)
    expect(q.offsets[q.shown - 1]).toBeCloseTo(200, 6)
    expect(q.spacing).toBeLessThan(10)
  })

  it('fits 150 waiting passengers and never exceeds the lane', () => {
    const q = compressQueue(150, { length: 240, spacing: 8, minSpacing: 1.4, maxDots: 220 })
    expect(q.shown).toBe(150)
    expect(q.offsets[q.shown - 1]).toBeLessThanOrEqual(240 + 1e-6)
  })

  it('never draws tighter than minSpacing, reporting the overflow instead', () => {
    const q = compressQueue(400, { length: 100, spacing: 8, minSpacing: 4, maxDots: 500 })
    expect(q.spacing).toBeGreaterThanOrEqual(4 - 1e-9)
    expect(q.shown).toBe(26) // floor(100 / 4) + 1
    expect(q.hidden).toBe(374)
    expect(q.shown + q.hidden).toBe(400)
  })

  it('respects the hard dot cap', () => {
    const q = compressQueue(500, { length: 10000, spacing: 8, minSpacing: 1, maxDots: 64 })
    expect(q.shown).toBe(64)
    expect(q.hidden).toBe(436)
  })

  it('handles empty and single queues', () => {
    expect(compressQueue(0, { length: 100 }).shown).toBe(0)
    const one = compressQueue(1, { length: 100, spacing: 9 })
    expect(one.shown).toBe(1)
    expect(one.offsets[0]).toBe(0)
  })

  it('reuses the caller-supplied buffer so the draw loop allocates nothing', () => {
    const buf = new Float32Array(64)
    const q = compressQueue(10, { length: 100, spacing: 5, out: buf })
    expect(q.offsets).toBe(buf)
  })

  it('grows the buffer only when it is genuinely too small', () => {
    const buf = new Float32Array(4)
    const q = compressQueue(10, { length: 100, spacing: 5, out: buf })
    expect(q.offsets).not.toBe(buf)
    expect(q.offsets.length).toBeGreaterThanOrEqual(10)
  })
})

describe('derived series', () => {
  it('computes seated fraction per frame', () => {
    const s = seatedSeries(REPLAY)
    expect(Array.from(s)).toEqual([0, 0, 0, 0, 0.5])
  })

  it('tallies states at a frame', () => {
    const tally = stateTally(REPLAY, 2)
    expect(tally[STATE.WALKING]).toBe(1)
    expect(tally[STATE.STOWING]).toBe(1)
    expect(stateTally(REPLAY, 999)[STATE.SEATED]).toBe(1)
  })

  it('downsamples for the sparkline', () => {
    const s = sampleSeries(Float32Array.from([0, 0.5, 1]), 5)
    expect(s.length).toBe(5)
    expect(s[0]).toBe(0)
    expect(s[4]).toBe(1)
  })
})

describe('trails and formatting', () => {
  it('drops trails above the smooth-speed limit and under reduced motion', () => {
    expect(shouldRenderTrail(1, false)).toBe(true)
    expect(shouldRenderTrail(SMOOTH_SPEED_LIMIT, false)).toBe(true)
    expect(shouldRenderTrail(50, false)).toBe(false)
    expect(shouldRenderTrail(1, true)).toBe(false)
  })

  it('formats clocks and durations', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(222)).toBe('3:42')
    expect(formatDuration(12.34)).toBe('12.3 s')
    expect(formatDuration(90)).toBe('1:30')
    expect(formatDuration(-1)).toBe('—')
  })
})
