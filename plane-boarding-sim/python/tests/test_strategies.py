"""Each of the fifteen strategies, plus the universal post-processing pipeline."""

from __future__ import annotations

import pytest

from plane_boarding.engine import simulate
from plane_boarding.passengers import generate
from plane_boarding.rng import PCG32
from plane_boarding.strategies import STRATEGIES

from helpers import clean_cfg, cfg_for, make_queue

ALL = sorted(STRATEGIES)


def test_registry_has_the_fifteen_documented_strategies():
    assert len(STRATEGIES) == 15
    for key, entry in STRATEGIES.items():
        assert entry["name"] and entry["description"] and callable(entry["fn"])


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


def test_priority_5tier_boards_basic_economy_last():
    cfg = clean_cfg("a320neo", "priority_5tier", seed=3)
    _, queue = make_queue(cfg)
    basic = [p for p in queue if p.tier == "basic"]
    others = [p for p in queue if p.tier != "basic"]
    assert min(p.boardingIndex for p in basic) > max(p.boardingIndex for p in others)


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
    cfg = cfg_for("a320neo", "random", seed=5, preboardRate=0.15)
    _, queue = make_queue(cfg)
    pre = [p for p in queue if p.isPreboard]
    assert pre, "test needs at least one preboard"
    assert max(p.boardingIndex for p in pre) < len(pre) + 30  # allowing party cohesion
    assert all(p.groupLabel == "Preboard" for p in pre)


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
