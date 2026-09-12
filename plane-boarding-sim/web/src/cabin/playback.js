/**
 * Pure playback maths for the cabin view.
 *
 * Nothing in this module touches the DOM, canvas or React, so every rule that
 * governs how simulated time advances — interpolation, scrubbing, speed
 * multipliers, jet-bridge queue compression — is unit-testable in isolation.
 *
 * See docs/UI_SPEC.md 1.1 and docs/ENGINE_SPEC.md 6 for the normative model.
 */

/** Passenger state codes, matching the engine's event log. */
export const STATE = Object.freeze({
  QUEUED: 0,
  WALKING: 1,
  STOWING: 2,
  SHUFFLING: 3,
  SEATED: 4,
})

export const STATE_NAMES = Object.freeze([
  'Queued',
  'Walking',
  'Stowing',
  'Shuffling',
  'Seated',
])

/** Playback speed stops required by UI_SPEC 1.1. */
export const SPEEDS = Object.freeze([1, 2, 5, 10, 25, 50, 100])

/**
 * Above this multiplier we stop pretending every simulated tick is drawn and
 * simply advance simulated time by a bigger delta each animation frame.
 */
export const SMOOTH_SPEED_LIMIT = 25

/**
 * Largest wall-clock delta a single animation frame is allowed to represent.
 * Guards against the enormous delta produced when a background tab wakes up.
 */
export const MAX_WALL_DELTA = 0.25

/** How far back in simulated time a walking dot's motion trail reaches. */
export const TRAIL_SECONDS = 0.45

// ---------------------------------------------------------------------------
// Frame buffer access
// ---------------------------------------------------------------------------

/**
 * Frames arrive either as an array of typed arrays (`Int8Array[]`,
 * `Float32Array[]`) or as plain `number[][]`. Both index identically, so a
 * single accessor covers them.
 */
export function frameCountOf(replay) {
  if (!replay) return 0
  if (Number.isFinite(replay.frameCount) && replay.frameCount > 0) {
    return replay.frameCount | 0
  }
  const rows = replay.frames && replay.frames.x
  return rows ? rows.length : 0
}

export function frameIntervalOf(replay) {
  const dt = replay && replay.frameInterval
  return Number.isFinite(dt) && dt > 0 ? dt : 0.25
}

/** Total playable length in simulated seconds. */
export function replayDuration(replay) {
  const n = frameCountOf(replay)
  if (n <= 1) return 0
  const spanned = (n - 1) * frameIntervalOf(replay)
  const declared = replay && replay.duration
  // Trust the frame buffer: it is what we can actually draw.
  return Number.isFinite(declared) && declared > 0
    ? Math.min(declared, spanned) || spanned
    : spanned
}

/**
 * Locate `t` inside the frame buffer.
 *
 * Returns the bracketing frame indices and the blend factor between them.
 * Clamped at both ends: before the first frame and after the last, `alpha` is
 * 0 and both indices collapse onto the edge frame.
 */
export function frameCursor(t, frameInterval, frameCount) {
  const last = Math.max(0, (frameCount | 0) - 1)
  if (!(frameInterval > 0) || last === 0) {
    return { i0: 0, i1: 0, alpha: 0 }
  }
  if (!Number.isFinite(t) || t <= 0) return { i0: 0, i1: 0, alpha: 0 }
  const s = t / frameInterval
  if (s >= last) return { i0: last, i1: last, alpha: 0 }
  const i0 = Math.floor(s)
  return { i0, i1: i0 + 1, alpha: s - i0 }
}

/**
 * Linear interpolation of a passenger's aisle position between the two
 * bracketing frames. Frames are 0.25 s apart but playback runs at 1x real
 * time, so this is what keeps motion smooth rather than steppy.
 */
export function interpolateX(frames, paxId, t, frameInterval, frameCount) {
  const rows = frames && frames.x
  if (!rows || !rows.length) return 0
  const n = frameCount === undefined ? rows.length : frameCount
  const { i0, i1, alpha } = frameCursor(t, frameInterval, n)
  const a = rows[i0][paxId]
  if (alpha === 0 || i0 === i1) return a
  const b = rows[i1][paxId]
  return a + (b - a) * alpha
}

