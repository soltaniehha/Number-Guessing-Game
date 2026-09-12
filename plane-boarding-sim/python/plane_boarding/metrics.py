"""Result schema (ENGINE_SPEC 7) and the summary statistics built on top of it."""

from __future__ import annotations

from typing import Any, Dict, Sequence


def percentile(sorted_values: Sequence[float], q: float) -> float:
    """Linear-interpolated percentile on an already-sorted sequence.

    Spelled out rather than delegated because the JS engine has to reproduce it
    exactly, and every language's built-in disagrees about interpolation.
    """
    n = len(sorted_values)
    if n == 0:
        return 0.0
    if n == 1:
        return float(sorted_values[0])
    pos = q * (n - 1)
    lo = int(pos)
    hi = min(lo + 1, n - 1)
    frac = pos - lo
    return float(sorted_values[lo]) * (1.0 - frac) + float(sorted_values[hi]) * frac


class PassengerRecord:
    """Per-passenger outcome. Flat and JSON-shaped on purpose: it goes straight
    into the replay file and the web app's per-passenger inspector."""

    __slots__ = (
        "id", "seat", "row", "letter", "depth", "tier", "groupLabel", "doorId",
        "bags", "party", "enterTime", "sitTime", "timeInAisle", "walkTime",
        "stowTime", "shuffleTime", "blockedTime", "queueWaitTime", "blockers",
        "gateChecked",
    )

    def __init__(self, **kw: Any):
        for k, v in kw.items():
            setattr(self, k, v)

    def to_dict(self) -> Dict[str, Any]:
        return {k: getattr(self, k) for k in self.__slots__}


class RunResult:
    """Everything one replication produced."""

    __slots__ = (
        "totalSeconds", "totalMinutes", "strategy", "aircraftId", "seed",
        "paxCount", "seatCount", "loadFactor", "doors",
        "seatedCurve", "aisleOccupancy", "congestion", "perPassenger",
        "timeBreakdown", "interference", "gateChecks", "binSearches",
        "aisleBlockEvents",
        "p50AisleSeconds", "p90AisleSeconds", "maxAisleSeconds",
        "p50BoardingWaitSeconds", "p90BoardingWaitSeconds",
        "p50TimeToSeat", "p90TimeToSeat", "maxTimeToSeat",
        "throughputPaxPerMin", "completed", "doorStats", "doorSequencing",
    )

    def __init__(self, **kw: Any):
        for k, v in kw.items():
            setattr(self, k, v)

    @property
    def gateCheckRate(self) -> float:
        """Gate-checked bags per passenger. The E175's headline realism check."""
        return self.gateChecks / self.paxCount if self.paxCount else 0.0

    def to_dict(self, per_passenger: bool = True) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "totalSeconds": self.totalSeconds,
            "totalMinutes": self.totalMinutes,
            "strategy": self.strategy,
            "aircraftId": self.aircraftId,
            "seed": self.seed,
            "paxCount": self.paxCount,
            "seatCount": self.seatCount,
            "loadFactor": self.loadFactor,
            "doors": list(self.doors),
            "seatedCurve": [{"t": t, "seated": s} for t, s in self.seatedCurve],
            "aisleOccupancy": [{"t": t, "count": c} for t, c in self.aisleOccupancy],
            "congestion": self.congestion,
            "timeBreakdown": dict(self.timeBreakdown),
            "interference": dict(self.interference),
            "gateChecks": self.gateChecks,
            "binSearches": self.binSearches,
            "aisleBlockEvents": self.aisleBlockEvents,
            "p50AisleSeconds": self.p50AisleSeconds,
            "p90AisleSeconds": self.p90AisleSeconds,
            "maxAisleSeconds": self.maxAisleSeconds,
            "p50BoardingWaitSeconds": self.p50BoardingWaitSeconds,
            "p90BoardingWaitSeconds": self.p90BoardingWaitSeconds,
            "p50TimeToSeat": self.p50TimeToSeat,
            "p90TimeToSeat": self.p90TimeToSeat,
            "maxTimeToSeat": self.maxTimeToSeat,
            "throughputPaxPerMin": self.throughputPaxPerMin,
            "completed": self.completed,
            "doorStats": {k: dict(v) for k, v in self.doorStats.items()},
            "doorSequencing": self.doorSequencing,
        }
        if per_passenger:
            out["perPassenger"] = [r.to_dict() for r in self.perPassenger]
        return out


