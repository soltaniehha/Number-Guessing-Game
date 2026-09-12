"""Determinism is the load-bearing property: the JS port must match bit for bit."""

from __future__ import annotations

import json

import pytest

from plane_boarding.batch import run_batch
from plane_boarding.engine import run, simulate
from plane_boarding.strategies import STRATEGIES

from helpers import ALL_AIRCRAFT, cfg_for


@pytest.mark.parametrize("strategy", sorted(STRATEGIES))
def test_same_config_and_seed_gives_byte_identical_output(strategy):
    cfg = cfg_for("a220_300", strategy, seed=12345, loadFactor=0.8)
    a = json.dumps(simulate(cfg).to_dict(), sort_keys=True)
    b = json.dumps(simulate(cfg).to_dict(), sort_keys=True)
    assert a == b


def test_a_fresh_config_object_with_the_same_values_is_identical():
    """Determinism must depend on the config VALUES, not on object identity or
    on any state cached inside a SimConfig."""
    one = json.dumps(simulate(cfg_for("e175", "wilma", seed=9)).to_dict(), sort_keys=True)
    two = json.dumps(simulate(cfg_for("e175", "wilma", seed=9)).to_dict(), sort_keys=True)
    assert one == two


def test_different_seeds_give_different_results():
    times = {simulate(cfg_for("a320neo", "random", seed=s)).totalSeconds for s in range(1, 9)}
    assert len(times) >= 7, "eight seeds should not collide on the same total"


def test_streams_are_independent_changing_the_strategy_keeps_the_manifest():
    """The `pax` stream is seeded separately from `order`, so two strategies at
    the same seed face the identical passenger manifest. This is what makes the
    Monte Carlo comparison paired."""
    a = simulate(cfg_for("a320neo", "random", seed=4))
    b = simulate(cfg_for("a320neo", "wilma", seed=4))
    bags_a = sorted((p.id, p.bags, p.seat) for p in a.perPassenger)
    bags_b = sorted((p.id, p.bags, p.seat) for p in b.perPassenger)
    assert bags_a == bags_b
    assert a.totalSeconds != b.totalSeconds


def test_recording_a_replay_does_not_perturb_the_simulation():
    cfg = cfg_for("b787_9", "reverse_pyramid", seed=77)
    plain = simulate(cfg)
    with_replay, replay = run(cfg, record_replay=True)
    assert plain.to_dict() == with_replay.to_dict()
    assert replay is not None


def test_config_replace_is_a_pure_copy():
    base = cfg_for("a320neo", "random", seed=1)
    derived = base.replace(seed=2)
    assert base.seed == 1 and derived.seed == 2
    assert simulate(base).totalSeconds == simulate(cfg_for("a320neo", "random", seed=1)).totalSeconds


# ---------------------------------------------------------------------------
# The general guard
# ---------------------------------------------------------------------------

#: A spread of scenarios that between them exercise every source of state the
#: engine carries across a run: the open-seating picker's incremental
#: nearest-neighbour cache, the per-door arrival streams on a two-door aircraft,
#: the twin-aisle lane bookkeeping, the bin capacity tables, and the cached
#: `Aircraft` objects (which are memoised process-wide and are the most likely
#: place for state to leak between runs).
_GUARD_SCENARIOS = [
    ("a320neo", "random", 1, {}),
    ("e175", "open_seating", 7, {"openSeatingPolicy": "avoid_neighbours"}),
    ("b777_300er", "southwest_2026", 3, {"doorAssignment": "split_by_aisle"}),
    ("b787_9", "common_sense_5tier", 11, {}),
    ("b737_max8", "steffen_perfect", 5, {"loadFactor": 1.0}),
    ("a220_300", "priority_5tier", 9, {"loadFactor": 0.55}),
]


@pytest.mark.parametrize("aid,strategy,seed,over", _GUARD_SCENARIOS)
def test_running_the_same_scenario_twice_in_one_process_is_deeply_equal(
    aid, strategy, seed, over
):
    """The whole project rests on one claim: a given (config, seed) has exactly
    one outcome, in both languages. That is normally checked indirectly -- the
    parity harness would go red, a digest would move -- but nothing asserted it
    head-on, which meant an intermittently non-deterministic engine could look
    like a flaky test rather than a broken guarantee.

    So: run it twice in the same process and compare everything, per-passenger
    records included. Cheap, and it turns the assumption into something the
    suite actually checks on every run.

    Twice in ONE process matters. A fresh process would also catch a dependence
    on the clock or on address-space layout, but it would miss the likelier
    failure: state surviving in a module-level cache from the previous run.
    """
    cfg = cfg_for(aid, strategy, seed, **over)
    first = simulate(cfg).to_dict()
    second = simulate(cfg).to_dict()
    assert first == second


def test_a_batch_is_reproducible_run_for_run():
    """The same guard one level up. `run_batch` walks a seed sequence and
    aggregates, so it would also catch a generator that leaks state from one
    replication into the next -- which a per-run engine comparison cannot see.
    """
    cfg = cfg_for("a320neo", "wilma_zoned", seed=31, loadFactor=0.88)
    a = run_batch(cfg, runs=5).to_dict(keep_values=True)
    b = run_batch(cfg, runs=5).to_dict(keep_values=True)
    assert a == b


def test_interleaving_two_scenarios_does_not_contaminate_either():
    """Determinism has to survive being interleaved, not just repeated. If any
    engine state were process-global rather than per-run, A,B,A would give a
    different A from A,A."""
    a_cfg = cfg_for("b777_300er", "reverse_pyramid", 44, loadFactor=0.9)
    b_cfg = cfg_for("e175", "by_bags", 45, loadFactor=1.0)
    a1 = simulate(a_cfg).to_dict()
    b1 = simulate(b_cfg).to_dict()
    a2 = simulate(a_cfg).to_dict()
    b2 = simulate(b_cfg).to_dict()
    assert a1 == a2
    assert b1 == b2


@pytest.mark.parametrize("aid", ALL_AIRCRAFT)
def test_every_aircraft_is_deterministic_under_the_default_strategy(aid):
    cfg = cfg_for(aid, "random", seed=2026)
    assert simulate(cfg).to_dict() == simulate(cfg).to_dict()
