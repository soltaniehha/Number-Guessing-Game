"""The simulation loop (ENGINE_SPEC 6).

Continuous space, discrete time. Passengers hold a real-valued position along a
one-dimensional aisle lane and the world advances in fixed `dt` steps.

Three service-time models do most of the work, and all three are Schultz's
field-calibrated ones rather than convenient guesses:

* **Door arrivals** are exponential with mean 3.7 s. This is easy to overlook
  and it dominates: a 186-seat single-door boarding cannot finish in under
  11.5 minutes no matter how clever the ordering is.
* **Stowing** is the sum of one Weibull(1.7, 16 s) draw per piece of luggage.
  Summing per piece rather than fitting a per-passenger total is what gives the
  right super-linear variance for two-bag passengers.
* **Seat shuffles** are an integer number of elementary movements, each
  Triangular(1.8, 2.4, 3.0) s. The count depends on *which* seats block, not
  merely how many: aisle-blocked is 4 movements, middle-blocked-window is 5,
  both-blocked-window is 9. Even an unobstructed passenger pays 1 movement just
  to sit down, which is a surprisingly large share of the total.

Implementation note on speed: hot state lives in flat lists indexed by
passenger id, not in objects. A Monte Carlo sweep runs hundreds of replications
in a browser worker, so the inner loop has to stay free of attribute lookups.
"""

from __future__ import annotations

import math
from bisect import bisect_left
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .aircraft import Aircraft, Door, Seat, get_aircraft
from .config import (
    BODY_DEPTH, DESIRED_HEADWAY, DOOR_STREAM_BASE, MAX_SIM_SECONDS,
    MIN_SPEED_FRACTION, ORDER_STREAM, PAX_STREAM, QUEUED, SEATED,
    SERVICE_PHASE_BIN, SERVICE_PHASE_SHUFFLE, SERVICE_PHASE_STOW,
    SERVICE_STREAM_BASE, SERVICE_STREAM_STRIDE, SHUFFLING, STOWING, WALKING,
    ConfigError, SimConfig, ticks_for,
)
from .metrics import PassengerRecord, RunResult, percentile
from .passengers import Passenger, generate
from .rng import PCG32
from .strategies import STRATEGIES, build_order

OPEN_SEATING = "open_seating"


# ---------------------------------------------------------------------------
# Door assignment (ENGINE_SPEC 5)
# ---------------------------------------------------------------------------

def _split_boundaries(doors: Sequence[Door]) -> List[float]:
    """Midpoints between consecutive doors, sorted fore to aft."""
    xs = sorted(d.x for d in doors)
    return [(xs[i] + xs[i + 1]) * 0.5 for i in range(len(xs) - 1)]


def _door_for_x(doors_sorted: Sequence[Door], bounds: Sequence[float], x: float) -> Door:
    return doors_sorted[bisect_left(bounds, x)]


def assign_doors(
    queue: Sequence[Passenger], ac: Aircraft, doors: Sequence[Door],
    cfg: SimConfig, open_seating: bool
) -> None:
    """Stamp `doorId` on every passenger."""
    if len(doors) == 1 or cfg.doorAssignment == "single":
        for p in queue:
            p.doorId = doors[0].id
        return

    if open_seating:
        # Nobody has a seat yet, so a seat-based split is meaningless. Ground
        # staff feed the queue into both doors at once -- but the split must be
        # proportional to how many seats each door's HALF OF THE CABIN holds,
        # not a flat round robin. If a door outran its own region, its remaining
        # passengers would have to walk past the other door to find a seat, and
        # two streams walking head-on down a single-file aisle deadlock: neither
        # can pass and neither will ever yield. Quota-ing by region capacity
        # makes that geometrically impossible rather than merely unlikely.
        caps = [len(v) for v in door_regions(ac, doors)]
        left = list(caps)
        for p in queue:
            best, best_key = 0, -1.0
            for i, c in enumerate(caps):
                key = (left[i] / c) if c else -1.0
                if key > best_key:
                    best, best_key = i, key
            left[best] -= 1
            p.doorId = doors[best].id
        return

    by_x = sorted(doors, key=lambda d: d.x)
    bounds = _split_boundaries(by_x)

    if cfg.doorAssignment == "split_by_row":
        for p in queue:
            p.doorId = _door_for_x(by_x, bounds, p.seat.x).id
        return

    # split_by_aisle: use the door feeding your seat's aisle, ties broken by row.
    per_aisle: Dict[int, List[Door]] = {}
    for d in by_x:
        per_aisle.setdefault(d.aisleIndex, []).append(d)
    fallback_bounds = bounds
    for p in queue:
        cand = per_aisle.get(p.seat.aisleIndex)
        if not cand:
            p.doorId = _door_for_x(by_x, fallback_bounds, p.seat.x).id
        elif len(cand) == 1:
            p.doorId = cand[0].id
        else:
            p.doorId = _door_for_x(cand, _split_boundaries(cand), p.seat.x).id


def door_regions(ac: Aircraft, doors: Sequence[Door]) -> List[List[Seat]]:
    """Partition every seat to the nearest door, splitting at the midpoints
    between consecutive doors. Same rule as `split_by_row`, reused so the open
    seating quota and the assigned-seat door split cannot disagree."""
    by_x = sorted(doors, key=lambda d: d.x)
    bounds = _split_boundaries(by_x)
    order = {d.id: i for i, d in enumerate(doors)}
    out: List[List[Seat]] = [[] for _ in doors]
    for seat in ac.seats:
        out[order[_door_for_x(by_x, bounds, seat.x).id]].append(seat)
    return out


