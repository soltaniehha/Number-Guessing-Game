"""Paired comparison under common random numbers.

The whole reason `compare_strategies` runs every strategy on the same seed
sequence is variance reduction. These tests check that the reduction is real,
that we are collecting it, and that the pairing is not silently a lie.
"""

from __future__ import annotations

import math

import pytest

from plane_boarding.batch import compare_strategies, run_batch
from plane_boarding.cli import shared_ranks, shared_ranks_paired
from plane_boarding.engine import simulate
from plane_boarding.metrics import Aggregate, PairedDifference

from helpers import cfg_for


def unpaired_ci(a, b):
    """CI half-width on a difference of two INDEPENDENT means -- what you are
    implicitly using if you eyeball two marginal error bars."""
    ag, bg = Aggregate(a), Aggregate(b)
    return 1.96 * math.sqrt(ag.sd ** 2 / len(a) + bg.sd ** 2 / len(b))


# --- is the pairing real? ---------------------------------------------------

def test_every_strategy_uses_the_same_seed_sequence():
    cfg = cfg_for("a220_300", "random", seed=1, loadFactor=0.8)
    res = compare_strategies(cfg, ["random", "wilma", "steffen_perfect"],
                             runs=4, seed_base=77)
    for b in res:
        assert b.seeds == (77, 78, 79, 80)
    assert len({b.seeds for b in res}) == 1


def test_matched_replications_really_are_the_same_scenario():
    """Replication i of strategy A and of strategy B must differ ONLY in the
    boarding order -- same passengers, same bags, same parties. That is the
    property the paired difference relies on."""
    cfg = cfg_for("a220_300", "random", seed=1, loadFactor=0.8)
    a = simulate(cfg.replace(strategy="random", seed=77))
    b = simulate(cfg.replace(strategy="wilma", seed=77))
    manifest = lambda r: sorted((p.id, p.seat, p.bags, p.party) for p in r.perPassenger)
    assert manifest(a) == manifest(b)
    assert a.totalSeconds != b.totalSeconds


def test_batch_values_are_in_seed_order():
    cfg = cfg_for("a220_300", "wilma", seed=1, loadFactor=0.8)
    b = run_batch(cfg, runs=4, seed_base=500)
    direct = [simulate(cfg.replace(seed=500 + i)).totalSeconds for i in range(4)]
    assert b.totalSeconds.values == direct


def test_pairing_against_a_mismatched_batch_is_refused():
    """A confidently wrong interval is worse than no interval. If the seeds do
    not line up the replications are not matched and pairing must fail loudly."""
    cfg = cfg_for("a220_300", "random", seed=1, loadFactor=0.8)
    a = run_batch(cfg.replace(strategy="wilma"), runs=3, seed_base=10)
    b = run_batch(cfg.replace(strategy="random"), runs=3, seed_base=999)
    with pytest.raises(ValueError, match="seed sequences differ"):
        a.paired_against(b)


def test_paired_difference_rejects_unequal_lengths():
    with pytest.raises(ValueError, match="cannot pair"):
        PairedDifference([1.0, 2.0], [1.0])


# --- does pairing actually buy anything? ------------------------------------

def test_pairing_narrows_the_interval_on_real_simulation_data():
    """The claim being made by running CRN at all. If this stops holding, the
    variance reduction has evaporated and the paired test is just extra code."""
    cfg = cfg_for("a320neo", "random", seed=1, loadFactor=0.9, doors=["1L"])
    res = compare_strategies(cfg, ["random", "wilma"], runs=25)
    wilma = next(b for b in res if b.strategy == "wilma")
    base = next(b for b in res if b.strategy == "random")
    paired = wilma.paired_against(base)
    unpaired = unpaired_ci(wilma.totalSeconds.values, base.totalSeconds.values)
    assert paired.ci95 < unpaired, (
        f"paired CI {paired.ci95:.1f}s is not narrower than unpaired {unpaired:.1f}s "
        f"-- common random numbers are buying nothing")


def test_a_small_but_real_difference_is_caught_by_pairing_and_missed_marginally():
    """The value proposition, as an actual test. Two strategies with a large
    spread across seeds but a consistent 2 s gap on every matched seed: the
    marginal intervals overlap completely, the paired one does not."""
    a = [100.0, 140.0, 180.0, 220.0, 260.0]
    b = [102.0, 142.0, 182.0, 222.0, 262.0]

    marginal = shared_ranks([Aggregate(a).mean, Aggregate(b).mean],
                            [Aggregate(a).ci95, Aggregate(b).ci95])
    assert marginal == [1, 1], "the marginal view should be fooled here"

    assert shared_ranks_paired([a, b]) == [1, 2], "pairing should separate them"
    d = PairedDifference(b, a)
    assert d.significant and d.mean == pytest.approx(2.0)
    assert unpaired_ci(a, b) > d.ci95 * 10


