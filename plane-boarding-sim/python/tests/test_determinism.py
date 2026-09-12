"""Determinism is the load-bearing property: the JS port must match bit for bit."""

from __future__ import annotations

import json

import pytest

from plane_boarding.engine import run, simulate
from plane_boarding.strategies import STRATEGIES

from helpers import cfg_for


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