/** State comes from the nearest *preceding* frame — states do not blend. */
export function stateAtTime(frames, paxId, t, frameInterval, frameCount) {
  const rows = frames && frames.state
  if (!rows || !rows.length) return STATE.QUEUED
  const n = frameCount === undefined ? rows.length : frameCount
  const { i0 } = frameCursor(t, frameInterval, n)
  return rows[i0][paxId]
}

// ---------------------------------------------------------------------------
// Time advancement
// ---------------------------------------------------------------------------

/**
 * Clamp a wall-clock delta. Never assume 16.67 ms: real frames jitter, and a
 * hidden tab can hand back multi-second deltas on wake.
 */
export function clampWallDelta(seconds, max = MAX_WALL_DELTA) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0
  return seconds > max ? max : seconds
}

/**
 * Advance simulated time. At 1x, one wall-clock second is exactly one
 * simulated second — that is the product requirement, and it falls out of
 * multiplying the real elapsed delta by the speed multiplier.
 */
export function advanceTime(t, wallDelta, speed, duration) {
  const dt = clampWallDelta(wallDelta)
  const mult = Number.isFinite(speed) && speed > 0 ? speed : 1
  const next = (Number.isFinite(t) ? t : 0) + dt * mult
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return next >= duration ? duration : next
}

/** True once playback has reached the end of the replay. */
export function isAtEnd(t, duration) {
  return !(duration > 0) || t >= duration - 1e-9
}

/** Scrub-bar fraction (0..1) to simulated seconds. */
export function scrubToTime(fraction, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  const f = Number.isFinite(fraction) ? fraction : 0
  if (f <= 0) return 0
  if (f >= 1) return duration
  return f * duration
}

/** Simulated seconds to scrub-bar fraction (0..1). */
export function timeToFraction(t, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  if (!Number.isFinite(t) || t <= 0) return 0
  return t >= duration ? 1 : t / duration
}

/** Step exactly one frame forward (`dir` +1) or back (`dir` -1). */
export function stepTime(t, dir, frameInterval, duration) {
  const dt = frameInterval > 0 ? frameInterval : 0.25
  const raw = (Number.isFinite(t) ? t : 0) + Math.sign(dir) * dt
  // Snap to the frame grid so repeated stepping does not drift.
  const snapped = Math.round(raw / dt) * dt
  if (snapped <= 0) return 0
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return snapped >= duration ? duration : snapped
}

/**
 * Trails and per-tick fidelity are pointless once simulated time is racing.
 * Reduced-motion users never get a trail at all.
 */
export function shouldRenderTrail(speed, reducedMotion) {
  if (reducedMotion) return false
  return (Number.isFinite(speed) ? speed : 1) <= SMOOTH_SPEED_LIMIT
}

// ---------------------------------------------------------------------------
// Jet-bridge queue compression
// ---------------------------------------------------------------------------

/**
 * Lay out a jet-bridge queue in a fixed-length lane.
 *
 * 150 people waiting must still fit outside the door, so the lane compresses
 * down to `minSpacing` and then starts hiding dots, reporting how many were
 * dropped so the caller can show `+N` on the count badge.
 *
 * @param {number} count  passengers waiting
 * @param {object} opts
 * @param {number} opts.length      usable lane length, px
 * @param {number} opts.spacing     preferred centre-to-centre spacing, px
 * @param {number} opts.minSpacing  tightest spacing we will draw, px
 * @param {number} opts.maxDots     hard cap on drawn dots
 * @param {Float32Array} [opts.out] reusable output buffer (no draw-loop allocs)
 * @returns {{shown:number, hidden:number, spacing:number, offsets:Float32Array}}
 *          `offsets[i]` is the distance of dot `i` back along the lane.
 */
