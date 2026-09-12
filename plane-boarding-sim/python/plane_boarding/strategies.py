"""The sixteen boarding strategies, plus the universal post-processing pipeline.

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

from typing import Any, Callable, Dict, List, Sequence, Tuple

from .aircraft import AISLE_SEAT, Aircraft, MIDDLE, WINDOW
from .config import (
    SERVICE_PHASE_BEHAVIOUR, SERVICE_STREAM_BASE, SERVICE_STREAM_STRIDE, SimConfig,
)
from .passengers import Passenger
from .rng import PCG32

StrategyFn = Callable[[List[Passenger], Aircraft, SimConfig, PCG32], List[Passenger]]

#: Tiers that buy you an earlier slot within your group (never ahead of everyone).
ELITE_TIERS = ("first", "business", "premium", "elite_top", "elite_mid")

#: How many boarding groups a status tier is worth, for the schemes that merge
#: status INTO the group assignment rather than sorting within a group.
#:
#: This is the construction every real carrier uses, and the one Southwest
#: shipped in January 2026: group = f(where you sit, what you are worth), one
#: merged ordering. The alternative -- "elites board at the front of their
#: assigned group" -- is done by nobody, and on an outside-in scheme it is
#: actively perverse: elites disproportionately buy AISLE seats, outside-in
#: calls aisles last, so it seats a top-tier flyer behind every basic-economy
#: window passenger. See docs/RESEARCH_AIRLINES.md 7 #2.
STATUS_GROUP_SHIFT: Dict[str, int] = {
    "first": -3,
    "business": -3,
    "elite_top": -3,
    "premium": -2,
    "elite_mid": -2,
    "cardholder": -1,
    "standard": 0,
    "basic": 1,
}


def _status_shift(p: Passenger) -> int:
    """Groups earlier (negative) or later (positive) this passenger's status is
    worth. A premium cabin outranks any economy status the passenger also holds."""
    cls = p.seat.classKey if p.seat is not None else "economy"
    if cls != "economy":
        return STATUS_GROUP_SHIFT.get(cls, 0)
    return STATUS_GROUP_SHIFT.get(p.tier, 0)


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

    # Weight the two terms so that ONE depth step is worth exactly ONE full
    # sweep of the cabin. That is what makes the wave diagonal rather than
    # either a row sweep or plain outside-in: the front windows board at the
    # same time as the rear middles, overlapping by exactly one band. Equal
    # 0.5/0.5 weights do NOT do this -- with 31 rows and 3 depths the row term
    # swamps the depth term and the method degenerates into back-to-front.
    w_depth = n_depth / (n_depth + 1.0)
    w_row = 1.0 - w_depth

    def score(p: Passenger) -> float:
        # Both terms run 0..1 with HIGHER = board earlier, so the row term is
        # distance from the FRONT: the rearmost row scores 1.
        row_term = p.rowSlot / n_rows
        depth_term = (p.depth - 1) / n_depth
        return w_row * row_term + w_depth * depth_term

    ranked = _shuffled(rng, pax)
    ranked.sort(key=lambda p: -score(p))

    # QUANTISE into (depth band x row zone) stripes. This is the difference
    # between the real scheme and a naive one: sorting on a continuous score
    # strictly degenerates into a per-passenger sequence, and the tiny residual
    # ordering inside a stripe is worth nothing while costing all the aisle
    # spreading that randomness inside a group buys you. On a 3-3 cabin with
    # four zones this is the twelve diagonal stripes you would actually draw on
    # a seat map.
    n_groups = max(2, ac.maxDepth * cfg.zoneCount)
    total = len(ranked)
    out: List[Passenger] = []
    for g in range(n_groups):
        lo = total * g // n_groups
        hi = total * (g + 1) // n_groups
        out.extend(_label(_shuffled(rng, ranked[lo:hi]), f"Wave {g + 1}"))
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
    spreads the aisle.

    **Status is an input to the group assignment, not a sort within it.** The
    seat location proposes a group; the passenger's status ladder then moves
    them earlier or later by a whole group or three, and the result is ONE
    merged ordering. That is the construction Southwest shipped in 2026 and the
    only one a revenue department will sign: a status flyer in an aisle seat
    lands in an early group, a basic-economy flyer in an aisle seat lands in the
    last one. The previous rule -- elites at the front of their assigned group
    -- looked like a compromise and was in fact the worst of both worlds, since
    outside-in calls aisles last and elites are disproportionately in aisles.
    See docs/RESEARCH_AIRLINES.md 7 #2.

    Party cohesion is MANDATORY here rather than optional (registry flag
    `requiresCohesion`). Every deployed carrier that boards by seat location
    promotes the whole booking to its earliest-boarding member -- United's "same
    and highest applicable", Lufthansa's "and companions" -- so a run of this
    strategy with cohesion off is not a model of anything real.
    """
    econ_slots = ac.economyRowSlots
    mid = econ_slots[len(econ_slots) // 2] if econ_slots else 0

    names = ["Group 1 (premium + top status)",
             "Group 2 (rear windows)",
             "Group 3 (fwd windows + rear middles)",
             "Group 4 (fwd middles + rear aisles)",
             "Group 5 (forward aisles + basic economy)"]
    n_groups = len(names)

    def base_group(p: Passenger) -> int:
        """Where seat location alone would put you: 0 = premium cabin, then the
        outside-in x rear-first ladder across groups 1..4."""
        if p.seat.classKey != "economy":
            return 0
        rear = p.rowSlot >= mid
        kind = p.seat.kind
        if kind == WINDOW:
            return 1 if rear else 2
        if kind == MIDDLE:
            return 2 if rear else 3
        return 3 if rear else 4

    buckets: List[List[Passenger]] = [[] for _ in names]
    for p in pax:
        g = base_group(p) + _status_shift(p)
        if g < 0:
            g = 0
        elif g >= n_groups:
            g = n_groups - 1
        buckets[g].append(p)

    out: List[Passenger] = []
    for i, bucket in enumerate(buckets):
        ordered = _shuffled(rng, bucket)
        # Premium cabin ahead of everyone inside its group, then rear to front,
        # shuffled within a row. The premium tie-break only bites in Group 1,
        # where the status shift also lands top-tier economy passengers: the
        # premium cabin boarding first is the commercially non-negotiable part
        # this whole strategy is built around conceding, and rear-first sorting
        # alone would put it behind the rear-seated elites it shares a group
        # with.
        ordered.sort(key=lambda p: (p.seat.classKey == "economy", -p.rowSlot))
        out.extend(_label(ordered, names[i]))
    return out


def strat_southwest_2026(pax: List[Passenger], ac: Aircraft, cfg: SimConfig, rng: PCG32) -> List[Passenger]:
    """Southwest's post-open-seating scheme, live since 27 January 2026.

    The single most useful strategy in this file for the headline comparison,
    because it is a real converged design rather than a strawman: an airline
    that abandoned 53 years of open seating and, given a blank sheet, chose
    **WilMA x back-to-front merged with fare and status into eight groups**.

    Construction (docs/RESEARCH_AIRLINES.md 1.4):

      * seat location gives a base rank -- window before middle before aisle as
        the outer loop, rear before front within each -- so it is `wilma_zoned`
        by another name;
      * that rank is projected onto EIGHT groups, which is the number Southwest
        actually prints;
      * fare and status then shift you whole groups earlier (A-List Preferred,
        Choice Extra, cardholders) or later (Basic), producing one merged
        ordering rather than a status sort inside a location group.

    Eight groups rather than five is not cosmetic: finer quantisation preserves
    more of the underlying spatial order, and it is the difference between a
    scheme that announces its flow logic and one that only gestures at it.
    """
    bands = _bands(ac, cfg.zoneCount)
    n_bands = len(bands)
    max_depth = max(1, ac.maxDepth)
    n_cells = max_depth * n_bands
    n_groups = 8

    def location_rank(p: Passenger) -> int:
        # Deepest seat (window) first, then rearmost band first: identical to
        # the emission order of `wilma_zoned`.
        depth_rank = max_depth - max(1, min(max_depth, p.depth))
        band_rank = n_bands - 1 - _band_of(p.rowSlot, bands)
        return depth_rank * n_bands + band_rank

    buckets: List[List[Passenger]] = [[] for _ in range(n_groups)]
    for p in pax:
        g = (location_rank(p) * n_groups) // n_cells
        g += _status_shift(p)
        if g < 0:
            g = 0
        elif g >= n_groups:
            g = n_groups - 1
        buckets[g].append(p)

    out: List[Passenger] = []
    for i, bucket in enumerate(buckets):
        ordered = _shuffled(rng, bucket)
        # WilMA still runs INSIDE each group, which is what Southwest's own
        # material describes ("Group 1 ... reportedly the window subset first").
        # It matters most for the passengers a status shift dropped into a group
        # their seat would not have earned: without this an A-List aisle seat
        # called in Group 2 would board ahead of the Group 2 windows and undo
        # the zero-interference property the scheme is built on.
        ordered.sort(key=lambda p: (-p.depth, -p.rowSlot))
        out.extend(_label(ordered, f"Group {i + 1} of {n_groups}"))
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

def requires_cohesion(strategy: str) -> bool:
    """Is party cohesion structural to this strategy rather than a friction?

    For most strategies `keepPartiesTogether` is a friction knob: turning it off
    shows you what the method would be worth if families did not exist. For a
    strategy whose group assignment is a joint function of seat location and
    fare -- `common_sense_5tier`, `southwest_2026` -- it is part of the
    construction. Every carrier that boards this way promotes the whole booking
    to its earliest-boarding member, so a run with cohesion off is not a model
    of anything anyone operates. Those strategies force it on.
    """
    entry = STRATEGIES.get(strategy)
    return bool(entry and entry.get("requiresCohesion"))


def apply_post_processing(
    queue: List[Passenger], cfg: SimConfig
) -> List[Passenger]:
    """Preboards -> party cohesion -> non-compliance -> late arrivals.

    Order matters and is normative. Together these four steps are what separates
    a paper result from a gate result: they are the frictions that shrink
    Steffen's theoretical 2x to the ~20-25% airlines actually measure.

    Takes no RNG. It used to take the `order` stream for the non-compliance and
    lateness draws; those are per-passenger behaviours now and come from the
    passenger's own sub-stream, so the `order` stream is consumed only by the
    strategy function itself.
    """
    out = list(queue)
    cohere = cfg.keepPartiesTogether or requires_cohesion(cfg.strategy)

    # Steps 3 and 4 draw a per-PASSENGER behaviour -- "does this person ignore
    # their group" and "does this person turn up late" -- and both used to come
    # off the shared `order` stream in queue order, which made them depend on
    # the very ordering they are supposed to perturb. Drawn from the passenger's
    # own sub-stream instead, the same traveller misbehaves in the same way
    # under every strategy, which is what a paired comparison needs. The draw
    # sequence within the stream is fixed -- compliance bernoulli, then the
    # jitter randint if and only if that bernoulli came up, then the lateness
    # bernoulli -- and its length therefore depends only on values that are
    # themselves invariant. See ENGINE_SPEC 1.3.
    def behaviour_rng(p: Passenger) -> PCG32:
        return PCG32(cfg.seed, SERVICE_STREAM_BASE
                     + p.id * SERVICE_STREAM_STRIDE + SERVICE_PHASE_BEHAVIOUR)

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
    #    Cohesion is PROMOTE-TO-EARLIEST: the party is emitted whole at the
    #    queue position of whichever member the strategy called first, never at
    #    a mean or a latest position. That is what every carrier with a published
    #    companion rule does (United "same and highest applicable", Lufthansa
    #    "and companions"), and it is verified by
    #    test_party_cohesion_promotes_to_the_earliest_member.
    if cohere:
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
    #
    # ENGINE_SPEC 1.3 pins the behaviour stream as Bernoulli(nonComplianceRate),
    # then -- ONLY IF THAT CAME UP -- randint(2*jitter+1), then
    # Bernoulli(lateRate). Both conditions in that sentence are on the Bernoulli,
    # not on `complianceJitter`, and that is the whole point: the draw sequence
    # must not be a function of the jitter WIDTH, or else who arrives late
    # changes when you move a slider that has nothing to do with lateness.
    #
    # This used to gate the entire step on `rate > 0 and jitter > 0`, so at
    # jitter 0 the compliance Bernoulli was never drawn and the late Bernoulli
    # became the first draw instead of the second. Parity was never at risk
    # (both engines did the same wrong thing); the CRN property this phase
    # separation exists to provide was.
    #
    # `randint(1)` at jitter 0 consumes exactly one draw and returns 0, so
    # drawing it unconditionally costs nothing and moves nobody -- which is why
    # the sequence stays fixed while the behaviour stays correct.
    jitter = cfg.complianceJitter
    do_jitter = cfg.nonComplianceRate > 0
    do_late = cfg.lateRate > 0
    if do_jitter or do_late:
        behaviour = {p.id: behaviour_rng(p) for p in out}

    if do_jitter:
        keyed: List[Tuple[int, int, Passenger]] = []
        for i, p in enumerate(out):
            k = 0
            r = behaviour[p.id]
            if r.bernoulli(cfg.nonComplianceRate):
                k = r.randint(2 * jitter + 1) - jitter
            keyed.append((i + k, i, p))
        keyed.sort(key=lambda t: (t[0], t[1]))
        out = [t[2] for t in keyed]

    # 4. Late arrivals -- the sprint from the connecting gate.
    if do_late:
        late: List[Passenger] = []
        ontime: List[Passenger] = []
        for p in out:
            (late if behaviour[p.id].bernoulli(cfg.lateRate) else ontime).append(p)
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
                       "construction. Real deployments are always hybrids: United applies it only "
                       "to the economy residual below Groups 1-2 and boards Basic Economy after "
                       "the aisles; Lufthansa and ANA run it too, and Southwest adopted it in "
                       "January 2026.",
        "fn": strat_wilma,
    },
    "wilma_zoned": {
        "name": "WilMA x zones (outside-in, back-to-front)",
        "description": "Outside-in, and rear-to-front within each seat-column band. Adds aisle "
                       "spreading to WilMA without losing its zero-interference property. This is "
                       "a live scheme, not a proposal: it is the structure Southwest went to on "
                       "27 January 2026 -- see southwest_2026 for the version with the fare and "
                       "status ladder merged in.",
        "fn": strat_wilma_zoned,
    },
    "steffen_perfect": {
        "name": "Steffen (perfect)",
        "description": "Alternating rows, window to aisle, alternating sides. The theoretical "
                       "optimum, and unimplementable -- but not mainly for the reason usually "
                       "given. Ahead of passenger compliance come mandatory party cohesion, "
                       "alliance and status contractual obligations, and the plain absence of any "
                       "gate infrastructure for sequencing individual passengers. Compliance is "
                       "the reason this model can measure, not the binding one.",
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
        "description": "Diagonal wave from rear-window to front-aisle, and the best-evidenced "
                       "flow method ever flown: America West measured -2 minutes (~20%) on full "
                       "flights and -21% departure delays over the first three months (van den "
                       "Briel et al., Interfaces 35(3):191-201, 2005). It disappeared through two "
                       "merger integrations and no source gives a performance reason. JAL's 2024 "
                       "window-and-rear scheme is a coarse two-group descendant.",
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
        "name": "Open seating (Southwest, 1971-2026)",
        "description": "RETIRED. No assigned seats; passengers choose on entering the cabin. Fast, "
                       "because people self-select to avoid climbing over each other. Southwest "
                       "ran it for 53 years and ended it on 27 January 2026; no airline of "
                       "consequence now uses it, so this is a historical baseline rather than a "
                       "live option.",
        "fn": strat_open_seating,
    },
    "priority_5tier": {
        "name": "5-tier priority (revenue)",
        "description": "Preboard, premium, elites, main, basic economy: the revenue-only case, "
                       "representing Delta, American and Air France. It has no DELIBERATE spatial "
                       "logic, but it is not spatially neutral -- status and premium cabins sit "
                       "forward, so selling queue position quietly buys front-to-back boarding. "
                       "Compare against the revenue-then-flow carriers (United, Lufthansa, ANA, "
                       "JAL, BA, Southwest) modelled by wilma and southwest_2026. Tier placement "
                       "is carrier-dependent at the top: this models the generic US-legacy case "
                       "with First and Business in Tier 1, where American has preboarded them "
                       "since 1 May 2025.",
        "fn": strat_priority_5tier,
    },
    "common_sense_5tier": {
        "name": "5-tier common sense",
        "description": "Outside-in crossed with rear-first across five printable groups, with fare "
                       "and status merged INTO the group assignment rather than sorted within it, "
                       "so a status flyer in an aisle seat still boards early. The best boarding "
                       "you could actually sell. Party cohesion is mandatory, as it is for every "
                       "carrier that boards by seat location.",
        "requiresCohesion": True,
        "fn": strat_common_sense_5tier,
    },
    "southwest_2026": {
        "name": "Southwest 2026 (WilMA x zones + status, 8 groups)",
        "description": "The real converged design: Southwest replaced 53 years of open seating on "
                       "27 January 2026 with window/middle/aisle boarded rear-to-front, merged "
                       "with fare and Rapid Rewards status into eight numbered groups. Live on "
                       "roughly 4,000 daily flights, which makes this the benchmark any proposal "
                       "in this list has to beat.",
        "requiresCohesion": True,
        "fn": strat_southwest_2026,
    },
    "by_bags": {
        "name": "Bag-count boarding",
        "description": "Zero-bag passengers first, then one, then two. Tests the 'bags are the "
                       "bottleneck' hypothesis directly -- and the field evidence says bags win: "
                       "Spirit reportedly cut boarding by ~6 minutes by charging for carry-ons, "
                       "roughly three times the best claimed ordering benefit, from a pricing "
                       "change with no gate process change at all. Boarding has slowed from ~15 "
                       "minutes in the 1970s to 30-40 for ~140 passengers today. Note the "
                       "literature finds the REVERSE order (most luggage first) is what shortens "
                       "boarding, so this particular sort is a foil.",
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
    return apply_post_processing(queue, cfg)
