"""Replay serialisation for the web visualisation.

The renderer needs to scrub, pause and rewind, so it gets a dense frame buffer
rather than an event log: reconstructing state from events is fine going forward
and miserable going backward. Frames are stored column-major
(`frames.state[frame][paxId]`) because that is the order the renderer walks them
in, and because two flat arrays of numbers compress far better than a list of
per-passenger objects.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from .aircraft import Aircraft, Seat, geometry_payload
from .config import SimConfig
from .metrics import RunResult
from .passengers import Passenger


def build_replay(
    cfg: SimConfig,
    ac: Aircraft,
    queue: Sequence[Passenger],
    seats: Sequence[Optional[Seat]],
    lanes: Sequence[int],
    result: RunResult,
    frames_state: List[List[int]],
    frames_x: List[List[float]],
    frame_interval: float,
) -> Dict[str, Any]:
    """Assemble the replay document. Indexed by `boardingIndex`, not passenger id:
    the frame arrays are built in queue order and re-indexing 300 passengers x
    4000 frames just to change the key would cost more than it is worth."""
    pax_payload: List[Dict[str, Any]] = []
    for p in queue:
        i = p.boardingIndex
        s = seats[i]
        pax_payload.append({
            "id": p.id,
            "seatRow": s.rowNumber if s else None,
            "seatLetter": s.letter if s else None,
            "seatX": round(s.x, 4) if s else None,
            "seatDepth": s.depth if s else None,
            "lane": lanes[i],
            "cabinId": s.cabinId if s else None,
            "tier": p.tier,
            "groupLabel": p.groupLabel,
            "bags": p.bags,
            # Two different numbers, and they used to be conflated: this payload
            # emitted the party's INDEX under the name `party`, which the cabin
            # renderer prints as a size -- so a tooltip read "44 together" and
            # the screen reader said "party of 73" on an aircraft whose party
            # sizes stop at 5. Both are now spelled out.
            "partyId": p.partyId,
            "partySize": p.partySize,
            # Deprecated alias, kept so existing consumers keep working -- and
            # now carrying the quantity they were already treating it as.
            "party": p.partySize,
            "doorId": p.doorId,
        })

    return {
        "aircraft": geometry_payload(ac),
        "config": cfg.to_dict(),
        "strategy": cfg.strategy,
        "seed": cfg.seed,
        "frameInterval": frame_interval,
        "frameCount": len(frames_state),
        # The SPAN OF THE FRAME BUFFER, not the boarding time.
        #
        # `frames[i]` is the state at `i * frameInterval`. A run almost never
        # ends exactly on that grid, so the closing frame -- the terminal state,
        # everybody seated -- sits at the first grid point at or after the run
        # end. Reporting `totalSeconds` here put the scrubber's right edge one
        # grid step SHORT of that frame, so the last thing the renderer could
        # draw was a mid-interval frame with somebody still shuffling in it
        # while the status bar said all N were seated. The two disagreed by up
        # to one frame interval, which is exactly the kind of contradiction that
        # makes a visualisation untrustworthy.
        #
        # `result.totalSeconds` remains the boarding time and is what every
        # statistic is computed from; this is only ever within one frame
        # interval of it.
        "duration": frame_interval * max(0, len(frames_state) - 1),
        "passengers": pax_payload,
        "frames": {"state": frames_state, "x": frames_x},
        "result": result.to_dict(per_passenger=True),
    }