export function compressQueue(count, opts = {}) {
  const length = Math.max(0, opts.length ?? 0)
  const spacing = Math.max(0.01, opts.spacing ?? 8)
  const minSpacing = Math.max(0.01, Math.min(opts.minSpacing ?? 2.5, spacing))
  const maxDots = Math.max(1, opts.maxDots ?? 64)
  const n = Math.max(0, Math.floor(count) || 0)

  if (n === 0) {
    return { shown: 0, hidden: 0, spacing, offsets: opts.out || EMPTY_F32 }
  }

  const capacity = Math.max(1, Math.floor(length / minSpacing) + 1)
  const shown = Math.min(n, maxDots, capacity)
  const used = shown > 1 ? Math.min(spacing, length / (shown - 1)) : spacing

  let out = opts.out
  if (!out || out.length < shown) out = new Float32Array(Math.max(shown, 64))
  for (let i = 0; i < shown; i++) out[i] = i * used

  return { shown, hidden: n - shown, spacing: used, offsets: out }
}

const EMPTY_F32 = new Float32Array(0)

// ---------------------------------------------------------------------------
// Derived series
// ---------------------------------------------------------------------------

/**
 * Fraction of passengers seated at each frame — the sparkline drawn behind
 * the scrubber.
 */
export function seatedSeries(replay) {
  const n = frameCountOf(replay)
  const rows = replay && replay.frames && replay.frames.state
  const pax = replay && replay.passengers ? replay.passengers.length : 0
  const out = new Float32Array(n)
  if (!rows || !pax) return out
  for (let f = 0; f < n; f++) {
    const row = rows[f]
    let seated = 0
    for (let i = 0; i < pax; i++) if (row[i] === STATE.SEATED) seated++
    out[f] = seated / pax
  }
  return out
}

/** Count of passengers in each state at a given frame index. */
export function stateTally(replay, frameIndex, out) {
  const tally = out || new Int32Array(5)
  tally.fill(0)
  const rows = replay && replay.frames && replay.frames.state
  if (!rows || !rows.length) return tally
  const i = Math.max(0, Math.min(rows.length - 1, frameIndex | 0))
  const row = rows[i]
  const pax = replay.passengers ? replay.passengers.length : row.length
  for (let p = 0; p < pax; p++) {
    const s = row[p]
    if (s >= 0 && s < 5) tally[s]++
  }
  return tally
}

/** Nearest-neighbour downsample of a series to `n` points, for sparklines. */
export function sampleSeries(series, n) {
  const len = series ? series.length : 0
  const target = Math.max(1, n | 0)
  const out = new Float32Array(target)
  if (!len) return out
  if (len === 1) {
    out.fill(series[0])
    return out
  }
  for (let i = 0; i < target; i++) {
    const pos = target === 1 ? 0 : (i / (target - 1)) * (len - 1)
    out[i] = series[Math.round(pos)]
  }
  return out
}

/**
 * The frame index at which a passenger first reaches SEATED, or -1.
 * Used by the tooltip for "total time to seat".
 */
export function seatedFrame(replay, paxId) {
  const rows = replay && replay.frames && replay.frames.state
  const n = frameCountOf(replay)
  if (!rows) return -1
  for (let f = 0; f < n; f++) if (rows[f][paxId] === STATE.SEATED) return f
  return -1
}

/** The frame index at which a passenger first leaves QUEUED, or -1. */
export function enteredFrame(replay, paxId) {
  const rows = replay && replay.frames && replay.frames.state
  const n = frameCountOf(replay)
  if (!rows) return -1
  for (let f = 0; f < n; f++) if (rows[f][paxId] !== STATE.QUEUED) return f
  return -1
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** `m:ss` clock, matching the status bar in UI_SPEC. */
export function formatClock(seconds) {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const m = Math.floor(s / 60)
  const rest = Math.floor(s % 60)
  return `${m}:${rest < 10 ? '0' : ''}${rest}`
}

/** Compact duration for tooltips: `12.4 s` under a minute, else `2:04`. */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  return formatClock(seconds)
}

export function formatSpeed(speed) {
  return `${speed}×`
}
