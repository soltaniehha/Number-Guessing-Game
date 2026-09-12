"""Passenger generation (ENGINE_SPEC 3.1, stream `pax`).

The draw order in here is part of the wire contract. Every `random()` is
specified down to the call site, because the JavaScript engine must consume the
identical stream. Adding, removing or reordering a draw is a breaking change
even when it does not change the distribution of anything.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

from .aircraft import Aircraft, Seat
from .config import SimConfig
from .rng import PCG32

#: Economy status buckets that concentrate in the FORWARD rows, and the fare
#: bucket that concentrates in the rear. Anything else in `eliteMix` (i.e.
#: `standard`) is spatially neutral and keeps its weight at every row.
STATUS_TIERS = ("elite_top", "elite_mid", "cardholder")
BASIC_TIER = "basic"


class Passenger:
    """One traveller. `__slots__` because a 777 run creates 354 of these per
    replication and a Monte Carlo sweep creates hundreds of thousands."""

    __slots__ = (
        "id", "seat", "partyId", "partySize", "bags", "walkSpeed", "stowMultiplier",
        "isPreboard", "isSlow", "hasChild", "tier", "groupLabel", "boardingIndex",
        "doorId",
    )

    def __init__(self, **kw: Any):
        self.groupLabel = ""
        self.boardingIndex = -1
        self.doorId = ""
        for k, v in kw.items():
            setattr(self, k, v)

    # Convenience accessors used all over the strategy code. Open seating nulls
    # `seat` out at the door, so these tolerate a seatless passenger.
    @property
    def depth(self) -> int:
        return self.seat.depth if self.seat is not None else 0

    @property
    def rowSlot(self) -> int:
        return self.seat.rowSlot if self.seat is not None else 0

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        seat = self.seat.id if self.seat else "open"
        return f"<Pax {self.id} {seat} party={self.partyId} bags={self.bags}>"


def _weighted_pick_int(rng: PCG32, keys: Sequence[int], weights: Sequence[float]) -> int:
    return rng.weighted_pick(list(keys), list(weights))


def form_parties(rng: PCG32, cfg: SimConfig, n_pax: int) -> List[int]:
    """Draw party sizes until they cover `n_pax`, truncating the last one.

    One `random()` per party. Truncating rather than rejecting keeps the draw
    count a deterministic function of the sizes drawn, which is what the parity
    harness needs.
    """
    sizes: List[int] = []
    total = 0
    while total < n_pax:
        size = _weighted_pick_int(rng, cfg.partyKeys, cfg.partyWeights)
        if size < 1:
            size = 1
        if total + size > n_pax:
            size = n_pax - total
        sizes.append(size)
        total += size
    return sizes


def assign_seats(
    rng: PCG32, ac: Aircraft, party_sizes: Sequence[int]
) -> List[List[Seat]]:
    """Shuffle the seat map, then hand each party a contiguous run if one exists.

    Real seat assignment is not uniform-random: a family of four ends up in four
    seats on one side of one row. Modelling that matters, because a party that
    sits together generates no seat interference among themselves and boards as
    a single blob -- which is precisely what erodes a Steffen ordering.
    """
    pool: List[Seat] = list(ac.seats)
    rng.shuffle(pool)

    taken = [False] * ac.seatCount
    # Free seats per (rowSlot, blockId), in layout order, so "take k of them
    # left-to-right" is well defined.
    by_block: Dict[Tuple[int, int], List[Seat]] = {}
    for s in ac.seats:
        by_block.setdefault((s.rowSlot, s.blockId), []).append(s)
    for group in by_block.values():
        group.sort(key=lambda s: s.layoutPos)

    # Both scans below skip already-taken seats and `taken` only ever goes
    # False -> True, so a cursor past the taken prefix of `pool` is exactly
    # equivalent to rescanning from zero -- and turns the party loop from
    # quadratic into linear in the common case. `web/src/sim/passengers.js`
    # carries the identical cursor; the two files are meant to read side by side.
    pool_start = 0
    out: List[List[Seat]] = []
    for k in party_sizes:
        while pool_start < len(pool) and taken[pool[pool_start].index]:
            pool_start += 1
        chosen: Optional[List[Seat]] = None
        if k > 1:
            for s in pool[pool_start:]:
                if taken[s.index]:
                    continue
                block = by_block[(s.rowSlot, s.blockId)]
                free = [b for b in block if not taken[b.index]]
                if len(free) >= k:
                    chosen = free[:k]
                    break
        if chosen is None:
            chosen = []
            for s in pool[pool_start:]:
                if not taken[s.index]:
                    chosen.append(s)
                    if len(chosen) == k:
                        break
        for s in chosen:
            taken[s.index] = True
        out.append(chosen)
    return out


def generate(rng: PCG32, ac: Aircraft, cfg: SimConfig) -> List[Passenger]:
    """Build the passenger manifest. Draw order is normative -- see module docstring."""
    seat_count = ac.seatCount
    n_pax = int(round(cfg.loadFactor * seat_count))
    n_pax = max(0, min(seat_count, n_pax))
    if n_pax == 0:
        return []

    party_sizes = form_parties(rng, cfg, n_pax)
    party_seats = assign_seats(rng, ac, party_sizes)

    # ids follow canonical SEAT order, not party order, so the attribute draws
    # below are indexed by a stable quantity that does not depend on how the
    # parties happened to fall.
    pairs: List[Tuple[Seat, int, int]] = []
    for pid, seats in enumerate(party_seats):
        for s in seats:
            pairs.append((s, pid, len(seats)))
    pairs.sort(key=lambda t: t[0].index)

    pax: List[Passenger] = [
        Passenger(id=i, seat=s, partyId=party, partySize=psize, bags=0, walkSpeed=0.0,
                  stowMultiplier=1.0, isPreboard=False, isSlow=False, hasChild=False,
                  tier="standard")
        for i, (s, party, psize) in enumerate(pairs)
    ]

    bag_keys, bag_w = list(cfg.bagKeys), list(cfg.bagWeights)
    for p in pax:
        p.bags = rng.weighted_pick(bag_keys, bag_w)
        p.walkSpeed = rng.truncnormal(cfg.walkSpeedMean, cfg.walkSpeedSd, 0.20, 2.00)
        p.stowMultiplier = rng.truncnormal(1.0, cfg.stowVariability, 0.35, 3.00)
        p.isPreboard = rng.bernoulli(cfg.preboardRate)
        slow = rng.bernoulli(cfg.slowPaxRate)          # draw consumed either way
        p.isSlow = slow and not p.isPreboard
        child = rng.bernoulli(cfg.childRate)           # draw consumed either way
        p.hasChild = child and p.partySize >= 2
        if p.isSlow:
            p.walkSpeed *= cfg.slowSpeedFactor
            p.stowMultiplier *= cfg.slowStowFactor

    # Tiers. A premium cabin *is* the tier; economy passengers draw a status
    # bucket, because that is what the revenue-driven boarding groups sort on.
    #
    # The draw is FRONT-BIASED, and that matters more than it looks. Status
    # flyers are concentrated in the forward economy rows -- Comfort+, Main
    # Cabin Extra, Economy Plus -- and basic-economy fares get whatever is left,
    # which is the back. Drawing status uniformly over the cabin would hand
    # every status-ordered boarding scheme a randomly spread first wave instead
    # of the front-loaded one it really gets, which is close to the worst
    # possible order and is exactly what makes real priority boarding slow.
    # See docs/RESEARCH_AIRLINES.md 7 #6.
    #
    # Exactly ONE weighted_pick per economy passenger either way, so the draw
    # count is unchanged; only the weights handed to it move.
    elite_keys, elite_w = list(cfg.eliteKeys), list(cfg.eliteWeights)
    bias = cfg.eliteForwardBias
    n_slots = len(ac.rowSlots)
    denom = float(n_slots - 1) if n_slots > 1 else 1.0
    for p in pax:
        if p.seat.classKey != "economy":
            p.tier = p.seat.classKey
        elif bias <= 0.0:
            p.tier = rng.weighted_pick(elite_keys, elite_w)
        else:
            # +1 at the nose, -1 at the tail, 0 at mid-cabin -- so the tilt
            # redistributes status forward without changing the cabin-wide mix.
            fwd = 1.0 - 2.0 * (p.seat.rowSlot / denom)
            up = 1.0 + bias * fwd
            down = 1.0 - bias * fwd
            if up < 0.0:
                up = 0.0
            if down < 0.0:
                down = 0.0
            tilted = [
                w * up if k in STATUS_TIERS else (w * down if k == BASIC_TIER else w)
                for k, w in zip(elite_keys, elite_w)
            ]
            p.tier = rng.weighted_pick(elite_keys, tilted)

    return pax
