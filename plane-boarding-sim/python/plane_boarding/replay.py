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
            "party": p.partyId,
            "doorId": p.doorId,
        })

    return {
        "aircraft": geometry_payload(ac),
        "config": cfg.to_dict(),
        "strategy": cfg.strategy,
        "seed": cfg.seed,
        "frameInterval": frame_interval,
        "frameCount": len(frames_state),
        "duration": result.totalSeconds,
        "passengers": pax_payload,
        "frames": {"state": frames_state, "x": frames_x},
        "result": result.to_dict(per_passenger=True),
    }
