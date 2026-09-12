"""Monte Carlo driver: replications, strategy comparisons and load sweeps.

One deliberate design choice: every strategy in a comparison is run against the
**same seed sequence**. Each strategy then faces an identical passenger manifest
-- same bags, same walk speeds, same parties -- because the `pax` stream is
seeded independently of the `order` stream, AND each passenger's own service
draws come from sub-streams keyed on that passenger rather than on when they
happen to board (ENGINE_SPEC 1.3). So the same traveller stows the same bag in
the same time whatever the boarding order, and the k-th arrival at a door waits
the same drawn gap. This is common random numbers, and it removes the manifest
and the service draws as sources of between-strategy variance, so a 20-run
comparison discriminates about as well as a few hundred independent runs would.
It is why the CLI's default run counts look small.

What it does NOT remove, and cannot, is the interaction: a given manifest suits
some orderings better than others, and that is the effect being measured.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Sequence

from .aircraft import get_aircraft
from .config import SimConfig
from .engine import simulate
from .metrics import Aggregate, PairedDifference, RunResult
from .strategies import STRATEGIES


class BatchResult:
    """`n` replications of one strategy."""

    __slots__ = (
        "strategy", "aircraftId", "loadFactor", "runs", "totalSeconds",
        "gateChecks", "interference", "timeToSeat", "boardingWait", "throughput",
        "paxCount", "sequencing", "seeds", "pairedVsBaseline",
    )

    def __init__(self, strategy: str, aircraft_id: str, load_factor: float,
                 results: Sequence[RunResult]):
        # Recorded so a paired comparison can VERIFY the pairing rather than
        # assume it. Two batches may only be paired if their seed sequences are
        # identical; otherwise the difference is between unrelated runs and the
        # resulting interval is confidently wrong.
        self.seeds = tuple(r.seed for r in results)
        self.pairedVsBaseline: Optional[PairedDifference] = None
        self.strategy = strategy
        self.aircraftId = aircraft_id
        self.loadFactor = load_factor
        self.runs = len(results)
        self.totalSeconds = Aggregate([r.totalSeconds for r in results])
        self.gateChecks = Aggregate([float(r.gateChecks) for r in results])
        self.throughput = Aggregate([r.throughputPaxPerMin for r in results])
        # p90 of the time each passenger spent between the aircraft door and
        # their seat. `timeToSeat` keeps its name because consumers use it, but
        # it is now the aisle quantity, i.e. what the name always claimed.
        self.timeToSeat = Aggregate([r.p90AisleSeconds for r in results])
        # p90 of the wait from doors-open to seated, jetbridge queue included.
        self.boardingWait = Aggregate([r.p90BoardingWaitSeconds for r in results])
        self.sequencing = Aggregate([r.doorSequencing for r in results])
        self.paxCount = results[0].paxCount if results else 0
        agg: Dict[str, float] = {"none": 0.0, "one": 0.0, "two": 0.0, "sameParty": 0.0}
        for r in results:
            for k in agg:
                agg[k] += r.interference[k]
        n = max(1, len(results))
        self.interference = {k: v / n for k, v in agg.items()}

    @property
    def mean(self) -> float:
        return self.totalSeconds.mean

    def paired_against(self, other: "BatchResult") -> PairedDifference:
        """Paired difference of this batch minus `other`. Negative = faster."""
        if self.seeds != other.seeds:
            raise ValueError(
                f"cannot pair {self.strategy!r} against {other.strategy!r}: seed "
                f"sequences differ, so the replications are not matched"
            )
        return PairedDifference(self.totalSeconds.values, other.totalSeconds.values,
                                baseline=other.strategy)

    def to_dict(self, keep_values: bool = False) -> Dict[str, Any]:
        return {
            "strategy": self.strategy,
            "name": STRATEGIES[self.strategy]["name"] if self.strategy in STRATEGIES else self.strategy,
            "aircraftId": self.aircraftId,
            "loadFactor": self.loadFactor,
            "runs": self.runs,
            "paxCount": self.paxCount,
            "totalSeconds": self.totalSeconds.to_dict(keep_values),
            "gateChecks": self.gateChecks.to_dict(),
            "throughputPaxPerMin": self.throughput.to_dict(),
            "p90AisleSeconds": self.timeToSeat.to_dict(),
            "p90BoardingWaitSeconds": self.boardingWait.to_dict(),
            "p90TimeToSeat": self.timeToSeat.to_dict(),
            "doorSequencing": self.sequencing.to_dict(),
            "pairedVsBaseline": (self.pairedVsBaseline.to_dict()
                                 if self.pairedVsBaseline else None),
            "interference": dict(self.interference),
        }


def run_batch(
    cfg: SimConfig,
    runs: int = 30,
    seed_base: Optional[int] = None,
    progress: Optional[Callable[[int, int], None]] = None,
) -> BatchResult:
    """`runs` replications of `cfg`, seeds `seed_base .. seed_base + runs - 1`."""
    if runs < 1:
        raise ValueError("runs must be >= 1")
    base = cfg.seed if seed_base is None else seed_base
    ac = get_aircraft(cfg.aircraftId)
    results: List[RunResult] = []
    for i in range(runs):
        results.append(simulate(cfg.replace(seed=base + i), ac=ac))
        if progress:
            progress(i + 1, runs)
    return BatchResult(cfg.strategy, cfg.aircraftId, cfg.loadFactor, results)


def compare_strategies(
    cfg: SimConfig,
    strategies: Optional[Sequence[str]] = None,
    runs: int = 30,
    seed_base: Optional[int] = None,
    progress: Optional[Callable[[str, int, int], None]] = None,
) -> List[BatchResult]:
    """Run every strategy over the same seed sequence and return them ranked
    fastest-first."""
    keys = list(strategies) if strategies else list(STRATEGIES)
    unknown = [k for k in keys if k not in STRATEGIES]
    if unknown:
        raise KeyError(f"unknown strategies: {unknown}")
    out: List[BatchResult] = []
    for key in keys:
        cb = (lambda k: (lambda i, total: progress(k, i, total)))(key) if progress else None
        out.append(run_batch(cfg.replace(strategy=key), runs=runs,
                             seed_base=seed_base, progress=cb))
    out.sort(key=lambda b: b.mean)
    # Attach the paired comparison against the `random` baseline. This is the
    # number that answers "is this strategy really better", as against the
    # marginal interval which answers "how long will it actually take".
    baseline = next((b for b in out if b.strategy == "random"), out[0] if out else None)
    if baseline is not None:
        for b in out:
            b.pairedVsBaseline = b.paired_against(baseline)
    return out


#: Parameters the sweep axis is offered for, with the label the CLI prints.
#:
#: `loadFactor` is the classic one. `preboardRate` earns its place because the
#: regime changes: at the shipped 2.5% preboarding is a prologue, but leisure
#: routes credibly run 20-33% (RESEARCH_AIRLINES 3.2, 7 #9), and somewhere above
#: ~15% the preboard block stops being a prologue and becomes the thing that
#: sets the boarding time -- at which point the ordering strategy underneath it
#: barely matters. That regime change is invisible unless you can sweep it.
SWEEPABLE: Dict[str, str] = {
    "loadFactor": "seat load factor",
    "preboardRate": "preboarding fraction of the cabin",
    "nonComplianceRate": "fraction ignoring their called group",
    "lateRate": "fraction arriving late",
    "stowPassSpeedFactor": "squeeze-past speed fraction",
    "binCongestionWeight": "bin-congestion stow penalty",
    "eliteForwardBias": "forward concentration of status",
    "zoneCount": "number of boarding zones",
}


def param_sweep(
    cfg: SimConfig,
    param: str,
    values: Sequence[float],
    strategies: Optional[Sequence[str]] = None,
    runs: int = 15,
    seed_base: Optional[int] = None,
    progress: Optional[Callable[[str, float, int, int], None]] = None,
) -> Dict[str, List[BatchResult]]:
    """Boarding time vs any one swept scenario parameter.

    Schultz found the load-factor relationship is linear for both one-door and
    two-door aircraft across strategies, so a visibly non-linear load sweep is a
    signal that something in the model is saturating when it should not be. The
    other axes have no such expectation -- `preboardRate` in particular is
    expected to bend, and finding where it bends is the point of sweeping it.
    """
    if param not in SWEEPABLE:
        raise KeyError(
            f"cannot sweep {param!r}; sweepable parameters: {sorted(SWEEPABLE)}"
        )
    keys = list(strategies) if strategies else [cfg.strategy]
    out: Dict[str, List[BatchResult]] = {}
    for key in keys:
        series: List[BatchResult] = []
        for v in values:
            cb = (lambda k, f: (lambda i, total: progress(k, f, i, total)))(key, v) if progress else None
            series.append(run_batch(cfg.replace(**{"strategy": key, param: v}),
                                    runs=runs, seed_base=seed_base, progress=cb))
        out[key] = series
    return out


def load_sweep(
    cfg: SimConfig,
    load_factors: Sequence[float],
    strategies: Optional[Sequence[str]] = None,
    runs: int = 15,
    seed_base: Optional[int] = None,
    progress: Optional[Callable[[str, float, int, int], None]] = None,
) -> Dict[str, List[BatchResult]]:
    """Boarding time vs seat load factor. Thin wrapper over `param_sweep`."""
    return param_sweep(cfg, "loadFactor", load_factors, strategies=strategies,
                       runs=runs, seed_base=seed_base, progress=progress)