class Aggregate:
    """mean / sd / min / max / p05 / p50 / p95 over a sample."""

    __slots__ = ("n", "mean", "sd", "min", "max", "p05", "p50", "p95", "values")

    def __init__(self, values: Sequence[float], keep_values: bool = True):
        vals = [float(v) for v in values]
        n = len(vals)
        self.n = n
        self.values = vals if keep_values else []
        if n == 0:
            self.mean = self.sd = self.min = self.max = 0.0
            self.p05 = self.p50 = self.p95 = 0.0
            return
        mean = sum(vals) / n
        var = sum((v - mean) ** 2 for v in vals) / (n - 1) if n > 1 else 0.0
        s = sorted(vals)
        self.mean = mean
        self.sd = var ** 0.5
        self.min = s[0]
        self.max = s[-1]
        self.p05 = percentile(s, 0.05)
        self.p50 = percentile(s, 0.50)
        self.p95 = percentile(s, 0.95)

    @property
    def ci95(self) -> float:
        """Half-width of the 95% confidence interval on the mean."""
        if self.n < 2:
            return 0.0
        return 1.96 * self.sd / (self.n ** 0.5)

    def to_dict(self, keep_values: bool = False) -> Dict[str, Any]:
        d = {
            "n": self.n, "mean": self.mean, "sd": self.sd, "min": self.min,
            "max": self.max, "p05": self.p05, "p50": self.p50, "p95": self.p95,
            "ci95": self.ci95,
        }
        if keep_values:
            d["values"] = list(self.values)
        return d


class PairedDifference:
    """Paired comparison of two strategies run under common random numbers.

    With CRN, replication `i` of every strategy faces the SAME passenger
    manifest -- same bags, same walk speeds, same parties -- because the `pax`
    stream is seeded independently of the `order` stream. The difference
    `T_a[i] - T_b[i]` cancels the manifest out, and a confidence interval on the
    mean of those differences is the **statistically correct** analysis: the two
    samples are correlated, so the independent-samples formula you would apply
    by eye to two marginal error bars does not hold in either direction.

    It is also much tighter, because the CRN is now COMPLETE rather than
    partial. Every service draw comes from a sub-stream keyed on the passenger
    (or, for door arrivals, on the door and the release index) instead of from a
    single event-ordered stream, so the same passenger draws the same stow time,
    the same shuffle movements and the same bin behaviour whenever they board,
    and the k-th arrival at a door waits the same gap under every strategy.
    See ENGINE_SPEC 1.3.

    What remains order-dependent is order-dependent in the world, not in the
    generator: how full the bin above your row is when you reach it, and how
    many people you have to climb over, both genuinely depend on who boarded
    first. Those are the effect being measured, not noise to be cancelled.

    Measured on a320neo/1L/180 pax at 30 replications, the paired interval now
    runs an order of magnitude narrower than the unpaired one, and it is
    narrower for every strategy including the ones that diverge hardest from the
    baseline -- which was not true of the old event-ordered scheme, where
    back-to-front could pair WIDER than it paired unpaired.

    Sign convention: negative means `a` is FASTER than `b`.

    """

    __slots__ = ("baseline", "n", "mean", "sd", "ci95", "lo", "hi",
                 "meanRatio", "ratioCi95", "ratioLo", "ratioHi", "significant")

    def __init__(self, a: Sequence[float], b: Sequence[float], baseline: str = ""):
        if len(a) != len(b):
            raise ValueError(
                f"cannot pair {len(a)} replications against {len(b)} -- the two "
                f"batches must be the same length and run on the same seeds"
            )
        self.baseline = baseline
        n = len(a)
        self.n = n
        diffs = [x - y for x, y in zip(a, b)]
        ratios = [(x / y) for x, y in zip(a, b) if y > 0]
        self.mean, self.sd, self.ci95 = _mean_sd_ci(diffs)
        self.lo, self.hi = self.mean - self.ci95, self.mean + self.ci95
        self.meanRatio, _, self.ratioCi95 = _mean_sd_ci(ratios)
        self.ratioLo = self.meanRatio - self.ratioCi95
        self.ratioHi = self.meanRatio + self.ratioCi95
        # A difference is real when its interval excludes zero.
        self.significant = self.lo > 0.0 or self.hi < 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {k: getattr(self, k) for k in self.__slots__}


def _mean_sd_ci(values: Sequence[float]):
    n = len(values)
    if n == 0:
        return 0.0, 0.0, 0.0
    mean = sum(values) / n
    if n < 2:
        return mean, 0.0, 0.0
    var = sum((v - mean) ** 2 for v in values) / (n - 1)
    sd = var ** 0.5
    return mean, sd, 1.96 * sd / (n ** 0.5)
