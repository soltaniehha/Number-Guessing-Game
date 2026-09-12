"""Calibration gates against the boarding literature.

These are the tests that stop the model drifting away from reality. They are
slower than the rest of the suite on purpose: a mean over enough replications is
the only thing that can be compared to a field measurement.

Provenance for every number here is docs/RESEARCH_PARAMETERS.md.
"""

from __future__ import annotations

from plane_boarding.batch import compare_strategies, run_batch

from helpers import cfg_for

#: Schultz's field regression over 282 measured single-aisle boardings:
#:     T_board ~= 4.5 s * N_pax + 138 s
SCHULTZ_SLOPE, SCHULTZ_OFFSET = 4.5, 138.0

#: 180 passengers => 948 s. The accepted band is +/-15%, NOT Schultz's own <5%
#: model-vs-field deviation, for two reasons documented in RESEARCH_PARAMETERS
#: 11.1: (a) the regression is a linear fit across a 29-190 pax range rather
#: than a point measurement, and (b) we sample per-passenger walk speed, which
#: Schultz does not, and heterogeneous-speed queues run a little slower at the
#: same mean speed. Do not widen this band without reading that section.
TARGET_180 = SCHULTZ_SLOPE * 180 + SCHULTZ_OFFSET
BAND_LO, BAND_HI = TARGET_180 * 0.85, TARGET_180 * 1.15


def a320_at_180(**overrides):
    """The A320neo has 186 seats, so 180 passengers is a 96.8% load factor."""
    return cfg_for("a320neo", "random", seed=1, loadFactor=180 / 186, **overrides)


def test_absolute_boarding_time_matches_the_field_regression():
    """THE calibration gate. Random boarding, 180 passengers, single door.

    Schultz's regression is over 282 field-measured A320/737 boardings, which
    are overwhelmingly single-door jetbridge operations -- so this is the
    apples-to-apples configuration, and the one the product's headline "your
    flight boarded in N minutes" has to get right.

    The +/-15% band is wider than Schultz's own <5% model-vs-field deviation for
    two reasons documented in RESEARCH_PARAMETERS 11.1: the regression is a
    linear fit across a 29-190 pax range rather than a point measurement, and we
    sample per-passenger walk speed, which he does not. Do not widen it without
    reading that section.

    Hitting this depends on `stowPassSpeedFactor` > 0 (ENGINE_SPEC 6.3). With
    strict blocking the same scenario lands ~50% high.
    """
    b = run_batch(a320_at_180(doors=["1L"]), runs=30)
    assert b.paxCount == 180
    assert BAND_LO <= b.mean <= BAND_HI, (
        f"mean {b.mean:.0f}s is outside {BAND_LO:.0f}-{BAND_HI:.0f}s "
        f"(target {TARGET_180:.0f}s from T = 4.5N + 138)")


def test_strict_blocking_remains_available_and_is_the_slower_variant():
    """`stowPassSpeedFactor = 0` is a first-class option, not a dead branch: it
    is Schultz's own strict cellular blocking, and it is the right choice for
    anyone who cares about strategy-ratio magnitudes more than absolute times.
    Pinned so it cannot rot."""
    strict = run_batch(a320_at_180(doors=["1L"], stowPassSpeedFactor=0.0), runs=20)
    assert 1250 <= strict.mean <= 1600
    assert strict.mean > BAND_HI, "strict blocking overshoots the regression, by design"


def test_two_door_boarding_is_sensible_and_meaningfully_faster():
    """The as-operated easyJet configuration. Not a second calibration gate --
    the regression describes single-door operations -- but a second door has to
    buy a large, plausible saving or the door model is wrong."""
    two = run_batch(a320_at_180(), runs=25)
    one = run_batch(a320_at_180(doors=["1L"]), runs=25)
    assert 450 <= two.mean <= 950
    assert 0.20 <= 1.0 - two.mean / one.mean <= 0.50, (
        f"second door saved {100 * (1 - two.mean / one.mean):.0f}%")


