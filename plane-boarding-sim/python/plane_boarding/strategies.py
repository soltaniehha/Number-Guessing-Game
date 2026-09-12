"""The fifteen boarding strategies, plus the universal post-processing pipeline.

A strategy is a pure function `(passengers, aircraft, cfg, rng) -> queue`. It
stamps `groupLabel` on each passenger and returns them in boarding order. All
randomness comes from the `order` stream, so changing a strategy cannot perturb
the passenger manifest or the runtime service times.

The recurring trick in here is *shuffle first, then stable-sort by the key you
actually care about*. That gives "sorted by X, random within ties" in one line
and, crucially, consumes exactly one shuffle's worth of draws regardless of how
the ties fall -- which is what keeps the two language implementations in step.

The post-processing pipeline at the bottom is where theory meets reality. Party
cohesion alone is the single largest reason a perfect Steffen ordering does not
deliver its theoretical 2x in the field: a family of four boarding together
locally destroys the alternating-row pattern.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from .aircraft import AISLE_SEAT, Aircraft, MIDDLE, WINDOW
from .config import SimConfig
from .passengers import Passenger
from .rng import PCG32

StrategyFn = Callable[[List[Passenger], Aircraft, SimConfig, PCG32], List[Passenger]]

#: Tiers that buy you an earlier slot within your group (never ahead of everyone).
ELITE_TIERS = ("first", "business", "premium", "elite_top", "elite_mid")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _bands(ac: Aircraft, zone_count: int) -> List[Tuple[int, int]]:
    """Split the physical row slots into `zone_count` contiguous bands, fore to aft.

    Returns half-open [lo, hi) slot ranges. Bands are cut on row *slots*, not row
    numbers, so a cabin that skips 13 still gets even-sized zones.
    """
    n = len(ac.rowSlots)
    z = max(1, min(zone_count, n)) if n else 1
    return [(n * b // z, n * (b + 1) // z) for b in range(z)]


def _band_of(slot: int, bands: Sequence[Tuple[int, int]]) -> int:
    for i, (lo, hi) in enumerate(bands):
        if lo <= slot < hi:
            return i
    return len(bands) - 1


def _label(pax: Sequence[Passenger], text: str) -> List[Passenger]:
    for p in pax:
        p.groupLabel = text
    return list(pax)


def _shuffled(rng: PCG32, items: Sequence[Passenger]) -> List[Passenger]:
    out = list(items)
    rng.shuffle(out)
    return out


def _zone_label(i: int, total: int) -> str:
    return f"Zone {i + 1} of {total}"


def _elites_first(pax: List[Passenger]) -> List[Passenger]:
    """Stable partition: elite status buys the front of your group, nothing more."""
    elite = [p for p in pax if p.tier in ELITE_TIERS]
    rest = [p for p in pax if p.tier not in ELITE_TIERS]
    return elite + rest


# ---------------------------------------------------------------------------
# 1-3: the zone family
# ---------------------------------------------------------------------------

def strat_random(pax: List[Passenger], ac: Aircraft, cfg: SimConfig, rng: PCG32) -> List[Passenger]:
    out = _shuffled(rng, pax)
    return _label(out, "Free-for-all")


def _zoned(pax: List[Passenger], ac: Aircraft, cfg: SimConfig, rng: PCG32, rear_first: bool) -> List[Passenger]:
    bands = _bands(ac, cfg.zoneCount)
    buckets: List[List[Passenger]] = [[] for _ in bands]
    for p in pax:
        buckets[_band_of(p.rowSlot, bands)].append(p)
    order = range(len(bands) - 1, -1, -1) if rear_first else range(len(bands))
    out: List[Passenger] = []
    for n, bi in enumerate(order):
        out.extend(_label(_shuffled(rng, buckets[bi]), _zone_label(n, len(bands))))
    return out


def strat_back_to_front(pax, ac, cfg, rng):
    return _zoned(pax, ac, cfg, rng, rear_first=True)


def strat_front_to_back(pax, ac, cfg, rng):
    return _zoned(pax, ac, cfg, rng, rear_first=False)


# ---------------------------------------------------------------------------
# 4-5: outside-in
# ---------------------------------------------------------------------------

def _depth_label(ac: Aircraft, p: Passenger) -> str:
    return {WINDOW: "Window", MIDDLE: "Middle", AISLE_SEAT: "Aisle"}[p.seat.kind]


def strat_wilma(pax: List[Passenger], ac: Aircraft, cfg: SimConfig, rng: PCG32) -> List[Passenger]:
    """All windows, then all middles, then all aisles.

    Boarding strictly by decreasing depth guarantees ZERO seat interference: a
    passenger's blockers all sit at shallower depth, and everyone at shallower
    depth is still standing at the gate.
    """
    out: List[Passenger] = []
    for d in range(ac.maxDepth, 0, -1):
        bucket = _shuffled(rng, [p for p in pax if p.depth == d])
        for p in bucket:
            p.groupLabel = _depth_label(ac, p)
        out.extend(bucket)
    return out


def strat_wilma_zoned(pax: List[Passenger], ac: Aircraft, cfg: SimConfig, rng: PCG32) -> List[Passenger]:
    """Outside-in, and rear-to-front within each seat-column band.

    Keeps WilMA's zero-interference property (depth is still the outer loop)
    while spreading the aisle load, which plain WilMA does not do at all.
    """
    bands = _bands(ac, cfg.zoneCount)
    out: List[Passenger] = []
    for d in range(ac.maxDepth, 0, -1):
        at_depth = [p for p in pax if p.depth == d]
        for n, bi in enumerate(range(len(bands) - 1, -1, -1)):
            lo, hi = bands[bi]
            bucket = _shuffled(rng, [p for p in at_depth if lo <= p.rowSlot < hi])
            for p in bucket:
                p.groupLabel = f"{_depth_label(ac, p)} {_zone_label(n, len(bands))}"
            out.extend(bucket)
    return out


# ---------------------------------------------------------------------------
# 6-7: Steffen
# ---------------------------------------------------------------------------

def strat_steffen_perfect(pax: List[Passenger], ac: Aircraft, cfg: SimConfig, rng: PCG32) -> List[Passenger]:
    """The theoretical optimum: adjacent boarders are two rows apart.

    Iterating side -> row parity -> depth -> rear-to-front means consecutive
    passengers in the queue are two rows apart on the same side of the aisle,
    so a whole wave of them can stow simultaneously without anyone reaching
    past anyone else. It also inherits WilMA's zero-interference property.

    Generalised beyond 3-3: "side" is a block (serving aisle plus which side of
    it), so a 3-4-3 has four sides and produces 8*maxDepth waves rather than 4.
    """
    out: List[Passenger] = []
    n_groups = 0
    for side in range(ac.blockCount):
        for parity in (0, 1):
            for d in range(ac.maxDepth, 0, -1):
                bucket = [
                    p for p in pax
                    if p.seat.blockId == side and p.rowSlot % 2 == parity and p.depth == d
                ]
                if not bucket:
                    continue
                bucket.sort(key=lambda p: -p.rowSlot)
                n_groups += 1
                out.extend(_label(bucket, f"Wave {n_groups}"))
    return out


def strat_steffen_modified(pax: List[Passenger], ac: Aircraft, cfg: SimConfig, rng: PCG32) -> List[Passenger]:
    """Four gate-callable groups: even/odd rows crossed with side of the aisle,
    window-first within each. Captures most of the perfect method's benefit
    without per-passenger sequencing, which is why it is the only Steffen
    variant an airline could actually announce."""
    out: List[Passenger] = []
    n = 0
    for parity in (0, 1):
        for side in range(ac.blockCount):
            bucket = [p for p in pax if p.rowSlot % 2 == parity and p.seat.blockId == side]
            if not bucket:
                continue
            bucket = _shuffled(rng, bucket)
            bucket.sort(key=lambda p: -p.depth)
            n += 1
            out.extend(_label(bucket, f"Group {n}"))
    return out


# ---------------------------------------------------------------------------
# 8-10: pyramid, rotating, blocks
# ---------------------------------------------------------------------------

def strat_reverse_pyramid(pax: List[Passenger], ac: Aircraft, cfg: SimConfig, rng: PCG32) -> List[Passenger]:
    """A diagonal wave from rear-window toward front-aisle.

    Blends outside-in with back-to-front in a single score, which is why it
    lands between WilMA and Steffen in practically every study, and why America
    West measured a ~20% saving from it in revenue service.
    """
    n_rows = max(1, len(ac.rowSlots) - 1)
    n_depth = max(1, ac.maxDepth - 1)
    w_row, w_depth = 0.5, 0.5

    def score(p: Passenger) -> float:
        row_term = (len(ac.rowSlots) - 1 - p.rowSlot) / n_rows
        depth_term = (p.depth - 1) / n_depth
        return w_row * row_term + w_depth * depth_term

    out = _shuffled(rng, pax)
    out.sort(key=lambda p: -score(p))
    # Five printable bands, so the result is announceable rather than a list of names.
    total = len(out)
    for i, p in enumerate(out):
        p.groupLabel = f"Wave {min(5, 1 + (i * 5) // max(1, total))}"
    return out


def strat_rotating_zone(pax: List[Passenger], ac: Aircraft, cfg: SimConfig, rng: PCG32) -> List[Passenger]:
    """Rearmost band, then foremost, then second-rearmost, ...

    Deliberately alternates the two ends of the aisle so the two flows interleave
    instead of one queueing behind the other.
    """
    bands = _bands(ac, cfg.zoneCount)
    buckets: List[List[Passenger]] = [[] for _ in bands]
    for p in pax:
        buckets[_band_of(p.rowSlot, bands)].append(p)
    order: List[int] = []
    lo, hi = 0, len(bands) - 1
    while lo <= hi:
        order.append(hi)
        if lo != hi:
            order.append(lo)
        lo += 1
        hi -= 1
    out: List[Passenger] = []
    for n, bi in enumerate(order):
        out.extend(_label(_shuffled(rng, buckets[bi]), _zone_label(n, len(bands))))
    return out


def strat_block_boarding(pax: List[Passenger], ac: Aircraft, cfg: SimConfig, rng: PCG32) -> List[Passenger]:
    """The plain vanilla scheme most airlines ran before status tiers took over:
    premium cabin, then contiguous rear-to-front blocks."""
    premium = [p for p in pax if p.seat.classKey != "economy"]
    rest = [p for p in pax if p.seat.classKey == "economy"]
    out = _label(_shuffled(rng, premium), "Premium cabin")
    bands = _bands(ac, cfg.zoneCount)
    buckets: List[List[Passenger]] = [[] for _ in bands]
    for p in rest:
        buckets[_band_of(p.rowSlot, bands)].append(p)
    for n, bi in enumerate(range(len(bands) - 1, -1, -1)):
        out.extend(_label(_shuffled(rng, buckets[bi]), f"Block {n + 1}"))
    return out


# ---------------------------------------------------------------------------
# 11: open seating
# ---------------------------------------------------------------------------

def strat_open_seating(pax: List[Passenger], ac: Aircraft, cfg: SimConfig, rng: PCG32) -> List[Passenger]:
    """No assigned seats. The queue is a check-in-position proxy: shuffle, with
    elites pulled to the front. Seats are chosen at the door -- see engine 6.5."""
    out = _elites_first(_shuffled(rng, pax))
    total = max(1, len(out))
    for i, p in enumerate(out):
        p.groupLabel = "Group " + "ABC"[min(2, (i * 3) // total)]
    return out


# ---------------------------------------------------------------------------
# 12-13: the five-tier pair
# ---------------------------------------------------------------------------

def strat_priority_5tier(pax: List[Passenger], ac: Aircraft, cfg: SimConfig, rng: PCG32) -> List[Passenger]:
    """The realistic modern scheme: it sells queue position and has no spatial
    logic whatsoever. Included precisely so it can be measured against the next
    one, which keeps the commercial constraints and adds flow logic."""
    def tier_of(p: Passenger) -> int:
        if p.seat.classKey in ("first", "business"):
            return 0
        if p.tier == "elite_top":
            return 0
        if p.tier == "elite_mid" or p.seat.classKey == "premium" or p.tier == "cardholder":
            return 1
        if p.tier == "basic":
            return 4
        return 2  # 'standard' -- split into two called groups below

    buckets: List[List[Passenger]] = [[], [], [], [], []]
    for p in pax:
        buckets[tier_of(p)].append(p)

    # The bulk of the cabin is called as two groups, not one; airlines split it
    # by check-in time, which is uncorrelated with anything spatial.
    standard = _shuffled(rng, buckets[2])
    half = len(standard) // 2
    buckets[2], buckets[3] = standard[:half], standard[half:]

    names = ["Tier 1 (premium + top elite)", "Tier 2 (elite / cardholder)",
             "Tier 3 (main cabin)", "Tier 4 (main cabin)", "Tier 5 (basic economy)"]
    out: List[Passenger] = []
    for i, bucket in enumerate(buckets):
        group = bucket if i in (2, 3) else _shuffled(rng, bucket)
        out.extend(_label(group, names[i]))
    return out


def strat_common_sense_5tier(pax: List[Passenger], ac: Aircraft, cfg: SimConfig, rng: PCG32) -> List[Passenger]:
    """The headline "what a sensible airline could actually sell" strategy.

    Keeps the commercially non-negotiable parts -- premium cabin first,
    preboards first -- and applies real flow logic to the ~85% of the aircraft
    that is economy, using five gate-announceable groups. It is a coarse reverse
    pyramid quantised to what a boarding pass can print, preserving the two
    effects that actually matter: outside-in kills seat shuffles, rear-first
    spreads the aisle. Elite status buys the front of your group rather than the
    front of the aeroplane, so status still means something without wrecking the
    flow.
    """
    econ_slots = ac.economyRowSlots
    mid = econ_slots[len(econ_slots) // 2] if econ_slots else 0

    premium: List[Passenger] = []
    groups: List[List[Passenger]] = [[], [], [], []]  # groups 2..5
    for p in pax:
        if p.seat.classKey != "economy":
            premium.append(p)
            continue
        rear = p.rowSlot >= mid
        kind = p.seat.kind
        if kind == WINDOW:
            groups[0 if rear else 1].append(p)
        elif kind == MIDDLE:
            groups[1 if rear else 2].append(p)
        else:
            groups[2 if rear else 3].append(p)

    names = ["Group 1 (premium cabin)", "Group 2 (rear windows)",
             "Group 3 (fwd windows + rear middles)", "Group 4 (fwd middles + rear aisles)",
             "Group 5 (forward aisles)"]
    out = _label(_elites_first(_shuffled(rng, premium)), names[0])
    for i, bucket in enumerate(groups):
        ordered = _shuffled(rng, bucket)
        ordered.sort(key=lambda p: -p.rowSlot)   # rear to front, shuffled within a row
        out.extend(_label(_elites_first(ordered), names[i + 1]))
    return out


# ---------------------------------------------------------------------------
# 14-15: service-time based
# ---------------------------------------------------------------------------

def strat_by_bags(pax: List[Passenger], ac: Aircraft, cfg: SimConfig, rng: PCG32) -> List[Passenger]:
    """Zero-bag first, then one, then two. Tests the "bags are the bottleneck"
    hypothesis directly -- and note the literature actually finds the reverse
    (most-bin-luggage-first) shortens boarding, so this one is a foil."""
    out: List[Passenger] = []
    for b in sorted({p.bags for p in pax}):
        bucket = _shuffled(rng, [p for p in pax if p.bags == b])
        out.extend(_label(bucket, f"{b} bag" + ("" if b == 1 else "s")))
    return out


def strat_slowest_first(pax: List[Passenger], ac: Aircraft, cfg: SimConfig, rng: PCG32) -> List[Passenger]:
    """Sorted by expected service time, slowest first: get the long stows started
    early and let fast passengers fill in behind. Erland/Steffen find this beats
    random mainly by cutting variance rather than the mean."""
    per_bag = cfg.stowWeibullScale * 0.8929795  # mean of Weibull(1.7, 1) ~ Gamma(1+1/k)
    per_move = (cfg.shuffleMoveMin + cfg.shuffleMoveMode + cfg.shuffleMoveMax) / 3.0
    moves = cfg.shuffleMovements

    def est(p: Passenger) -> float:
        shuffle_moves = moves["none"] if p.depth <= 1 else moves["aisle"]
        service = (p.bags * per_bag + shuffle_moves * per_move) * p.stowMultiplier
        return service + (ac.length / max(0.2, p.walkSpeed)) * 0.25

    out = _shuffled(rng, pax)
    out.sort(key=lambda p: -est(p))
    total = max(1, len(out))
    for i, p in enumerate(out):
        p.groupLabel = f"Band {min(5, 1 + (i * 5) // total)}"
    return out


# ---------------------------------------------------------------------------
# Universal post-processing (ENGINE_SPEC 4)
# ---------------------------------------------------------------------------

def apply_post_processing(
    queue: List[Passenger], cfg: SimConfig, rng: PCG32
) -> List[Passenger]:
    """Preboards -> party cohesion -> non-compliance -> late arrivals.

    Order matters and is normative. Together these four steps are what separates
    a paper result from a gate result: they are the frictions that shrink
    Steffen's theoretical 2x to the ~20-25% airlines actually measure.
    """
    out = list(queue)

    # 1. Preboards. Stable, so the strategy's ordering survives among them.
    if cfg.preboardFirst:
        pre = [p for p in out if p.isPreboard]
        if pre:
            for p in pre:
                p.groupLabel = "Preboard"
            out = pre + [p for p in out if not p.isPreboard]

    # 2. Party cohesion. A party boards at its earliest member's slot, window
    #    first -- families self-organise so the window passenger goes in first.
    #    Note this deliberately runs AFTER preboarding, so a party containing a
    #    wheelchair passenger boards with them, which is what actually happens.
    if cfg.keepPartiesTogether:
        members: Dict[int, List[Passenger]] = {}
        for p in out:
            members.setdefault(p.partyId, []).append(p)
        for group in members.values():
            group.sort(key=lambda p: -p.depth)   # stable: ties keep queue order
        emitted = set()
        cohered: List[Passenger] = []
        for p in out:
            if p.partyId in emitted:
                continue
            emitted.add(p.partyId)
            cohered.extend(members[p.partyId])
        out = cohered

    # 3. Non-compliance. 15% of passengers ignore the group they were called in.
    jitter = cfg.complianceJitter
    if cfg.nonComplianceRate > 0 and jitter > 0:
        keyed: List[Tuple[int, int, Passenger]] = []
        for i, p in enumerate(out):
            k = 0
            if rng.bernoulli(cfg.nonComplianceRate):
                k = rng.randint(2 * jitter + 1) - jitter
            keyed.append((i + k, i, p))
        keyed.sort(key=lambda t: (t[0], t[1]))
        out = [t[2] for t in keyed]

    # 4. Late arrivals -- the sprint from the connecting gate.
    if cfg.lateRate > 0:
        late: List[Passenger] = []
        ontime: List[Passenger] = []
        for p in out:
            (late if rng.bernoulli(cfg.lateRate) else ontime).append(p)
        out = ontime + late

    for i, p in enumerate(out):
        p.boardingIndex = i
    return out


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

STRATEGIES: Dict[str, Dict[str, Any]] = {
    "random": {
        "name": "Random / free-for-all",
        "description": "Full shuffle. The literature's inconvenient baseline: it beats most "
                       "zone schemes because it spreads passengers along the aisle for free.",
        "fn": strat_random,
    },
    "back_to_front": {
        "name": "Back-to-front zones",
        "description": "Contiguous row blocks, rear block first. Intuitive, and reliably among "
                       "the worst: it concentrates everyone into one short stretch of aisle.",
        "fn": strat_back_to_front,
    },
    "front_to_back": {
        "name": "Front-to-back zones",
        "description": "The pathological control. Every later passenger must walk past every "
                       "earlier one.",
        "fn": strat_front_to_back,
    },
    "wilma": {
        "name": "WilMA (outside-in)",
        "description": "All windows, then middles, then aisles. Eliminates seat interference by "
                       "construction. United's current scheme.",
        "fn": strat_wilma,
    },
    "wilma_zoned": {
        "name": "WilMA x zones (outside-in, back-to-front)",
        "description": "Outside-in, and rear-to-front within each seat-column band. Adds aisle "
                       "spreading to WilMA without losing its zero-interference property.",
        "fn": strat_wilma_zoned,
    },
    "steffen_perfect": {
        "name": "Steffen (perfect)",
        "description": "Alternating rows, window to aisle, alternating sides. The theoretical "
                       "optimum -- and unimplementable, which is exactly the point.",
        "fn": strat_steffen_perfect,
    },
    "steffen_modified": {
        "name": "Steffen (modified / practical)",
        "description": "Four gate-callable groups: even/odd rows by side, window first. Most of "
                       "the benefit, announceable at a gate.",
        "fn": strat_steffen_modified,
    },
    "reverse_pyramid": {
        "name": "Reverse pyramid",
        "description": "Diagonal wave from rear-window to front-aisle. America West measured "
                       "~20% off full flights with this in revenue service.",
        "fn": strat_reverse_pyramid,
    },
    "rotating_zone": {
        "name": "Rotating zone",
        "description": "Alternates rear zone and front zone so the two flows interleave rather "
                       "than queue behind one another.",
        "fn": strat_rotating_zone,
    },
    "block_boarding": {
        "name": "Block boarding (classic zones)",
        "description": "Premium cabin, then rear-to-front blocks. The pre-status-tier standard, "
                       "and the slowest method in the Steffen-Hotchkiss experiment.",
        "fn": strat_block_boarding,
    },
    "open_seating": {
        "name": "Open seating (Southwest legacy)",
        "description": "No assigned seats; passengers choose on entering the cabin. Fast, because "
                       "people self-select to avoid climbing over each other.",
        "fn": strat_open_seating,
    },
    "priority_5tier": {
        "name": "5-tier priority (revenue)",
        "description": "Preboard, premium, elites, main, basic economy. Sells queue position and "
                       "has no spatial logic at all.",
        "fn": strat_priority_5tier,
    },
    "common_sense_5tier": {
        "name": "5-tier common sense",
        "description": "Premium cabin first (commercially fixed), then outside-in crossed with "
                       "rear-first across five printable groups. The best boarding you could "
                       "actually sell.",
        "fn": strat_common_sense_5tier,
    },
    "by_bags": {
        "name": "Bag-count boarding",
        "description": "Zero-bag passengers first, then one, then two. Tests the "
                       "'bags are the bottleneck' hypothesis directly.",
        "fn": strat_by_bags,
    },
    "slowest_first": {
        "name": "Slowest first",
        "description": "Sorted by expected service time, descending. Gets the long stows started "
                       "early; mainly reduces variance rather than the mean.",
        "fn": strat_slowest_first,
    },
}


def build_order(
    pax: List[Passenger], ac: Aircraft, cfg: SimConfig, rng: PCG32
) -> List[Passenger]:
    """Run the named strategy, then the universal pipeline."""
    entry = STRATEGIES.get(cfg.strategy)
    if entry is None:
        raise KeyError(
            f"unknown strategy {cfg.strategy!r}; known: {sorted(STRATEGIES)}"
        )
    queue = entry["fn"](list(pax), ac, cfg, rng)
    if len(queue) != len(pax):
        raise AssertionError(
            f"strategy {cfg.strategy!r} returned {len(queue)} of {len(pax)} passengers"
        )
    return apply_post_processing(queue, cfg, rng)
