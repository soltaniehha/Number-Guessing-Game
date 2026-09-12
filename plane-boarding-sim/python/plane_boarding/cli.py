"""Command-line front end.

    python3 -m plane_boarding.cli run     --aircraft a320neo --strategy wilma
    python3 -m plane_boarding.cli compare --aircraft a320neo --runs 20
    python3 -m plane_boarding.cli sweep   --aircraft a320neo --strategies random wilma
    python3 -m plane_boarding.cli sweep   --param preboardRate --strategies wilma
    python3 -m plane_boarding.cli export  --aircraft b777_300er --replay --out out.json

The text output is meant to be read, not parsed: aligned columns, a bar chart of
relative times, and the diagnostic quantities (interference mix, gate checks,
where the time actually went) next to the headline number, because "23 minutes"
on its own tells you nothing about *why*.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List, Optional, Sequence

from .aircraft import aircraft_ids, geometry_payload, get_aircraft
from .batch import SWEEPABLE, compare_strategies, param_sweep, run_batch
from .config import ConfigError, SimConfig, build_config, expected_bags_per_pax
from .engine import run as engine_run
from .metrics import PairedDifference, RunResult
from .strategies import STRATEGIES

BAR_CHARS = "█"
LIGHT = "░"


def _fmt_mmss(seconds: float) -> str:
    m, s = divmod(int(round(seconds)), 60)
    return f"{m:d}:{s:02d}"


def _fmt_delta(seconds: float) -> str:
    """Signed m:ss, for a difference rather than a duration."""
    sign = "-" if seconds < 0 else "+"
    m, sec = divmod(int(round(abs(seconds))), 60)
    return f"{sign}{m:d}:{sec:02d}"


def _bar(value: float, vmax: float, width: int = 26) -> str:
    """A proportional bar. Always shows at least one cell so a fast strategy
    still reads as a row rather than as blank space."""
    if vmax <= 0:
        return ""
    filled = max(1, int(round(width * value / vmax)))
    return BAR_CHARS * filled + LIGHT * (width - filled)


def shared_ranks(means: Sequence[float], halfwidths: Sequence[float]) -> List[int]:
    """Competition ranks from MARGINAL intervals: overlapping CIs share a rank.

    Kept for the legend's cross-check against the paired view, and as the
    honest answer to "could these two durations be confused" when the reader is
    looking at absolute times. `shared_ranks_paired` is what actually ranks the
    table -- see its docstring for why.
    """
    return _rank_by(len(means), lambda i, lead:
                    means[i] - halfwidths[i] <= means[lead] + halfwidths[lead])


def shared_ranks_paired(series: Sequence[Sequence[float]]) -> List[int]:
    """Competition ranks from the PAIRED difference, which is the correct test.

    Under common random numbers replication `i` of every strategy faces an
    identical passenger manifest, so `T_a[i] - T_b[i]` cancels the manifest out.
    The samples are correlated, which means the independent-samples reasoning
    behind "their error bars overlap" is simply not valid here; the paired
    interval is the correct one, and in practice usually the tighter one too.
    Two strategies tie only when the interval on their paired difference
    contains zero.

    The old marginal rule was the conservative fallback: it over-called ties,
    which is the safer error when it is the only option available. It no longer
    is. Preferring the powered test does not change which error we would rather
    make -- calling a real difference a tie is still better than the reverse --
    it just means we now decline far fewer real differences.

    Overlap is still tested against the group LEADER rather than the previous
    entry: "not distinguishable from its neighbour" is not transitive and would
    merge an entire table into a single tie.
    """
    return _rank_by(len(series), lambda i, lead:
                    not PairedDifference(series[i], series[lead]).significant)


def _rank_by(n: int, ties_with_leader) -> List[int]:
    """Competition ranking (1, =2, =2, 4, ...) over a fastest-first list."""
    ranks: List[int] = []
    leader = 0
    for i in range(n):
        if i == 0:
            ranks.append(1)
        elif ties_with_leader(i, leader):
            ranks.append(ranks[leader])
        else:
            leader = i
            ranks.append(i + 1)
    return ranks


def _make_config(args: argparse.Namespace, strategy: Optional[str] = None) -> SimConfig:
    ac = get_aircraft(args.aircraft)
    overrides: Dict[str, Any] = {
        "aircraftId": args.aircraft,
        "strategy": strategy or getattr(args, "strategy", "random"),
        "seed": args.seed,
    }
    if args.load is not None:
        overrides["loadFactor"] = args.load
    if args.doors:
        overrides["doors"] = list(args.doors)
    if args.door_assignment:
        overrides["doorAssignment"] = args.door_assignment
    if getattr(args, "zones", None):
        overrides["zoneCount"] = args.zones
    if getattr(args, "set", None):
        for item in args.set:
            if "=" not in item:
                raise ConfigError(f"--set expects key=value, got {item!r}")
            k, v = item.split("=", 1)
            overrides[k] = json.loads(v)
    return build_config(ac.defaultConfig, overrides)


# ---------------------------------------------------------------------------
# run
# ---------------------------------------------------------------------------

def cmd_run(args: argparse.Namespace) -> int:
    cfg = _make_config(args)
    ac = get_aircraft(cfg.aircraftId)
    result, replay = engine_run(cfg, ac, record_replay=bool(args.replay))
    _print_run(cfg, ac, result)
    if args.replay:
        with open(args.replay, "w", encoding="utf-8") as fh:
            json.dump(replay, fh)
        print(f"\n  replay written to {args.replay} "
              f"({replay['frameCount']} frames @ {replay['frameInterval']}s)")
    return 0


def _print_run(cfg: SimConfig, ac, r: RunResult) -> None:
    strat = STRATEGIES[cfg.strategy]
    w = 66
    print()
    print("=" * w)
    print(f" {ac.name}  —  {strat['name']}")
    print("=" * w)
    print(f"  aircraft        {ac.id}  ({ac.seatCount} seats, "
          f"{ac.aisleCount} aisle{'s' if ac.aisleCount > 1 else ''}, "
          f"{len(ac.rowSlots)} rows, {ac.length:.1f} m cabin)")
    print(f"  doors           {', '.join(r.doors)}   [{cfg.doorAssignment}]")
    print(f"  passengers      {r.paxCount} of {r.seatCount} "
          f"({100 * r.paxCount / max(1, r.seatCount):.0f}% load, "
          f"{expected_bags_per_pax(cfg):.2f} bin bags/pax)")
    print(f"  seed            {cfg.seed}")
    print()
    print(f"  BOARDING TIME   {_fmt_mmss(r.totalSeconds)}   "
          f"({r.totalSeconds:.0f} s, {r.throughputPaxPerMin:.1f} pax/min)")
    if not r.completed:
        print("  ** did not complete within MAX_SIM_SECONDS **")
    print()
    print(f"  door to seat    median {_fmt_mmss(r.p50AisleSeconds)}   "
          f"p90 {_fmt_mmss(r.p90AisleSeconds)}   worst {_fmt_mmss(r.maxAisleSeconds)}")
    print(f"  doors-open to seat (incl. jetbridge queue)   "
          f"median {_fmt_mmss(r.p50BoardingWaitSeconds)}   "
          f"p90 {_fmt_mmss(r.p90BoardingWaitSeconds)}")
    print()

    tb = r.timeBreakdown
    total = sum(tb.values()) or 1.0
    print("  Where the passenger-seconds went")
    for key, label in (("walk", "walking / queueing"), ("blocked", "  of which blocked"),
                       ("stow", "stowing luggage"), ("shuffle", "seat shuffle")):
        v = tb[key]
        print(f"    {label:<22s} {v / r.paxCount:6.1f} s/pax   "
              f"{_bar(v, total, 22)}  {100 * v / total:4.1f}%")
    print()

    it = r.interference
    n = max(1, r.paxCount)
    print("  Seat interference")
    print(f"    clean sit-down       {it['none']:4d}  ({100 * it['none'] / n:4.1f}%)")
    print(f"    one blocker          {it['one']:4d}  ({100 * it['one'] / n:4.1f}%)")
    print(f"    two blockers         {it['two']:4d}  ({100 * it['two'] / n:4.1f}%)")
    print(f"    same party (cheap)   {it['sameParty']:4d}  ({100 * it['sameParty'] / n:4.1f}%)")
    print()
    print("  Overhead bins")
    print(f"    capacity             {ac.binBagsPerRowSide} bags per row-side")
    print(f"    displaced bags       {r.binSearches}")
    print(f"    gate-checked         {r.gateChecks}  ({100 * r.gateChecks / n:.1f}% of cabin)")
    print("=" * w)


# ---------------------------------------------------------------------------
# compare
# ---------------------------------------------------------------------------

def cmd_compare(args: argparse.Namespace) -> int:
    cfg = _make_config(args, strategy="random")
    ac = get_aircraft(cfg.aircraftId)
    keys = args.strategies or list(STRATEGIES)

    def progress(key: str, i: int, total: int) -> None:
        if not args.quiet:
            sys.stderr.write(f"\r  running {key:<20s} {i}/{total}   ")
            sys.stderr.flush()

    results = compare_strategies(cfg, keys, runs=args.runs, progress=progress)
    if not args.quiet:
        sys.stderr.write("\r" + " " * 60 + "\r")

    baseline = next((b for b in results if b.strategy == "random"), results[-1])
    worst = max(b.mean for b in results)

    print()
    print("=" * 118)
    print(f" {ac.name}  —  {args.runs} replications per strategy, "
          f"{results[0].paxCount} passengers, doors {','.join(cfg.doors or ac.default_doors())}")
    print(" ranked fastest first by the PAIRED comparison against free-for-all")
    print("=" * 118)
    multi_door = len(cfg.doors or ac.default_doors()) > 1
    series = [b.totalSeconds.values for b in results]
    ranks = shared_ranks_paired(series)
    marginal = shared_ranks([b.mean for b in results],
                            [b.totalSeconds.ci95 for b in results])
    tied = {r for r in ranks if ranks.count(r) > 1}

    print(f" {'#':>3}  {'strategy':<20s} {'mean':>7s} {'+/-95%':>7s} {'p95':>6s} "
          f"{'vs rnd':>7s}  {'paired vs random (95% CI)':<25s} {'far-1st':>7s}  "
          f"relative time")
    print("-" * 118)
    for b, rank in zip(results, ranks):
        ratio = b.mean / baseline.mean if baseline.mean else 0.0
        pv = b.pairedVsBaseline
        if pv is None or b.strategy == baseline.strategy:
            paired = "(baseline)"
        else:
            paired = (f"{_fmt_delta(pv.mean)} "
                      f"[{_fmt_delta(pv.lo)},{_fmt_delta(pv.hi)}]"
                      f"{'' if pv.significant else '  ns'}")
        label = f"={rank}" if rank in tied else str(rank)
        print(f" {label:>3s}  {b.strategy:<20s} {_fmt_mmss(b.mean):>7s} "
              f"{b.totalSeconds.ci95:7.1f} {_fmt_mmss(b.totalSeconds.p95):>6s} "
              f"{ratio:7.3f}  {paired:<25s} {b.sequencing.mean:+7.2f}  "
              f"{_bar(b.mean, worst, 18)}")
    print("-" * 118)
    print(" 'mean +/-95%' is the MARGINAL interval: how long this strategy actually "
          "takes, on its own.")
    print(" 'paired vs random' is the per-replication difference on matched seeds. "
          "Every strategy")
    print("   sees the identical passenger manifest, so the difference cancels it out. "
          "That makes this")
    print("   the correct test -- the samples are correlated, so overlapping marginal "
          "bars prove nothing")
    print("   either way -- and usually the tighter one. 'ns' = interval contains zero. "
          "RANKS USE THIS.")
    if tied:
        print(" '=' marks a SHARED rank: the paired test cannot separate those "
              "strategies at this many")
        print("   replications. Treat them as equal, not as ordered.")
    if ranks != marginal:
        n_extra = sum(1 for r in marginal if marginal.count(r) > 1) - \
                  sum(1 for r in ranks if ranks.count(r) > 1)
        print(f" NOTE: the marginal view would call {max(0, n_extra)} more of these "
              f"a tie. The two disagreeing is")
        print("   the point, not a fault: pairing is the more powerful test, so "
              "differences can be real")
        print("   even where the absolute-time intervals overlap.")
    best = results[0]
    saving = baseline.mean - best.mean
    joint = [b.strategy for b, r in zip(results, ranks) if r == ranks[0]]
    if len(joint) > 1:
        print(f" best: {len(joint)} strategies tie for first ({', '.join(joint)})"
              f"  —  about {_fmt_mmss(saving)} faster than free-for-all "
              f"({100 * saving / baseline.mean:.1f}%)")
    else:
        print(f" best: {STRATEGIES[best.strategy]['name']}  —  "
              f"{_fmt_mmss(saving)} faster than free-for-all "
              f"({100 * saving / baseline.mean:.1f}%)")
    print(" seat interference (mean events/run):  "
          + "   ".join(f"{b.strategy}={b.interference['one'] + b.interference['two']:.0f}"
                       for b in results[:4]))
    if multi_door:
        # The counter-intuitive finding worth putting in front of the user: a
        # rear-first zone scheme sends everyone it calls to the AFT door while
        # the forward door stands empty, so a method designed to spread the
        # aisle ends up serialising the two doors instead.
        by_seq = sorted(results, key=lambda b: b.sequencing.mean)
        worstseq = by_seq[0]
        if worstseq.sequencing.mean < -0.05:
            print(f" door sequencing: '{worstseq.strategy}' scores "
                  f"{worstseq.sequencing.mean:+.2f} -- it loads the rows NEAREST a door "
                  f"first, which is the front-to-back pathology in miniature.")
            print("   -> With two doors a single cabin-wide zone order cannot be right for "
                  "both: calling the rear zone first is far-end-first at 1L and "
                  "near-end-first at 2L. Zone order has to be set per door.")
    print("=" * 118)
    return 0


# ---------------------------------------------------------------------------
# sweep
# ---------------------------------------------------------------------------

#: Default sweep points per parameter. `preboardRate` deliberately runs out to
#: a third of the cabin: that is the leisure-route figure, and the interesting
#: part of the curve is above 15% where preboarding takes over as the binding
#: constraint (RESEARCH_AIRLINES 3.2, 7 #9).
_SWEEP_DEFAULTS = {
    "loadFactor": [0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    "preboardRate": [0.0, 0.025, 0.05, 0.10, 0.15, 0.20, 0.25, 0.33],
    "nonComplianceRate": [0.0, 0.05, 0.15, 0.30, 0.50],
    "lateRate": [0.0, 0.01, 0.05, 0.10, 0.20],
    "stowPassSpeedFactor": [0.0, 0.2, 0.3, 0.4, 0.6],
    "binCongestionWeight": [0.0, 0.25, 0.45, 0.75, 1.0],
    "eliteForwardBias": [0.0, 0.25, 0.5, 0.75, 1.0],
    "zoneCount": [2, 3, 4, 5, 6],
}


def cmd_sweep(args: argparse.Namespace) -> int:
    cfg = _make_config(args, strategy="random")
    ac = get_aircraft(cfg.aircraftId)
    keys = args.strategies or ["random"]
    param = args.param
    values = args.factors or _SWEEP_DEFAULTS[param]

    def progress(key: str, v: float, i: int, total: int) -> None:
        if not args.quiet:
            sys.stderr.write(f"\r  {key:<18s} {param} {v:.3f}  {i}/{total}   ")
            sys.stderr.flush()

    series = param_sweep(cfg, param, values, keys, runs=args.runs, progress=progress)
    if not args.quiet:
        sys.stderr.write("\r" + " " * 60 + "\r")

    allmax = max(b.mean for s in series.values() for b in s)
    print()
    print("=" * 88)
    print(f" {ac.name}  —  boarding time vs {SWEEPABLE[param]} "
          f"({args.runs} replications per point)")
    if param == "loadFactor":
        print(" Schultz finds this relationship is LINEAR for both one- and two-door "
              "boarding; a bend means something is saturating.")
    elif param == "preboardRate":
        print(" Watch for the knee: above roughly 15% the preboard block, not the "
              "boarding order, is what sets the time.")
    print("=" * 88)
    for key, rows in series.items():
        print(f"\n  {STRATEGIES[key]['name']}")
        print(f"    {param[:9]:>9s} {'pax':>5s} {'mean':>7s} {'s/pax':>6s}  ")
        for v, b in zip(values, rows):
            spp = b.mean / b.paxCount if b.paxCount else 0.0
            print(f"    {v:9.3f} {b.paxCount:5d} {_fmt_mmss(b.mean):>7s} "
                  f"{spp:6.2f}  {_bar(b.mean, allmax, 30)}")
    print("=" * 88)
    return 0


# ---------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------

def cmd_export(args: argparse.Namespace) -> int:
    cfg = _make_config(args)
    ac = get_aircraft(cfg.aircraftId)
    if args.geometry:
        payload: Any = geometry_payload(ac)
    elif args.replay:
        payload = engine_run(cfg, ac, record_replay=True)[1]
    elif args.runs > 1:
        payload = run_batch(cfg, runs=args.runs).to_dict(keep_values=True)
    else:
        payload = engine_run(cfg, ac)[0].to_dict(per_passenger=not args.no_pax)
    text = json.dumps(payload, sort_keys=args.sorted, indent=args.indent)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"wrote {args.out} ({len(text)} bytes)", file=sys.stderr)
    else:
        print(text)
    return 0


# ---------------------------------------------------------------------------
# argument parsing
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="plane_boarding",
        description="Deterministic airplane-boarding simulator.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="aircraft: " + ", ".join(aircraft_ids())
               + "\nstrategies: " + ", ".join(STRATEGIES),
    )
    sub = p.add_subparsers(dest="command", required=True)

    def common(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--aircraft", "-a", default="a320neo", choices=aircraft_ids())
        sp.add_argument("--load", "-l", type=float, default=None,
                        help="seat load factor 0..1 (default: from defaults.json)")
        sp.add_argument("--seed", "-s", type=int, default=1)
        sp.add_argument("--doors", nargs="+", default=None,
                        help="door ids to enable, e.g. --doors 1L 2L")
        sp.add_argument("--door-assignment", default=None,
                        choices=["single", "split_by_row", "split_by_aisle"])
        sp.add_argument("--zones", type=int, default=None)
        sp.add_argument("--set", action="append", default=None, metavar="KEY=JSON",
                        help="override any config key, e.g. --set nonComplianceRate=0")
        sp.add_argument("--quiet", "-q", action="store_true")

    sp = sub.add_parser("run", help="one scenario, pretty text summary")
    common(sp)
    sp.add_argument("--strategy", "-S", default="random", choices=list(STRATEGIES))
    sp.add_argument("--replay", default=None, metavar="FILE",
                    help="also write a replay JSON for the visualiser")
    sp.set_defaults(func=cmd_run)

    sp = sub.add_parser("compare", help="all strategies, ranked table with CIs")
    common(sp)
    sp.add_argument("--runs", "-n", type=int, default=20)
    sp.add_argument("--strategies", nargs="+", default=None, choices=list(STRATEGIES))
    sp.set_defaults(func=cmd_compare)

    sp = sub.add_parser("sweep", help="boarding time vs a swept scenario parameter")
    common(sp)
    sp.add_argument("--runs", "-n", type=int, default=10)
    sp.add_argument("--strategies", nargs="+", default=None, choices=list(STRATEGIES))
    sp.add_argument("--param", "-p", default="loadFactor", choices=sorted(SWEEPABLE),
                    help="which scenario parameter to sweep (default: loadFactor)")
    sp.add_argument("--factors", "-f", nargs="+", type=float, default=None,
                    metavar="VALUE", help="sweep points; defaults per parameter")
    sp.set_defaults(func=cmd_sweep)

    sp = sub.add_parser("export", help="dump JSON")
    common(sp)
    sp.add_argument("--strategy", "-S", default="random", choices=list(STRATEGIES))
    sp.add_argument("--runs", "-n", type=int, default=1)
    sp.add_argument("--replay", action="store_true", help="export a replay buffer")
    sp.add_argument("--geometry", action="store_true", help="export resolved geometry only")
    sp.add_argument("--no-pax", action="store_true", help="omit perPassenger records")
    sp.add_argument("--indent", type=int, default=None)
    sp.add_argument("--sorted", action="store_true")
    sp.add_argument("--out", "-o", default=None)
    sp.set_defaults(func=cmd_export)

    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except ConfigError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