def test_schultz_reference_configuration_is_stable():
    """Schultz's own configuration: walkSpeedSd = 0 for his deterministic
    0.8 m/s, stowPassSpeedFactor = 0 for his strict cellular blocking. BOTH are
    pinned here rather than inherited, exactly as in the `schultz_reference`
    parity fixture -- the point of this configuration is that it does not move
    when a shipped default does. A regression canary with no speed noise to hide
    a change behind."""
    b = run_batch(a320_at_180(doors=["1L"], walkSpeedSd=0.0,
                              stowPassSpeedFactor=0.0), runs=25)
    assert 1250 <= b.mean <= 1600
    varied = run_batch(a320_at_180(doors=["1L"], stowPassSpeedFactor=0.0), runs=25)
    assert b.totalSeconds.sd <= varied.totalSeconds.sd * 1.35, (
        "removing speed variance must not widen the boarding-time distribution")


def test_partial_blocking_mechanism_does_what_it_claims():
    """`stowPassSpeedFactor` is off by default but must stay working, because
    it is the one lever that closes the absolute-time gap and someone will
    reach for it. Faster squeeze => faster boarding, monotonically; and the
    default of 0 must reproduce strict blocking exactly."""
    strict = run_batch(a320_at_180(doors=["1L"], stowPassSpeedFactor=0.0), runs=12)
    slow = run_batch(a320_at_180(doors=["1L"], stowPassSpeedFactor=0.25), runs=12)
    quick = run_batch(a320_at_180(doors=["1L"], stowPassSpeedFactor=0.60), runs=12)
    assert strict.mean > slow.mean > quick.mean
    # Turning it on closes most of the gap to the field regression -- which is
    # exactly why it is tempting, and exactly what RESEARCH_PARAMETERS 12.3
    # weighs against the ratio cost.
    assert quick.mean < strict.mean * 0.80
    # The squeeze lock and the deferred stand-up are a deadlock risk if either
    # side is got wrong, so assert the runs actually terminate.
    for b in (slow, quick):
        assert b.totalSeconds.max < 3600
    shipped = run_batch(a320_at_180(doors=["1L"], stowPassSpeedFactor=0.40), runs=12)
    default = run_batch(a320_at_180(doors=["1L"]), runs=12)
    assert default.mean == shipped.mean, "the shipped default must be 0.40"


def test_strategy_ordering_matches_the_literature():
    """THE comparative gate. Every relation asserted here was verified stable
    across independent seed bases before being written down -- a strategy
    comparison that only holds on one seed is not a finding.

        front_to_back > back_to_front > random > {wilma, reverse_pyramid}
                                               > steffen_perfect

    WilMA and reverse pyramid are asserted as a TIED PAIR, not ordered against
    each other. At the shipped `stowPassSpeedFactor` of 0.40 they land within
    ~0.1% of each other and their order flips with the seed (5 of 6 seed bases
    put reverse pyramid on the slower side). Asserting a strict order between
    them would be asserting noise. Note the literature is weak here too: reverse
    pyramid was never in the Steffen & Hotchkiss experiment, and its placement
    between WilMA and Steffen rests on simulation consensus alone
    (RESEARCH_PARAMETERS 5c). Under strict blocking the model does separate them
    cleanly (0.94 vs 0.90) -- losing that separation is part of the price of the
    0.40 default, recorded in RESEARCH_PARAMETERS 12.3.
    """
    cfg = a320_at_180(doors=["1L"])
    keys = ["front_to_back", "back_to_front", "random", "wilma",
            "reverse_pyramid", "steffen_perfect"]
    res = {b.strategy: b.mean for b in compare_strategies(cfg, keys, runs=30)}
    outside_in = min(res["wilma"], res["reverse_pyramid"])
    outside_in_slow = max(res["wilma"], res["reverse_pyramid"])

    assert res["front_to_back"] > res["back_to_front"], "front-to-back is the worst"
    assert res["back_to_front"] > res["random"], "zone schemes lose to free-for-all"
    assert res["random"] > outside_in_slow, "outside-in beats random"
    assert outside_in > res["steffen_perfect"], "Steffen beats outside-in"


