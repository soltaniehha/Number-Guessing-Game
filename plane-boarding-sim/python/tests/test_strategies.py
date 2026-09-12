"""Each of the sixteen strategies, plus the universal post-processing pipeline."""

from __future__ import annotations

import pytest

from plane_boarding.engine import simulate
from plane_boarding.passengers import generate
from plane_boarding.rng import PCG32
from plane_boarding.strategies import STRATEGIES

from helpers import clean_cfg, cfg_for, make_queue

ALL = sorted(STRATEGIES)


def test_registry_has_the_sixteen_documented_strategies():
    assert len(STRATEGIES) == 16
    for key, entry in STRATEGIES.items():
        assert entry["name"] and entry["description"] and callable(entry["fn"])
    assert "southwest_2026" in STRATEGIES, (
        "the real converged design -- WilMA x back-to-front merged with fare and "
        "status into eight groups, live since 27 January 2026 -- is what the "
        "headline comparison is against")


@pytest.mark.parametrize("strategy", ALL)
@pytest.mark.parametrize("aid", ["a320neo", "b777_300er", "e175"])
def test_every_strategy_returns_a_permutation(strategy, aid):
    """No duplicates, no drops -- the queue must be the same set of people."""
    cfg = cfg_for(aid, strategy, seed=17, loadFactor=0.85)
    ac, queue = make_queue(cfg)
    pax = generate(PCG32(cfg.seed, 1), ac, cfg)
    assert sorted(p.id for p in queue) == sorted(p.id for p in pax)
    assert len({id(p) for p in queue}) == len(queue)
    assert [p.boardingIndex for p in queue] == list(range(len(queue)))
    assert all(p.groupLabel for p in queue), "every passenger needs a printable group"


def test_wilma_puts_all_windows_before_all_middles_before_all_aisles():
    cfg = clean_cfg("a320neo", "wilma", seed=3)
    _, queue = make_queue(cfg)
    depths = [p.depth for p in queue]
    assert depths == sorted(depths, reverse=True)


def test_steffen_perfect_alternates_rows_within_each_wave():
    """Consecutive boarders in a wave must be two row slots apart -- that is the
    entire mechanism, and it is what lets a whole wave stow simultaneously."""
    cfg = clean_cfg("a320neo", "steffen_perfect", seed=3)
    _, queue = make_queue(cfg)
    waves = {}
    for p in queue:
        waves.setdefault(p.groupLabel, []).append(p)
    checked = 0
    for members in waves.values():
        if len(members) < 3:
            continue
        checked += 1
        slots = [p.rowSlot for p in members]
        assert slots == sorted(slots, reverse=True), "waves run rear to front"
        # Gaps are always EVEN: consecutive boarders in a wave are two rows
        # apart, or a multiple of two where the intervening seat is empty.
        gaps = [a - b for a, b in zip(slots, slots[1:])]
        assert all(g >= 2 and g % 2 == 0 for g in gaps), f"rows must alternate: {gaps}"
        assert len({p.seat.blockId for p in members}) == 1
        assert len({p.depth for p in members}) == 1
    assert checked >= 8


def test_back_to_front_really_is_rear_first():
    cfg = clean_cfg("a320neo", "back_to_front", seed=3)
    _, queue = make_queue(cfg)
    first = [p.rowSlot for p in queue[:20]]
    last = [p.rowSlot for p in queue[-20:]]
    assert min(first) > max(last)


def test_front_to_back_really_is_front_first():
    cfg = clean_cfg("a320neo", "front_to_back", seed=3)
    _, queue = make_queue(cfg)
    assert max(p.rowSlot for p in queue[:20]) < min(p.rowSlot for p in queue[-20:])


def test_by_bags_boards_light_travellers_first():
    cfg = clean_cfg("a320neo", "by_bags", seed=3)
    _, queue = make_queue(cfg)
    bags = [p.bags for p in queue]
    assert bags == sorted(bags)