# ---------------------------------------------------------------------------
# Open seating (ENGINE_SPEC 6.5)
# ---------------------------------------------------------------------------

_KIND_RANK = {
    "aisle_first": {"Aisle": 0, "Window": 1, "Middle": 2},
    "window_first": {"Window": 0, "Aisle": 1, "Middle": 2},
}


class _OpenSeatPicker:
    """Chooses a seat at the moment a passenger crosses the door line.

    That timing is the whole point: the choice depends on who is already seated,
    which is exactly the real dynamic and the reason open seating is quicker
    than its reputation -- people spontaneously avoid climbing over strangers.
    """

    def __init__(self, ac: Aircraft, policy: str, doors: Sequence[Door]):
        self.policy = policy
        # One free list per door, covering only that door's half of the cabin.
        # Confining the choice to your own region is what keeps two boarding
        # streams from walking into each other in a single-file aisle.
        self.free: Dict[str, List[Seat]] = {
            d.id: seats for d, seats in zip(doors, door_regions(ac, doors))
        }
        # Distance from each seat to the nearest already-SEATED passenger.
        # Maintained incrementally: recomputing it per choice would be O(S^2)
        # per passenger on a 197-seat aircraft.
        self.nearest = [float("inf")] * ac.seatCount
        self.rank = _KIND_RANK.get(policy)

    def on_seated(self, seat: Seat) -> None:
        """Refresh the nearest-seated-neighbour distance for every free seat.

        This is O(free seats) per seating, so O(S^2) over a boarding, and it is
        the obvious thing to blame for open seating costing ~2-3x a normal
        strategy. It is not the cause, and it was measured rather than reasoned
        about: on a b777 at 90% load it is **2.5% of the run** (18 ms of 728 ms
        under cProfile). The quadratic that actually costs is the `min()` in
        `take` below -- one linear scan of the free pool per door release,
        ~54% of the run -- and `front_first`, which never calls this method at
        all, is the slowest policy of the four.

        A note for whoever reaches for this again. The port left it alone on the
        grounds that `give_back` can reinsert a seat that missed intervening
        updates. **That reasoning is wrong**: `take` and `give_back` are adjacent
        statements in the door-release loop with no `sit_down` between them, so a
        seat is never out of the pool across an `on_seated` call. The reason to
        leave it alone is the measurement above -- optimising 2.5% cannot help,
        and every way of speeding up `take` that is worth having (squared
        distances, a spatial index) changes floating-point tie-breaking, which
        changes which seat is chosen, which changes the draw sequence. A lazily
        revalidated priority queue in `take` WOULD be provably identical, because
        `nearest` only ever decreases and the sort key ends in `s.index` so the
        order is total; that is the change to make if this ever matters.
        """
        if self.policy != "avoid_neighbours":
            return
        sx, sl = seat.x, seat.lateral
        nearest = self.nearest
        for pool in self.free.values():
            for s in pool:
                dx = s.x - sx
                dl = s.lateral - sl
                d = math.sqrt(dx * dx + dl * dl)
                if d < nearest[s.index]:
                    nearest[s.index] = d

    def give_back(self, door_id: str, seat: Seat) -> None:
        """Un-commit a seat when the aisle turned out to be blocked. The pool is
        kept in seat-index order so the retry next tick is bit-identical."""
        pool = self.free[door_id]
        lo, hi = 0, len(pool)
        while lo < hi:
            mid = (lo + hi) // 2
            if pool[mid].index < seat.index:
                lo = mid + 1
            else:
                hi = mid
        pool.insert(lo, seat)

    def take(self, door_id: str, door_x: float) -> Optional[Seat]:
        pool = self.free[door_id]
        if not pool:
            return None
        policy = self.policy
        if policy == "front_first":
            best = min(pool, key=lambda s: (abs(s.x - door_x), s.index))
        elif policy == "avoid_neighbours":
            nearest = self.nearest
            best = min(
                pool,
                key=lambda s: (-_finite(nearest[s.index]), abs(s.x - door_x), s.index),
            )
        else:
            rank = self.rank
            best = min(pool, key=lambda s: (rank[s.kind], s.x, s.index))
        pool.remove(best)
        return best


def _finite(v: float) -> float:
    """`inf` sorts badly through a tuple key in some runtimes; cap it instead."""
    return 1e9 if v == float("inf") else v


# ---------------------------------------------------------------------------
# The simulation
# ---------------------------------------------------------------------------

class _DoorState:
    """One door's jetbridge queue.

    Each door owns its own PCG32 stream, advanced once per release. The k-th
    person to walk through a given door therefore waits the same drawn gap no
    matter which strategy put them there, which is what makes the door arrival
    process cancel exactly in a paired comparison (ENGINE_SPEC 1.3).

    `arrival_tick` is when the CURRENT head of the queue reaches the door, and it
    advances by one exponential draw per release regardless of whether the aisle
    let that passenger in. That distinction matters more than it looks: the door
    arrival process and aisle congestion run in PARALLEL, not in series. People
    pile up on the jetbridge while the aisle is jammed and then walk on
    back-to-back once it clears. Adding the two delays instead of max-ing them
    roughly doubles the modelled boarding time -- it was the single biggest
    calibration error in the first cut of this engine.
    """

    __slots__ = ("door", "queue", "cursor", "arrival_tick", "rng")

    def __init__(self, door: Door, seed: int, index: int):
        self.door = door
        self.queue: List[int] = []
        self.cursor = 0
        self.arrival_tick = 0
        self.rng = PCG32(seed, DOOR_STREAM_BASE + index)


