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
      party: p.partyId,
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
    duration: result.totalSeconds,
    // The shell's playback bar reads `dt`; it is the frame step, not cfg.dt.
    dt: frameInterval,
    passengers: paxPayload,
    frames: { state: framesState, x: framesX },
    result,
  }
}

registerBuildReplay(buildReplay)