def test_reverse_pyramid_is_a_diagonal_not_a_row_sweep():
    """Group 1 must be rear windows and the last group front aisles, with the
    middle groups genuinely mixing depth -- a pure row sweep would not."""
    cfg = clean_cfg("a320neo", "reverse_pyramid", seed=3)
    ac, queue = make_queue(cfg)
    n = len(queue)
    k = max(4, n // 10)
    head, tail = queue[:k], queue[-k:]
    assert sum(p.depth for p in head) / k > sum(p.depth for p in tail) / k, "windows first"
    assert sum(p.rowSlot for p in head) / k > sum(p.rowSlot for p in tail) / k, "rear first"
    # The defining property of a diagonal, as against strict outside-in: the
    # depth bands OVERLAP in queue position. Front windows board alongside rear
    # middles, so the last window is called after the first middle.
    windows = [p.boardingIndex for p in queue if p.depth == 3]
    middles = [p.boardingIndex for p in queue if p.depth == 2]
    aisles = [p.boardingIndex for p in queue if p.depth == 1]
    assert max(windows) > min(middles), "windows and middles must overlap"
    assert max(middles) > min(aisles), "middles and aisles must overlap"
    labels = {p.groupLabel for p in queue}
    assert 2 <= len(labels) <= ac.maxDepth * cfg.zoneCount, "must be a printable group list"


def test_rotating_zone_alternates_the_two_ends_of_the_cabin():
    cfg = clean_cfg("a320neo", "rotating_zone", seed=3, zoneCount=4)
    ac, queue = make_queue(cfg)
    seen = []
    for p in queue:
        if not seen or seen[-1] != p.groupLabel:
            seen.append(p.groupLabel)
    means = []
    for label in seen:
        rows = [p.rowSlot for p in queue if p.groupLabel == label]
        means.append(sum(rows) / len(rows))
    assert means[0] > means[1] and means[1] < means[2], "must zig-zag rear/front"


def test_common_sense_5tier_uses_exactly_five_economy_groups_plus_premium():
    cfg = clean_cfg("b777_300er", "common_sense_5tier", seed=3)
    ac, queue = make_queue(cfg)
    labels = []
    for p in queue:
        if p.groupLabel not in labels:
            labels.append(p.groupLabel)
    assert len(labels) == 5
    assert "premium" in labels[0]
    premium = [p for p in queue if p.seat.classKey != "economy"]
    assert all(p.boardingIndex < len(premium) for p in premium), "premium cabin first"


def test_common_sense_5tier_merges_status_into_the_group_rather_than_sorting_inside_it():
    """The §7 #2 correction, as a property.

    The old rule put elites at the front of the group their SEAT earned, which
    on an outside-in scheme is perverse: aisles are called last and elites
    disproportionately sit in aisles, so a top-tier flyer boarded behind every
    basic-economy window passenger. Status is now an input to the group itself,
    so an aisle seat with status must beat an aisle seat without it, and basic
    economy must land at the back whatever it is sitting in.
    """
    cfg = clean_cfg("a320neo", "common_sense_5tier", seed=11, loadFactor=1.0)
    _, queue = make_queue(cfg)
    aisles = [p for p in queue if p.seat.kind == "Aisle"]
    top = [p for p in aisles if p.tier == "elite_top"]
    basic = [p for p in aisles if p.tier == "basic"]
    assert top and basic, "seed must produce both an elite and a basic aisle seat"
    mean_top = sum(p.boardingIndex for p in top) / len(top)
    mean_basic = sum(p.boardingIndex for p in basic) / len(basic)
    assert mean_top < mean_basic, (
        f"status must buy a real group, not a place inside one: elite aisles "
        f"average slot {mean_top:.0f}, basic aisles {mean_basic:.0f}")

    # And the whole point of the correction: an elite in an AISLE seat is no
    # longer stuck behind the entire basic-economy WINDOW population.
    basic_windows = [p for p in queue if p.seat.kind == "Window" and p.tier == "basic"]
    assert basic_windows
    assert mean_top < max(p.boardingIndex for p in basic_windows)


def test_southwest_2026_is_wilma_zoned_with_a_status_ladder_merged_in():
    """Eight groups, seat location as the base rank, status shifting whole
    groups. Checked as structure, not as a number: the count of groups is what
    Southwest prints, and window-before-aisle is what they announced."""
    cfg = clean_cfg("a320neo", "southwest_2026", seed=4, loadFactor=1.0)
    _, queue = make_queue(cfg)
    labels = []
    for p in queue:
        if p.groupLabel not in labels:
            labels.append(p.groupLabel)
    assert len(labels) == 8, f"Southwest prints eight groups, got {labels}"

    # Outside-in survives the status merge in aggregate: windows still board
    # ahead of aisles on average.
    def mean_slot(kind):
        rows = [p.boardingIndex for p in queue if p.seat.kind == kind]
        return sum(rows) / len(rows)
    assert mean_slot("Window") < mean_slot("Middle") < mean_slot("Aisle")

    # ... and status still buys groups, which is the half `wilma_zoned` lacks.
    elite = [p.boardingIndex for p in queue if p.tier == "elite_top"]
    basic = [p.boardingIndex for p in queue if p.tier == "basic"]
    assert elite and basic
    assert sum(elite) / len(elite) < sum(basic) / len(basic)


@pytest.mark.parametrize("strategy", ["common_sense_5tier", "southwest_2026"])
def test_party_cohesion_is_mandatory_for_the_seat_location_schemes(strategy):
    """Every carrier that boards by seat location promotes the whole booking to
    its earliest-boarding member -- United's "same and highest applicable",
    Lufthansa's "and companions". A run of one of these strategies with
    `keepPartiesTogether` off is not a model of anything anyone operates, so the
    strategy forces it on rather than honouring the flag."""
    cfg = cfg_for("a320neo", strategy, seed=8, keepPartiesTogether=False,
                  nonComplianceRate=0.0, lateRate=0.0)
    _, queue = make_queue(cfg)
    seen = {}
    for i, p in enumerate(queue):
        seen.setdefault(p.partyId, []).append(i)
    multi = [v for v in seen.values() if len(v) > 1]
    assert multi, "the seed must produce at least one multi-passenger party"
    for slots in multi:
        assert slots == list(range(slots[0], slots[0] + len(slots))), (
            "party members must be contiguous even with keepPartiesTogether off")


def test_party_cohesion_promotes_to_the_earliest_member():
    """RESEARCH_AIRLINES 7 #4 asks for this to be verified rather than assumed:
    the party must board at its EARLIEST member's slot, not at a mean or a
    latest one. Checked against the pre-cohesion ordering."""
    from plane_boarding.strategies import apply_post_processing, build_order
    cfg = cfg_for("a320neo", "random", seed=13, nonComplianceRate=0.0, lateRate=0.0,
                  preboardFirst=False, keepPartiesTogether=False)
    ac, loose = make_queue(cfg)
    rank = {p.id: i for i, p in enumerate(loose)}

    tight_cfg = cfg.replace(keepPartiesTogether=True)
    _, tight = make_queue(tight_cfg)

    # Every party's block must start where its earliest member stood before, in
    # the sense that parties appear in order of their earliest member.
    first_of = {}
    for i, p in enumerate(tight):
        first_of.setdefault(p.partyId, (i, rank[p.id]))
    order = [v for _, v in sorted(first_of.values())]
    earliest = {}
    for p in loose:
        earliest[p.partyId] = min(earliest.get(p.partyId, 10 ** 9), rank[p.id])
    by_earliest = [pid for pid, _ in sorted(earliest.items(), key=lambda kv: kv[1])]
    by_queue = []
    for p in tight:
        if p.partyId not in by_queue:
            by_queue.append(p.partyId)
    assert by_queue == by_earliest, (
        "parties must be emitted in order of their EARLIEST member -- that is "
        "promote-to-earliest, and it is what deployed companion rules do")


def test_priority_5tier_boards_basic_economy_last():
    cfg = clean_cfg("a320neo", "priority_5tier", seed=3)
    _, queue = make_queue(cfg)
    basic = [p for p in queue if p.tier == "basic"]
    others = [p for p in queue if p.tier != "basic"]
    assert min(p.boardingIndex for p in basic) > max(p.boardingIndex for p in others)


def test_status_is_concentrated_in_the_forward_rows():
    """RESEARCH_AIRLINES 7 #6, as a property of the manifest rather than of any
    one strategy. Elites and cardholders sit in Comfort+/Main Cabin Extra/
    Economy Plus, which is the forward economy rows, and basic economy gets what
    is left at the back. Modelling status as uniform over the cabin handed every
    status-ordered scheme a randomly spread first wave instead of the
    front-loaded one it actually gets -- which is close to the worst possible
    order, and is why real priority boarding is slow.
    """
    cfg = cfg_for("a320neo", "random", seed=12, loadFactor=1.0)
    ac, queue = make_queue(cfg)
    mid = (len(ac.rowSlots) - 1) / 2.0

    def mean_slot(pred):
        rows = [p.seat.rowSlot for p in queue if pred(p)]
        assert rows
        return sum(rows) / len(rows)

    # All three status buckets share one tilt -- the model says "status sits
    # forward", not "top tier sits further forward than cardholders" -- so the
    # assertion is status-vs-basic, not an ordering within status.
    status = mean_slot(lambda p: p.tier in ("elite_top", "elite_mid", "cardholder"))
    basic = mean_slot(lambda p: p.tier == "basic")
    assert status < mid < basic
    assert status < basic


def test_the_forward_status_bias_can_be_switched_off():
    """`eliteForwardBias = 0` must reproduce the old uniform draw exactly, so
    the effect of the bias can be measured rather than merely asserted."""
    cfg = cfg_for("a320neo", "random", seed=12, loadFactor=1.0, eliteForwardBias=0.0)
    ac, queue = make_queue(cfg)
    mid = (len(ac.rowSlots) - 1) / 2.0
    for tier in ("elite_top", "cardholder", "basic", "standard"):
        rows = [p.seat.rowSlot for p in queue if p.tier == tier]
        assert rows
        assert abs(sum(rows) / len(rows) - mid) < mid * 0.35, (
            f"{tier} should sit around mid-cabin with the bias off")


def test_slowest_first_front_loads_the_two_bag_passengers():
    cfg = clean_cfg("a320neo", "slowest_first", seed=3)
    _, queue = make_queue(cfg)
    n = len(queue) // 4
    assert (sum(p.bags for p in queue[:n]) / n) > (sum(p.bags for p in queue[-n:]) / n)


# --- the strong correctness signal -----------------------------------------

@pytest.mark.parametrize("strategy", ["wilma", "wilma_zoned", "steffen_perfect"])
@pytest.mark.parametrize("aid", ["a320neo", "a220_300", "b777_300er"])
def test_outside_in_methods_produce_zero_seat_interference(strategy, aid):
    """With parties and non-compliance off, boarding strictly by decreasing depth
    means every blocker is still standing at the gate when you sit down. Any
    non-zero count here is a real bug in the ordering or in the blocker lookup."""
    r = simulate(clean_cfg(aid, strategy, seed=21, loadFactor=1.0))
    assert r.interference["one"] == 0
    assert r.interference["two"] == 0
    assert r.interference["sameParty"] == 0
    assert r.interference["none"] == r.paxCount


def test_random_boarding_does_produce_interference():
    """The control for the test above: if the counter never fires, it proves
    nothing."""
    r = simulate(clean_cfg("a320neo", "random", seed=21, loadFactor=1.0))
    assert r.interference["one"] + r.interference["two"] > 20


# --- universal post-processing ---------------------------------------------

def test_preboards_are_lifted_to_the_front():
    """Step 1 of the pipeline, checked against steps 2-4 rather than in spite of
    them. Party cohesion drags a preboard's whole party forward with them, and
    step 4 can still draw a preboard as a late arrival and send them to the very
    back -- which is the model saying "they missed the preboarding call", and is
    the only way a Preboard-labelled passenger can appear late in the queue. So
    the assertion is on the preboards who were NOT drawn late."""
    cfg = cfg_for("a320neo", "random", seed=5, preboardRate=0.15, lateRate=0.0)
    _, queue = make_queue(cfg)
    pre = [p for p in queue if p.isPreboard]
    assert pre, "test needs at least one preboard"
    assert all(p.groupLabel == "Preboard" for p in pre)

    # The preboard BLOCK is the preboards plus everyone cohesion dragged in with
    # them, so its size is a property of the manifest rather than a magic
    # number. Every preboard must sit inside that block, give or take the
    # compliance jitter that step 3 is entitled to apply to anybody.
    pre_parties = {p.partyId for p in pre}
    block = [p for p in queue if p.partyId in pre_parties]
    assert max(p.boardingIndex for p in pre) < len(block) + cfg.complianceJitter, (
        f"{len(pre)} preboards pulled {len(block) - len(pre)} companions forward; "
        f"the last preboard should not be past that block plus the jitter")


def test_a_preboard_can_still_be_drawn_as_a_late_arrival():
    """The control for the test above -- lateness is drawn for everybody, and a
    preboard who misses the call really does board at the end. Pinned so that
    the `lateRate=0` in the test above reads as deliberate scoping rather than
    as a bug being hidden."""
    cfg = cfg_for("a320neo", "random", seed=5, preboardRate=0.15, lateRate=0.5)
    _, queue = make_queue(cfg)
    pre = [p for p in queue if p.isPreboard]
    assert pre
    assert max(p.boardingIndex for p in pre) > len(queue) // 2


def test_preboard_first_can_be_switched_off():
    cfg = cfg_for("a320neo", "random", seed=5, preboardRate=0.15,
                  preboardFirst=False, keepPartiesTogether=False,
                  nonComplianceRate=0.0, lateRate=0.0)
    _, queue = make_queue(cfg)
    pre = [p.boardingIndex for p in queue if p.isPreboard]
    assert max(pre) > len(queue) // 2


def test_party_cohesion_keeps_parties_contiguous_and_window_first():
    cfg = cfg_for("a320neo", "random", seed=5, nonComplianceRate=0.0, lateRate=0.0,
                  preboardRate=0.0)
    _, queue = make_queue(cfg)
    groups = {}
    for p in queue:
        groups.setdefault(p.partyId, []).append(p)
    multi = [g for g in groups.values() if len(g) > 1]
    assert multi
    for g in multi:
        idx = sorted(p.boardingIndex for p in g)
        assert idx == list(range(idx[0], idx[0] + len(idx))), "party split up"
        depths = [p.depth for p in sorted(g, key=lambda p: p.boardingIndex)]
        assert depths == sorted(depths, reverse=True), "window member goes in first"


def test_party_cohesion_measurably_degrades_a_steffen_ordering():
    """The headline finding the simulator exists to show: a perfect Steffen order
    is destroyed locally by families boarding together."""
    from plane_boarding.batch import run_batch
    tight = run_batch(clean_cfg("a320neo", "steffen_perfect", seed=31, loadFactor=0.9),
                      runs=12)
    loose = run_batch(cfg_for("a320neo", "steffen_perfect", seed=31, loadFactor=0.9,
                              nonComplianceRate=0.0, lateRate=0.0, preboardRate=0.0,
                              keepPartiesTogether=True), runs=12)
    assert loose.interference["one"] + loose.interference["two"] > 0
    assert tight.interference["one"] + tight.interference["two"] == 0
    assert loose.mean > tight.mean


def test_non_compliance_shuffles_the_queue_locally_but_not_globally():
    strict = clean_cfg("a320neo", "back_to_front", seed=7)
    sloppy = strict.replace(nonComplianceRate=0.9, complianceJitter=6)
    _, a = make_queue(strict)
    _, b = make_queue(sloppy)
    pos_a = {p.id: p.boardingIndex for p in a}
    pos_b = {p.id: p.boardingIndex for p in b}
    moves = [abs(pos_a[i] - pos_b[i]) for i in pos_a]
    assert max(moves) > 0
    assert sum(moves) / len(moves) < 30, "jitter must stay local, not reshuffle"


def test_late_arrivals_go_to_the_very_back():
    cfg = cfg_for("a320neo", "front_to_back", seed=13, lateRate=0.25,
                  nonComplianceRate=0.0, keepPartiesTogether=False, preboardRate=0.0)
    ac, queue = make_queue(cfg)
    tail = queue[-10:]
    assert max(p.rowSlot for p in tail) > len(ac.rowSlots) // 2, (
        "with front-to-back, only late arrivals can be rear-seated at the back")


def test_unknown_strategy_is_rejected_clearly():
    from plane_boarding.config import ConfigError
    with pytest.raises((KeyError, ConfigError)):
        simulate(cfg_for("a320neo", "random", seed=1).replace(strategy="teleport"))