def test_a_cabin_wide_zone_order_cannot_be_right_for_two_doors():
    """A finding worth pinning, because it is counter-intuitive and it falls out
    of the model rather than being put in.

    "Board the rear zone first" means far-end-first at the forward door and
    NEAR-end-first at the aft door, and near-end-first is the front-to-back
    pathology. So a zone scheme that helps through one door hurts through two.
    The `doorSequencing` metric measures exactly this -- distance-from-door of
    the first half of a door's queue minus the second half, reported for the
    WORST door -- and the CLI surfaces it.
    """
    one = run_batch(a320_at_180(doors=["1L"]).replace(strategy="back_to_front"), runs=20)
    two = run_batch(a320_at_180(doors=["1L", "2L"]).replace(strategy="back_to_front"), runs=20)
    rnd1 = run_batch(a320_at_180(doors=["1L"]), runs=20)
    rnd2 = run_batch(a320_at_180(doors=["1L", "2L"]), runs=20)

    # Through one door the scheme is unambiguously far-end-first.
    assert one.sequencing.mean > 0.20
    # Through two it is near-end-first at the aft door, and that shows up.
    assert two.sequencing.mean < -0.10
    # And the penalty is real, not just a metric artefact.
    assert two.mean / rnd2.mean > one.mean / rnd1.mean
    # Random has no spatial logic at all, so it scores ~0 either way.
    assert abs(rnd2.sequencing.mean) < 0.10


#: MONITORED, not gated. The published ratio magnitudes, with tolerances wide
#: enough to catch a structural regression and no wider. RESEARCH_PARAMETERS
#: 11.2 is explicit that magnitudes must NOT be a pass/fail gate: the
#: experimental column (Steffen & Hotchkiss, 72 volunteers) and the simulation
#: consensus disagree by a wide margin -- Steffen sits at 0.76 experimentally
#: against 0.55-0.75 in simulation -- so any single band is a claim the
#: literature does not support. The ORDERING is the gate; these are a tripwire.
MONITORED_RATIOS = {
    #  strategy            published    monitored band
    "front_to_back":      ((1.30, 1.50), (1.15, 1.75)),
    "back_to_front":      ((1.20, 1.35), (1.02, 1.55)),
    "wilma":              ((0.85, 0.92), (0.80, 0.99)),
    "reverse_pyramid":    ((0.82, 0.90), (0.78, 0.99)),
    "steffen_perfect":    ((0.70, 0.80), (0.65, 0.92)),
}


def test_relative_speedups_stay_in_the_published_neighbourhood():
    """Tripwire on the ratio magnitudes. See MONITORED_RATIOS for why these are
    monitored rather than gated, and note the failure message prints the whole
    table -- if this fires, the useful information is the shape of the drift,
    not which single number crossed a line."""
    cfg = a320_at_180(doors=["1L"])
    keys = list(MONITORED_RATIOS)
    res = {b.strategy: b.mean for b in compare_strategies(cfg, keys + ["random"], runs=25)}
    base = res["random"]

    rows, failures = [], []
    for key, ((plo, phi), (mlo, mhi)) in MONITORED_RATIOS.items():
        r = res[key] / base
        inside_published = plo <= r <= phi
        inside_monitored = mlo <= r <= mhi
        rows.append(f"    {key:<18s} {r:5.3f}   published {plo:.2f}-{phi:.2f} "
                    f"{'ok ' if inside_published else 'OUT'}   "
                    f"monitored {mlo:.2f}-{mhi:.2f} {'ok' if inside_monitored else 'OUT'}")
        if not inside_monitored:
            failures.append(key)

    report = (
        "\nstrategy ratio table (a320neo, 1L only, 180 pax, random = 1.000):\n"
        + "\n".join(rows)
        + "\n\n  Published-band misses are INFORMATIONAL. docs/RESEARCH_PARAMETERS.md"
          "\n  section 11.2: the experimental and simulation columns disagree too"
          "\n  widely for magnitudes to gate, so the ORDERING is the assertion that"
          "\n  matters (see test_strategy_ordering_matches_the_literature)."
          "\n  Section 12.3 records that partial aisle blocking deliberately"
          "\n  compresses these ratios toward parity in exchange for credible"
          "\n  absolute times."
          "\n  A monitored-band miss is different: that is a structural regression"
          "\n  and something is actually broken."
    )
    assert not failures, f"ratios outside their MONITORED bands: {failures}\n{report}"