def test_a_genuine_tie_still_reads_as_a_tie():
    """Pairing must not manufacture separation. Differences that scatter around
    zero stay a tie however tight the individual runs are."""
    a = [100.0, 110.0, 120.0, 130.0, 140.0]
    b = [101.0, 109.0, 121.0, 129.0, 141.0]   # +1, -1, +1, -1, +1
    assert shared_ranks_paired([a, b]) == [1, 1]
    assert not PairedDifference(b, a).significant


def test_paired_ranking_is_competition_style_and_non_transitive():
    fast = [100.0, 101.0, 102.0]
    mid = [100.5, 101.5, 102.5]     # +0.5 from fast, consistently
    slow = [140.0, 141.0, 142.0]
    ranks = shared_ranks_paired([fast, mid, slow])
    assert ranks[0] == 1 and ranks[2] == 3
    assert ranks[1] in (1, 2)


def test_sign_convention_negative_means_faster():
    d = PairedDifference([90.0] * 4, [100.0] * 4, baseline="random")
    assert d.mean == pytest.approx(-10.0)
    assert d.meanRatio == pytest.approx(0.9)
    assert d.baseline == "random"


def test_the_baseline_pairs_against_itself_as_exactly_zero():
    cfg = cfg_for("a220_300", "random", seed=1, loadFactor=0.8)
    res = compare_strategies(cfg, ["random", "wilma"], runs=5)
    base = next(b for b in res if b.strategy == "random")
    assert base.pairedVsBaseline.mean == 0.0
    assert base.pairedVsBaseline.ci95 == 0.0
    assert not base.pairedVsBaseline.significant
    assert base.pairedVsBaseline.meanRatio == pytest.approx(1.0)


def test_paired_block_is_attached_and_json_shaped():
    cfg = cfg_for("a220_300", "random", seed=1, loadFactor=0.8)
    res = compare_strategies(cfg, ["random", "front_to_back"], runs=5)
    slow = next(b for b in res if b.strategy == "front_to_back")
    d = slow.to_dict()["pairedVsBaseline"]
    assert set(d) == {"baseline", "n", "mean", "sd", "ci95", "lo", "hi",
                      "meanRatio", "ratioCi95", "ratioLo", "ratioHi", "significant"}
    assert d["baseline"] == "random"
    assert d["n"] == 5
    assert d["mean"] > 0 and d["significant"]
    assert d["lo"] < d["mean"] < d["hi"]
    assert d["ratioLo"] < d["meanRatio"] < d["ratioHi"]
    import json
    json.dumps(d)


def test_common_random_numbers_are_only_partial_and_this_is_documented():
    """Pins the current strength of CRN so nobody over-claims it.

    The `pax` stream is shared, so the manifest is identical across strategies
    at a matched seed. The `sim` stream is NOT: stow, shuffle and door draws are
    consumed in event order, so the same passenger gets a different stow time
    under a different boarding order. That is why the variance reduction is
    8-27% rather than the near-total cancellation you would get from
    per-passenger service draws.

    If someone later makes the `sim` draws per-passenger -- a cross-engine
    change, since it moves draw order -- this test should start failing and
    should be updated, not deleted.
    """
    cfg = cfg_for("a320neo", "random", seed=5, loadFactor=0.9, doors=["1L"])
    a = simulate(cfg.replace(strategy="random"))
    b = simulate(cfg.replace(strategy="wilma"))
    bags_a = {p.id: p.bags for p in a.perPassenger}
    bags_b = {p.id: p.bags for p in b.perPassenger}
    stow_a = {p.id: p.stowTime for p in a.perPassenger}
    stow_b = {p.id: p.stowTime for p in b.perPassenger}

    assert bags_a == bags_b, "the manifest MUST be shared -- that is strong CRN"
    shared_stow = sum(1 for i in stow_a if abs(stow_a[i] - stow_b[i]) < 1e-9)
    assert shared_stow < len(stow_a) // 2, (
        "service draws now appear to follow the passenger rather than the event "
        "order -- CRN got stronger, so update this test and the variance-reduction "
        "figures in PairedDifference's docstring")


def test_pairing_can_be_wider_than_unpaired_and_that_is_still_correct():
    """For a strategy whose service draws diverge strongly from the baseline's,
    the residual correlation is near zero and the paired interval can come out
    slightly wider. That is not a bug: with correlated samples the unpaired
    formula is invalid in both directions, and the paired one is the answer
    either way. Asserted so the property is understood rather than 'fixed'."""
    cfg = cfg_for("a320neo", "random", seed=1, loadFactor=0.9, doors=["1L"])
    res = compare_strategies(cfg, ["random", "back_to_front"], runs=25)
    b2f = next(b for b in res if b.strategy == "back_to_front")
    base = next(b for b in res if b.strategy == "random")
    paired = b2f.paired_against(base)
    unpaired = unpaired_ci(b2f.totalSeconds.values, base.totalSeconds.values)
    assert paired.ci95 == pytest.approx(unpaired, rel=0.35), (
        "paired and unpaired should be in the same ballpark here; a large gap "
        "either way means the correlation structure changed")
    assert paired.significant, "back-to-front is genuinely slower than random"
