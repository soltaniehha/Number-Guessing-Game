/**
 * Replay serialisation for the web visualisation.
 *
 * Port of `python/plane_boarding/replay.py`.
 *
 * The renderer needs to scrub, pause and rewind, so it gets a dense frame
 * buffer rather than an event log: reconstructing state from events is fine
 * going forward and miserable going backward. Frames are stored row-major by
 * frame (`frames.state[frame][paxId]`) because that is the order the renderer
 * walks them in, and because two flat arrays of numbers compress far better
 * than a list of per-passenger objects.
 */
import { geometryPayload } from './aircraft.js'
import { registerBuildReplay } from './engine.js'
import { pyRound } from './pyutil.js'

/**
 * Assemble the replay document. Indexed by `boardingIndex`, not passenger id:
 * the frame arrays are built in queue order and re-indexing 300 passengers x
 * 4000 frames just to change the key would cost more than it is worth.
 */
export function buildReplay(
  cfg,
  ac,
  queue,
  seats,
  lanes,
  result,
  framesState,
  framesX,
  frameInterval,
) {
  const paxPayload = []
  for (const p of queue) {
    const i = p.boardingIndex
    const s = seats[i]
    paxPayload.push({
      id: p.id,
      seatRow: s ? s.rowNumber : null,
      seatLetter: s ? s.letter : null,
      seatX: s ? pyRound(s.x, 4) : null,
      seatDepth: s ? s.depth : null,
      lane: lanes[i],
      cabinId: s ? s.cabinId : null,
      tier: p.tier,
      groupLabel: p.groupLabel,
      bags: p.bags,
      // Two different numbers, and they used to be conflated: this payload
      // emitted the party's INDEX under the name `party`, which the cabin
      // renderer prints as a size -- so a tooltip read "44 together" and the
      // screen reader said "party of 73" on an aircraft whose party sizes stop
      // at 5. Both are now spelled out.
      partyId: p.partyId,
      partySize: p.partySize,
      // Deprecated alias, kept so existing consumers keep working -- and now
      // carrying the quantity they were already treating it as.
      party: p.partySize,
      doorId: p.doorId,
    })
  }

  return {
    aircraft: geometryPayload(ac),
    config: cfg.toDict(),
    strategy: cfg.strategy,
    seed: cfg.seed,
    frameInterval,
    frameCount: framesState.length,
    // The SPAN OF THE FRAME BUFFER, not the boarding time.
    //
    // `frames[i]` is the state at `i * frameInterval`. A run almost never ends
    // exactly on that grid, so the closing frame -- the terminal state,
    // everybody seated -- sits at the first grid point at or after the run end.
    // Reporting `totalSeconds` here put the scrubber's right edge one grid step
    // SHORT of that frame, so the last thing the renderer could draw was a
    // mid-interval frame with somebody still shuffling in it while the status
    // bar said all N were seated. The two disagreed by up to one frame interval,
    // which is exactly the kind of contradiction that makes a visualisation
    // untrustworthy.
    //
    // `result.totalSeconds` remains the boarding time and is what every
    // statistic is computed from; this is only ever within one frame interval
    // of it.
    duration: frameInterval * Math.max(0, framesState.length - 1),
    // The shell's playback bar reads `dt`; it is the frame step, not cfg.dt.
    dt: frameInterval,
    passengers: paxPayload,
    frames: { state: framesState, x: framesX },
    result,
  }
}

registerBuildReplay(buildReplay)