def run(
    cfg: SimConfig,
    ac: Optional[Aircraft] = None,
    record_replay: bool = False,
    frame_interval: float = 0.25,
    tick_hook: Optional[Any] = None,
) -> Tuple[RunResult, Optional[Dict[str, Any]]]:
    """Simulate one boarding. Returns `(RunResult, replay_or_None)`.

    `tick_hook`, if given, is called at the end of every tick as
    `hook(tick, t, pstate, px, plane, pdir, passing, pass_holder)`. It exists so the
    test suite can assert invariants that involve the squeeze LOCK, which is
    interior state the replay format deliberately does not carry -- notably
    "a walker inside a stower's body-depth zone holds that stower's lock",
    the assertion that would have caught the squeeze-past deadlock. It is not
    part of the simulation: nothing it is handed may be mutated, and the
    default of `None` costs one comparison per tick.
    """
    if ac is None:
        ac = get_aircraft(cfg.aircraftId)
    if cfg.strategy not in STRATEGIES:
        raise ConfigError(
            f"unknown strategy {cfg.strategy!r}; known: {sorted(STRATEGIES)}"
        )

    doors = ac.resolve_doors(cfg.doors)
    open_seating = cfg.strategy == OPEN_SEATING

    rng_pax = PCG32(cfg.seed, PAX_STREAM)
    rng_order = PCG32(cfg.seed, ORDER_STREAM)

    pax = generate(rng_pax, ac, cfg)
    queue = build_order(pax, ac, cfg, rng_order) if pax else []
    assign_doors(queue, ac, doors, cfg, open_seating)

    n = len(queue)
    dt = cfg.dt
    bin_cap_override = cfg.binBagsPerRowSide

    # ---- flat state -------------------------------------------------------
    px = [0.0] * n
    ptarget = [0.0] * n
    pdir = [1] * n
    pspeed = [0.0] * n
    pstate = [QUEUED] * n
    pblocked = [0.0] * n
    ptrav = [0.0] * n
    plane = [0] * n
    penter = [0.0] * n
    psit = [0.0] * n
    pwalk = [0.0] * n
    pstow = [0.0] * n
    pshuf = [0.0] * n
    pnblock = [0] * n
    pwasblocked = [False] * n
    pgatechecked = [0] * n
    pidx = [0] * n
    # Partial-blocking bookkeeping. A STOWING passenger stands in the seat-row
    # gap rather than the aisle centreline, so exactly ONE follower at a time
    # may squeeze past them; `pass_holder` is that mutual exclusion and
    # `passing` is the follower's side of it. `stow_done` closes the squeeze to
    # new entrants the moment the stow finishes, so a stower in heavy traffic
    # cannot be starved of its chance to sit down.
    pass_holder = [-1] * n
    passing = [-1] * n
    stow_done = [False] * n
    pending_shuffle: List[int] = []

    pbags = [0] * n
    pmult = [1.0] * n
    pdepth = [0] * n
    prow = [0] * n
    pblockid = [0] * n
    pbinrun = [0] * n
    pparty = [0] * n
    ppaxid = [0] * n
    pseat: List[Optional[Seat]] = [None] * n

    for p in queue:
        i = p.boardingIndex
        pbags[i] = p.bags
        pmult[i] = p.stowMultiplier
        pspeed[i] = p.walkSpeed
        pparty[i] = p.partyId
        # The PASSENGER id, not the boarding index: it is assigned in canonical
        # seat order off the `pax` stream and is therefore the same person under
        # every strategy. Keying the service streams on it is the whole point.
        ppaxid[i] = p.id
        if not open_seating:
            s = p.seat
            pseat[i] = s
            pdepth[i] = s.depth
            prow[i] = s.rowSlot
            pblockid[i] = s.blockId
            pbinrun[i] = s.binRun
            plane[i] = s.aisleIndex
            ptarget[i] = s.x

    picker = _OpenSeatPicker(ac, cfg.openSeatingPolicy, doors) if open_seating else None

    # ---- lanes ------------------------------------------------------------
    n_lanes = ac.aisleCount
    lane_occ: List[List[int]] = [[] for _ in range(n_lanes)]
    lane_walk: List[List[int]] = [[] for _ in range(n_lanes)]

    # ---- doors ------------------------------------------------------------
    door_states = [_DoorState(d, cfg.seed, i) for i, d in enumerate(doors)]
    door_by_id = {ds.door.id: ds for ds in door_states}
    for p in queue:
        door_by_id[p.doorId].queue.append(p.boardingIndex)

    # ---- overhead bins ----------------------------------------------------
    row_caps: List[List[int]] = []
    for rs in ac.rowSlots:
        if bin_cap_override is None:
            row_caps.append(list(rs.binCaps))
        else:
            row_caps.append([bin_cap_override if c > 0 else 0 for c in rs.binCaps])
    bin_used: List[List[int]] = [[0] * len(c) for c in row_caps]
    n_rows = len(row_caps)

    # ---- seated occupancy, for the shuffle model --------------------------
    seated_block: Dict[Tuple[int, int], List[Tuple[int, int]]] = {}

    # ---- congestion bucketing --------------------------------------------
    centres = [rs.x for rs in ac.rowSlots]
    edges = [(centres[i] + centres[i + 1]) * 0.5 for i in range(n_rows - 1)]

    # ---- counters ---------------------------------------------------------
    gate_checks = 0
    bin_searches = 0
    block_events = 0
    inter_none = inter_one = inter_two = inter_same = 0
    seated_count = 0

    wake: Dict[int, List[int]] = {}

    # ---- per-passenger service streams (ENGINE_SPEC 1.3) ------------------
    # One PCG32 per passenger per service phase, keyed on the passenger id.
    # Built lazily: a passenger with no bags never needs a stow stream, and most
    # passengers never need a bin-search one.
    #
    # Phases are SEPARATE streams rather than a single per-passenger sequence
    # because two of them consume a number of draws that legitimately depends on
    # the boarding order -- how many bin searches you make depends on who filled
    # the bin, how many shuffle movements you make depends on who is already
    # sitting there. Sharing one stream would let that variable count shift
    # every later draw and reintroduce exactly the order dependence this is here
    # to remove.
    seed = cfg.seed
    stow_streams: List[Optional[PCG32]] = [None] * n
    bin_streams: List[Optional[PCG32]] = [None] * n
    shuffle_streams: List[Optional[PCG32]] = [None] * n

    def service_rng(cache: List[Optional[PCG32]], pid: int, phase: int) -> PCG32:
        r = cache[pid]
        if r is None:
            r = PCG32(seed, SERVICE_STREAM_BASE
                      + ppaxid[pid] * SERVICE_STREAM_STRIDE + phase)
            cache[pid] = r
        return r

    # ---- local bindings for the hot loop ----------------------------------
    w_shape, w_scale = cfg.stowWeibullShape, cfg.stowWeibullScale
    t_lo, t_mode, t_hi = cfg.shuffleMoveMin, cfg.shuffleMoveMode, cfg.shuffleMoveMax
    mv = cfg.shuffleMovements
    mv_none, mv_aisle, mv_mid, mv_both = mv["none"], mv["aisle"], mv["middle"], mv["both"]
    mv_party = cfg.shuffleSamePartyMovements
    bin_radius = cfg.binSearchRadius
    bin_penalty = cfg.binSearchPenalty
    gate_penalty = cfg.gateCheckPenalty
    bin_weight = cfg.binCongestionWeight
    door_mean = cfg.doorArrivalMean
    pass_factor = cfg.stowPassSpeedFactor
    headway = DESIRED_HEADWAY
    body = BODY_DEPTH
    min_frac = MIN_SPEED_FRACTION

    sample_ticks = max(1, int(round(cfg.sampleInterval / dt)))
    max_ticks = int(MAX_SIM_SECONDS / dt)

    seated_curve: List[Tuple[float, int]] = []
    aisle_curve: List[Tuple[float, int]] = []
    congestion: List[List[int]] = [[] for _ in range(n_rows)]

    frames_state: List[List[int]] = []
    frames_x: List[List[float]] = []
    next_frame_t = 0.0

    # ---- helpers (closures; called O(n) times, not O(n*ticks)) ------------

    def lane_insert(lane: int, pid: int) -> None:
        occ = lane_occ[lane]
        x = px[pid]
        i = len(occ)
        while i > 0 and px[occ[i - 1]] > x:
            i -= 1
        occ.insert(i, pid)
        for j in range(i, len(occ)):
            pidx[occ[j]] = j

    def lane_remove(lane: int, pid: int) -> None:
        occ = lane_occ[lane]
        i = pidx[pid]
        del occ[i]
        for j in range(i, len(occ)):
            pidx[occ[j]] = j

    def door_clear(lane: int, x: float) -> bool:
        """Is the doorway free by one body depth?

        Stowing passengers count here even though they are soft obstructions
        once you are walking. Releasing somebody straight into a stower's
        squeeze zone would put them there without the squeeze lock, and if the
        stow then finished neither could move: the stower would wait for the
        aisle to clear while the walker waited for the stower. Keeping the
        doorway strictly clear removes the whole failure mode, and it costs
        little realism -- a passenger stowing at row 1 really does hold up the
        door.
        """
        occ = lane_occ[lane]
        if not occ:
            return True
        # occ is sorted by x, so only the two neighbours of the door position
        # can possibly be within one body depth of it.
        lo, hi = 0, len(occ)
        while lo < hi:
            mid = (lo + hi) // 2
            if px[occ[mid]] < x:
                lo = mid + 1
            else:
                hi = mid
        if lo < len(occ) and px[occ[lo]] - x < body:
            return False
        if lo > 0 and x - px[occ[lo - 1]] < body:
            return False
        return True

    def stow_penalty(pid: int, slot: int, run: int, bags: int) -> float:
        """Place `bags` in the overhead bins, returning the seconds of extra
        faff. Searching outward and gate-checking are extrapolation, not
        literature -- no published boarding paper puts a number on them."""
        nonlocal bin_searches, gate_checks
        penalty = 0.0
        caps = row_caps[slot]
        rng_bin = None
        for _ in range(bags):
            if run < len(caps) and bin_used[slot][run] < caps[run]:
                bin_used[slot][run] += 1
                continue
            bin_searches += 1
            if rng_bin is None:
                rng_bin = service_rng(bin_streams, pid, SERVICE_PHASE_BIN)
            first = 1 if rng_bin.bernoulli(0.5) else -1
            placed = False
            for d in range(1, bin_radius + 1):
                for sgn in (first, -first):
                    r2 = slot + sgn * d
                    if 0 <= r2 < n_rows:
                        c2 = row_caps[r2]
                        if run < len(c2) and bin_used[r2][run] < c2[run]:
                            bin_used[r2][run] += 1
                            penalty += bin_penalty * d
                            placed = True
                            break
                if placed:
                    break
            if not placed:
                gate_checks += 1
                penalty += gate_penalty
        return penalty

    def stower_clear(pid: int) -> bool:
        """May this stower stand its neighbours up yet?

        Not while anybody is within a body depth of them -- and that is a wider
        condition than "somebody holds the squeeze lock", because a passenger
        released at the door can land inside a stower's zone without ever having
        taken the lock (door clearance ignores stowers, by design). occ is
        sorted, so only the immediate neighbours can be close enough to matter.
        """
        occ = lane_occ[plane[pid]]
        i = pidx[pid]
        x = px[pid]
        if i > 0 and x - px[occ[i - 1]] < body - 1e-9:
            return False
        if i + 1 < len(occ) and px[occ[i + 1]] - x < body - 1e-9:
            return False
        return True

    def release_pass(pid: int) -> None:
        sp = passing[pid]
        if sp >= 0:
            if pass_holder[sp] == pid:
                pass_holder[sp] = -1
            passing[pid] = -1

    def begin_shuffle(pid: int, t: float, tick: int) -> None:
        nonlocal inter_none, inter_one, inter_two, inter_same
        key = (prow[pid], pblockid[pid])
        occupants = seated_block.get(key)
        d = pdepth[pid]
        blockers = [o for o in occupants if o[0] < d] if occupants else []
        nb = len(blockers)
        pnblock[pid] = nb
        if nb == 0:
            inter_none += 1
            moves = mv_none
        else:
            party = pparty[pid]
            if all(o[1] == party for o in blockers):
                inter_same += 1
                moves = mv_party
            else:
                has_aisle = any(o[0] == 1 for o in blockers)
                has_mid = any(o[0] >= 2 for o in blockers)
                if has_aisle and has_mid:
                    moves = mv_both
                elif has_mid:
                    moves = mv_mid
                else:
                    moves = mv_aisle
                if nb == 1:
                    inter_one += 1
                else:
                    inter_two += 1
        dur = 0.0
        if moves:
            rng_shuf = service_rng(shuffle_streams, pid, SERVICE_PHASE_SHUFFLE)
            for _ in range(moves):
                dur += rng_shuf.triangular(t_lo, t_mode, t_hi)
        dur *= pmult[pid]
        pshuf[pid] = dur
        if dur > 0.0:
            pstate[pid] = SHUFFLING
            wake.setdefault(tick + ticks_for(dur, dt), []).append(pid)
        else:
            sit_down(pid, t)

    def sit_down(pid: int, t: float) -> None:
        nonlocal seated_count
        pstate[pid] = SEATED
        psit[pid] = t
        lane_remove(plane[pid], pid)
        seated_block.setdefault((prow[pid], pblockid[pid]), []).append(
            (pdepth[pid], pparty[pid])
        )
        seated_count += 1
        if picker is not None:
            picker.on_seated(pseat[pid])

    def arrive(pid: int, t: float, tick: int) -> None:
        release_pass(pid)
        pwalk[pid] = t - penter[pid]
        bags = pbags[pid]
        if bags <= 0:
            pstow[pid] = 0.0
            begin_shuffle(pid, t, tick)
            return
        slot, run = prow[pid], pbinrun[pid]
        caps = row_caps[slot]
        if run >= len(caps):
            # The seat says it stows under bin run `run`, and that run does not
            # exist above its own row. That is a broken geometry, not a full
            # bin: treating it as one (the old `else 1.0`) silently charged the
            # passenger the maximum bin-congestion penalty and hid the fault.
            seat = pseat[pid]
            raise ConfigError(
                f"{ac.id}: seat {seat.id if seat else '?'} at row slot {slot} "
                f"declares binRun {run}, but that row has only {len(caps)} bin "
                f"run(s). The seat map and the per-row bin capacities disagree."
            )
        cap = caps[run]
        # cap == 0 is a different thing entirely and IS legitimate: a bin run
        # declared with zero capacity (binBagsPerRowSide = 0) is full because it
        # never had room, so maximum congestion is the right answer there.
        fill = (bin_used[slot][run] / cap) if cap > 0 else 1.0
        base = 0.0
        rng_stow = service_rng(stow_streams, pid, SERVICE_PHASE_STOW)
        for _ in range(bags):
            base += rng_stow.weibull(w_shape, w_scale)
        dur = base * pmult[pid] * (1.0 + bin_weight * fill * fill)
        before = gate_checks
        dur += stow_penalty(pid, slot, run, bags)
        pgatechecked[pid] = gate_checks - before
        pstow[pid] = dur
        if dur > 0.0:
            pstate[pid] = STOWING
            wake.setdefault(tick + ticks_for(dur, dt), []).append(pid)
        else:
            begin_shuffle(pid, t, tick)

    # ---- main loop --------------------------------------------------------
    tick = 0
    t = 0.0
    while seated_count < n and tick <= max_ticks:
        t = tick * dt

        # (a) release from door queues, in declared door order
        for ds in door_states:
            if ds.cursor >= len(ds.queue) or tick < ds.arrival_tick:
                continue
            pid = ds.queue[ds.cursor]
            door = ds.door
            if picker is not None:
                seat = picker.take(door.id, door.x)
                if seat is None:
                    continue
                pseat[pid] = seat
                pdepth[pid] = seat.depth
                prow[pid] = seat.rowSlot
                pblockid[pid] = seat.blockId
                pbinrun[pid] = seat.binRun
                plane[pid] = seat.aisleIndex
                ptarget[pid] = seat.x
            lane = plane[pid]
            if not door_clear(lane, door.x):
                if picker is not None:
                    picker.give_back(door.id, pseat[pid])   # retry next tick
                continue
            px[pid] = door.x
            penter[pid] = t
            pdir[pid] = 1 if ptarget[pid] >= door.x else -1
            pstate[pid] = WALKING
            lane_insert(lane, pid)
            lane_walk[lane].append(pid)
            ds.cursor += 1
            # Cumulative, NOT `tick + ...`: the jetbridge queue keeps filling
            # while the aisle is blocked, so a backlog discharges at once.
            ds.arrival_tick += ticks_for(ds.rng.exponential(door_mean), dt)
            if abs(ptarget[pid] - px[pid]) < 1e-9:
                lane_walk[lane].remove(pid)
                arrive(pid, t, tick)

        # (b) service completions
        due = wake.pop(tick, None)
        if due:
            for pid in due:
                if pstate[pid] == STOWING:
                    # Finished with the bin, but the seat occupants cannot stand
                    # up while somebody is edging past. Closing the squeeze to
                    # new entrants (stow_done) bounds the wait to one passer.
                    stow_done[pid] = True
                    pending_shuffle.append(pid)
                elif pstate[pid] == SHUFFLING:
                    sit_down(pid, t)
        if pending_shuffle:
            still: List[int] = []
            for pid in pending_shuffle:
                if pass_holder[pid] < 0 and stower_clear(pid):
                    begin_shuffle(pid, t, tick)
                else:
                    still.append(pid)
            pending_shuffle[:] = still

        # (c) move walkers
        for lane in range(n_lanes):
            walkers = lane_walk[lane]
            if not walkers:
                continue
            occ = lane_occ[lane]
            n_occ = len(occ)
            # Furthest-travelled moves first, so a follower sees its leader's
            # updated position within the same tick.
            walkers.sort(key=ptrav.__getitem__, reverse=True)
            arrived: List[int] = []
            for pid in walkers:
                i = pidx[pid]
                d = pdir[pid]
                # Let go of a squeeze once fully clear of the stower.
                sp = passing[pid]
                if sp >= 0 and d * (px[pid] - px[sp]) > body:
                    if pass_holder[sp] == pid:
                        pass_holder[sp] = -1
                    passing[pid] = -1
                    sp = -1

                j = i + d
                cap = 1.0
                if 0 <= j < n_occ:
                    nb = occ[j]
                    squeeze = False
                    # stowPassSpeedFactor == 0 turns the mechanism off entirely
                    # and restores the strict model in which a stowing passenger
                    # closes the aisle outright.
                    if pass_factor > 0.0 and pstate[nb] == STOWING:
                        if sp == nb:
                            squeeze = True
                        elif (pass_holder[nb] < 0 and not stow_done[nb]
                              and d * (ptarget[pid] - px[nb]) > 1e-9):
                            # Passing is only meaningful if your seat is BEYOND
                            # theirs. Two passengers bound for the same row still
                            # queue: there is one aisle position to stand in.
                            if sp >= 0:
                                if pass_holder[sp] == pid:
                                    pass_holder[sp] = -1
                                passing[pid] = -1
                            pass_holder[nb] = pid
                            passing[pid] = nb
                            squeeze = True
                    if squeeze:
                        cap = pass_factor
                        # Still must not run into whoever is beyond the stower.
                        #
                        # The bound is the VERY NEXT body, whatever it is doing.
                        # This loop used to skip over intervening stowers, on the
                        # theory that a squeeze can carry you past more than one
                        # of them -- but a squeeze lock covers exactly one stower,
                        # the one at `nb`, so skipping let a passer come to rest
                        # inside a SECOND stower's exclusion zone without holding
                        # its lock. When that stow then finished, `stow_done`
                        # closed the squeeze to new entrants, so the passer could
                        # never acquire the lock, its gap clamped to 0, and
                        # `stower_clear` saw a body within BODY_DEPTH forever.
                        # Circular wait -- reachable from the shipped UI at
                        # dt >= 0.4 with stowPassSpeedFactor >= 0.8.
                        #
                        # Bounded this way the passer can only ever be inside the
                        # zone of the stower it owns, which is the invariant
                        # `test_a_passer_inside_a_stowers_zone_owns_the_lock`
                        # asserts.
                        k = j + d
                        if 0 <= k < n_occ:
                            gap = abs(px[occ[k]] - px[pid]) - body
                            if gap < 0.0:
                                gap = 0.0
                        else:
                            gap = 1e18
                    else:
                        gap = abs(px[nb] - px[pid]) - body
                        if gap < 0.0:
                            gap = 0.0
                    frac = gap / headway
                    if frac > 1.0:
                        frac = 1.0
                    elif frac < min_frac:
                        frac = min_frac
                else:
                    gap = 1e18
                    frac = 1.0
                free = pspeed[pid] * dt          # what they could do unobstructed
                desired = free * frac * cap      # density slowdown, then the squeeze
                allowed = gap if gap < desired else desired
                remaining = abs(ptarget[pid] - px[pid])
                step = allowed if allowed < remaining else remaining
                if step > 0.0:
                    px[pid] += d * step
                    ptrav[pid] += step
                    # Crossing a stower reorders the lane: keep occ sorted by x.
                    sp = passing[pid]
                    if sp >= 0 and d * (px[pid] - px[sp]) > 0.0:
                        a, b = pidx[pid], pidx[sp]
                        if a + d == b:
                            occ[a], occ[b] = occ[b], occ[a]
                            pidx[pid], pidx[sp] = b, a
                # Lost time is measured against FREE FLOW, so it captures the
                # density slowdown and the squeeze as well as a hard stop -- but
                # the final partial step onto your own row is arrival, not
                # obstruction, so `remaining` is excluded from this comparison.
                if allowed < free:
                    pblocked[pid] += dt * (1.0 - allowed / free)
                    if not pwasblocked[pid]:
                        pwasblocked[pid] = True
                        block_events += 1
                else:
                    pwasblocked[pid] = False
                if remaining - step < 1e-9:
                    arrived.append(pid)
            if arrived:
                for pid in arrived:
                    walkers.remove(pid)
                    arrive(pid, t, tick)

        # (d) bookkeeping
        if tick % sample_ticks == 0:
            occupied = 0
            counts = [0] * n_rows
            for lane in range(n_lanes):
                for pid in lane_occ[lane]:
                    occupied += 1
                    x = px[pid]
                    if edges:
                        k = bisect_left(edges, x)
                        counts[k] += 1
                    else:
                        counts[0] += 1
            seated_curve.append((round(t, 6), seated_count))
            aisle_curve.append((round(t, 6), occupied))
            for r in range(n_rows):
                # Held as an int, not a float. It IS a body count, and
                # `float()` here made Python serialise `0.0` where JS serialises
                # `0`, so the replay JSON was not byte-comparable between the two
                # engines even though the values agreed. See ENGINE_SPEC 7.
                congestion[r].append(counts[r])

        if record_replay and t + 1e-9 >= next_frame_t:
            frames_state.append(list(pstate))
            frames_x.append([round(v, 4) for v in px])
            next_frame_t += frame_interval

        if tick_hook is not None:
            tick_hook(tick, t, pstate, px, plane, pdir, passing, pass_holder)

        tick += 1

    total = t
    completed = seated_count >= n
    if not completed:
        for pid in range(n):
            if pstate[pid] != SEATED:
                psit[pid] = total

    # final sample so the curves close on the true end time.
    #
    # The aisle count is the REAL lane occupancy, not `n - seated_count`. On a
    # run that hit MAX_SIM_SECONDS the difference is everybody still waiting on
    # the jetbridge -- they are QUEUED, not in the aisle -- and counting them
    # here put a spike on the end of the aisle-occupancy chart that was pure
    # artefact. On a completed run both expressions are zero.
    final_in_aisle = 0
    for occ in lane_occ:
        final_in_aisle += len(occ)
    seated_curve.append((round(total, 6), seated_count))
    aisle_curve.append((round(total, 6), final_in_aisle))
    if record_replay:
        frames_state.append(list(pstate))
        frames_x.append([round(v, 4) for v in px])

    # ---- results ----------------------------------------------------------
    records: List[PassengerRecord] = []
    walk_total = stow_total = shuf_total = blocked_total = 0.0
    # Two different questions, kept apart on purpose (ENGINE_SPEC 7):
    #   aisle_times = sit - enter  -- "how long was I stuck in the aisle"
    #   sits        = sit          -- "how long from doors-open until I sat down",
    #                                 which includes the jetbridge queue
    aisle_times: List[float] = []
    sits: List[float] = []
    for p in queue:
        i = p.boardingIndex
        s = pseat[i]
        sit = psit[i]
        enter = penter[i]
        walk_total += pwalk[i]
        stow_total += pstow[i]
        shuf_total += pshuf[i]
        blocked_total += pblocked[i]
        aisle_times.append(sit - enter)
        sits.append(sit)
        records.append(PassengerRecord(
            id=p.id, seat=(s.id if s else ""), row=(s.rowNumber if s else 0),
            letter=(s.letter if s else ""), depth=pdepth[i], tier=p.tier,
            groupLabel=p.groupLabel, doorId=p.doorId, bags=p.bags, party=p.partyId,
            enterTime=round(enter, 6), sitTime=round(sit, 6),
            timeInAisle=round(sit - enter, 6), walkTime=round(pwalk[i], 6),
            stowTime=round(pstow[i], 6), shuffleTime=round(pshuf[i], 6),
            blockedTime=round(pblocked[i], 6), queueWaitTime=round(enter, 6),
            blockers=pnblock[i], gateChecked=pgatechecked[i],
        ))
    records.sort(key=lambda r: r.id)

    # Per-door sequencing quality. The interesting question with more than one
    # door is not "was a door idle" -- both doors admit from t=0 -- it is
    # "did each door load its FAR end first". Boarding the rows nearest a door
    # first is the front-to-back pathology in miniature, and a zone order that
    # is right for the forward door is automatically wrong for the aft one.
    #
    # Score, per door: mean distance-from-door of the first half of that door's
    # queue minus that of the second half, over the cabin length. Positive = far
    # end first (what you want); negative = the pathology; near zero = no spatial
    # logic. The reported figure is the WORST door, not the average, because a
    # cabin-wide rear-first order scores +0.25 at the forward door and -0.25 at
    # the aft one and those cancel to nothing if you average them -- which would
    # hide precisely the effect this measures.
    door_stats: Dict[str, Dict[str, Any]] = {}
    door_x = {d.id: d.x for d in doors}
    by_door: Dict[str, List[Tuple[int, float]]] = {d.id: [] for d in doors}
    for p in queue:
        s_ = pseat[p.boardingIndex]
        if s_ is not None and p.doorId in by_door:
            by_door[p.doorId].append((p.boardingIndex, abs(s_.x - door_x[p.doorId])))
    scores: List[float] = []
    span = ac.length if ac.length > 0 else 1.0
    for did, entries in by_door.items():
        entries.sort()
        k = len(entries)
        stats: Dict[str, Any] = {"count": k, "meanWalk": 0.0, "farFirst": 0.0}
        if k:
            stats["meanWalk"] = round(sum(v for _, v in entries) / k, 6)
        if k >= 4:
            half = k // 2
            first = sum(v for _, v in entries[:half]) / half
            second = sum(v for _, v in entries[half:]) / (k - half)
            stats["farFirst"] = round((first - second) / span, 6)
            scores.append(stats["farFirst"])
        door_stats[did] = stats
    sequencing = round(min(scores), 6) if scores else 0.0

    sorted_aisle = sorted(aisle_times)
    sorted_sits = sorted(sits)
    result = RunResult(
        totalSeconds=round(total, 6),
        totalMinutes=round(total / 60.0, 6),
        strategy=cfg.strategy,
        aircraftId=ac.id,
        seed=cfg.seed,
        paxCount=n,
        seatCount=ac.seatCount,
        loadFactor=cfg.loadFactor,
        doors=[d.id for d in doors],
        seatedCurve=seated_curve,
        aisleOccupancy=aisle_curve,
        congestion=congestion,
        perPassenger=records,
        timeBreakdown={
            "walk": round(walk_total, 6), "stow": round(stow_total, 6),
            "shuffle": round(shuf_total, 6), "blocked": round(blocked_total, 6),
        },
        interference={
            "none": inter_none, "one": inter_one, "two": inter_two,
            "sameParty": inter_same,
        },
        gateChecks=gate_checks,
        binSearches=bin_searches,
        aisleBlockEvents=block_events,
        # Time from crossing the aircraft door to being seated. This is the
        # quantity `perPassenger[].timeInAisle` already held and the one the
        # "passenger wait time" chart exists to show: a fast mean hiding a
        # miserable tail. It used to be computed off `sitTime`, which made the
        # reported maximum identically `totalSeconds` on every completed run.
        p50AisleSeconds=round(percentile(sorted_aisle, 0.50), 6),
        p90AisleSeconds=round(percentile(sorted_aisle, 0.90), 6),
        maxAisleSeconds=round(sorted_aisle[-1], 6) if sorted_aisle else 0.0,
        # Time from the start of boarding to being seated -- the same wait plus
        # however long you stood on the jetbridge. There is deliberately no
        # `max` here: the last person to sit down sits at `totalSeconds` by
        # definition, so a maximum of this series is not a statistic.
        p50BoardingWaitSeconds=round(percentile(sorted_sits, 0.50), 6),
        p90BoardingWaitSeconds=round(percentile(sorted_sits, 0.90), 6),
        # Deprecated aliases, kept so existing consumers keep working. They now
        # carry the AISLE quantity, i.e. they are finally what their name says.
        p50TimeToSeat=round(percentile(sorted_aisle, 0.50), 6),
        p90TimeToSeat=round(percentile(sorted_aisle, 0.90), 6),
        maxTimeToSeat=round(sorted_aisle[-1], 6) if sorted_aisle else 0.0,
        throughputPaxPerMin=round(n / (total / 60.0), 6) if total > 0 else 0.0,
        completed=completed,
        doorStats=door_stats,
        doorSequencing=sequencing,
    )

    replay = None
    if record_replay:
        from .replay import build_replay
        replay = build_replay(
            cfg, ac, queue, pseat, plane, result, frames_state, frames_x, frame_interval
        )
    return result, replay


def simulate(cfg: SimConfig, ac: Optional[Aircraft] = None) -> RunResult:
    """Convenience wrapper for the common case: one run, no replay buffer."""
    return run(cfg, ac=ac, record_replay=False)[0]
