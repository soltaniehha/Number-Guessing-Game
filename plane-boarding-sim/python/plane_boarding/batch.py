"""Monte Carlo driver: replications, strategy comparisons and load sweeps.

One deliberate design choice: every strategy in a comparison is run against the
**same seed sequence**. Because the `pax` stream is seeded independently of the
`order` stream, that means each strategy faces an identical passenger manifest
-- same bags, same walk speeds, same parties. This is common random numbers, and
it removes the manifest as a source of between-strategy variance, so a 20-run
comparison discriminates about as well as a few hundred independent runs would.
It is why the CLI's default run counts look small.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence

from .aircraft import get_aircraft
from .config import SimConfig, build_config
from .engine import simulate
from .metrics import Aggregate, RunResult
from .strategies import STRATEGIES


class BatchResult:
    """`n` replications of one strategy."""

    __slots__ = (
        "strategy", "aircraftId", "loadFactor", "runs", "totalSeconds",
        "gateChecks", "interference", "timeToSeat", "throughput", "paxCount",
    )

    def __init__(self, strategy: str, aircraft_id: str, load_factor: float,
                 results: Sequence[RunResult]):
        self.strategy = strategy
        self.aircraftId = aircraft_id
        self.loadFactor = load_factor
        self.runs = len(results)
        self.totalSeconds = Aggregate([r.totalSeconds for r in results])
        self.gateChecks = Aggregate([float(r.gateChecks) for r in results])
        self.throughput = Aggregate([r.throughputPaxPerMin for r in results])
        self.timeToSeat = Aggregate([r.p90TimeToSeat for r in results])
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
            "p90TimeToSeat": self.timeToSeat.to_dict(),
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
    return out


def load_sweep(
    cfg: SimConfig,
    load_factors: Sequence[float],
    strategies: Optional[Sequence[str]] = None,
    runs: int = 15,
    seed_base: Optional[int] = None,
    progress: Optional[Callable[[str, float, int, int], None]] = None,
) -> Dict[str, List[BatchResult]]:
    """Boarding time vs seat load factor.

    Schultz found the relationship is linear for both one-door and two-door
    aircraft across strategies, so a visibly non-linear sweep is a signal that
    something in the model is saturating when it should not be.
    """
    keys = list(strategies) if strategies else [cfg.strategy]
    out: Dict[str, List[BatchResult]] = {}
    for key in keys:
        series: List[BatchResult] = []
        for lf in load_factors:
            cb = (lambda k, f: (lambda i, total: progress(k, f, i, total)))(key, lf) if progress else None
            series.append(run_batch(cfg.replace(strategy=key, loadFactor=lf),
                                    runs=runs, seed_base=seed_base, progress=cb))
        out[key] = series
    return out