def test_boarding_time_is_linear_in_load_factor():
    """Schultz finds the relationship is linear for both one- and two-door
    aircraft. A bend would mean something in the model saturates."""
    for doors in (["1L"], ["1L", "2L"]):
        xs, ys = [], []
        for lf in (0.45, 0.6, 0.7, 0.85, 1.0):
            b = run_batch(cfg_for("a320neo", "random", seed=1, loadFactor=lf,
                                  doors=doors), runs=16)
            xs.append(b.paxCount)
            ys.append(b.mean)
        n = len(xs)
        mx, my = sum(xs) / n, sum(ys) / n
        sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        sxx = sum((x - mx) ** 2 for x in xs)
        syy = sum((y - my) ** 2 for y in ys)
        r2 = (sxy * sxy) / (sxx * syy)
        assert r2 > 0.97, f"doors={doors}: load-factor response is not linear (R2={r2:.3f})"
        assert ys == sorted(ys), "more passengers must take longer"


def test_e175_gate_check_rate_matches_the_reported_field_figure():
    """United report ~6.7 gate-checked bags per E175 departure, about 9% of the
    cabin. With only ~36 bin slots for 76 seats this is the end-to-end check on
    the whole bin model -- capacity, outward search and the gate-check fallback.
    """
    b = run_batch(cfg_for("e175", "random", seed=1), runs=25)
    rate = b.gateChecks.mean / b.paxCount
    assert 0.05 <= rate <= 0.15, f"gate-check rate {100 * rate:.1f}% of the cabin"


def test_roomier_bins_gate_check_less():
    tight = run_batch(cfg_for("e175", "random", seed=1), runs=10)
    retrofit = run_batch(cfg_for("e175", "random", seed=1, binBagsPerRowSide=2), runs=10)
    assert retrofit.gateChecks.mean < tight.gateChecks.mean


def test_a_full_narrowbody_boards_in_a_plausible_wall_clock_time():
    for aid in ("a320neo", "b737_max8", "a220_300"):
        b = run_batch(cfg_for(aid, "random", seed=2, loadFactor=1.0), runs=6)
        minutes = b.mean / 60.0
        assert 12.0 <= minutes <= 45.0, f"{aid} boards in {minutes:.1f} min"


def test_a_second_door_buys_roughly_a_third_off():
    one = run_batch(cfg_for("a320neo", "random", seed=1, doors=["1L"]), runs=12)
    two = run_batch(cfg_for("a320neo", "random", seed=1, doors=["1L", "2L"]), runs=12)
    saving = 1.0 - two.mean / one.mean
    assert 0.20 <= saving <= 0.50, f"second door saved {100 * saving:.0f}%"


def test_twin_aisle_reverses_the_narrowbody_wisdom():
    """Two published findings that our model has to reproduce, both about what
    happens when you add a second aisle:

    * Schmidt et al. compared six methods on a B777 and found the **reverse
      pyramid** best there, not Steffen.
    * Ryd, Khandelwal, So & Steffen (2024) find the Steffen advantage
      **collapses** as aisles are added -- congestion, not sequencing, is what
      the clever orders were fixing, and a second aisle fixes it for free.
    """
    cfg = cfg_for("b777_300er", "random", seed=1)
    keys = ["random", "reverse_pyramid", "steffen_perfect", "front_to_back"]
    res = {b.strategy: b.mean for b in compare_strategies(cfg, keys, runs=14)}
    base = res["random"]
    assert res["reverse_pyramid"] < base, "reverse pyramid should win on a twin aisle"
    assert res["steffen_perfect"] / base > 0.90, (
        "Steffen's narrowbody advantage must collapse on a twin aisle")
    assert res["front_to_back"] > base, "front-to-back is bad everywhere"
