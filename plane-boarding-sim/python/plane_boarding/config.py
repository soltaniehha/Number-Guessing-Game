"""Configuration loading, layering and validation.

The defaults live in `parity/defaults.json` and are loaded at runtime -- never
duplicated in code -- because the JavaScript engine loads the *same file*. A
constant copied into two languages is a parity bug waiting to happen.

Three layers, applied in this order:

    parity/defaults.json  ->  aircraft.defaultConfig  ->  user overrides

The middle layer exists because a few parameters are properties of the airframe
and its operator rather than of the simulation: an E175's bag mix is genuinely
different from an A320's, because the airline valet-checks most roll-aboards at
the jetbridge before anyone steps aboard.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Dict, Mapping, Optional, Tuple

_HERE = Path(__file__).resolve()
PARITY_DIR = _HERE.parents[2] / "parity"
DEFAULTS_PATH = PARITY_DIR / "defaults.json"

_DEFAULTS_CACHE: Optional[Dict[str, Any]] = None


def load_defaults() -> Dict[str, Any]:
    """Read (and memoise) `parity/defaults.json`, stripping comment keys."""
    global _DEFAULTS_CACHE
    if _DEFAULTS_CACHE is None:
        with DEFAULTS_PATH.open("r", encoding="utf-8") as fh:
            raw = json.load(fh)
        _DEFAULTS_CACHE = raw
    return _DEFAULTS_CACHE


def _strip_comments(d: Mapping[str, Any]) -> Dict[str, Any]:
    """Drop `_`-prefixed documentation keys. They are for humans, not the engine."""
    return {k: v for k, v in d.items() if not k.startswith("_")}


CONSTANTS: Dict[str, float] = dict(load_defaults()["_constants"])

BODY_DEPTH: float = CONSTANTS["BODY_DEPTH"]
DESIRED_HEADWAY: float = CONSTANTS["DESIRED_HEADWAY"]
MIN_SPEED_FRACTION: float = CONSTANTS["MIN_SPEED_FRACTION"]
INCH: float = CONSTANTS["INCH"]
MAX_SIM_SECONDS: float = CONSTANTS["MAX_SIM_SECONDS"]

#: PCG32 stream layout (ENGINE_SPEC 1.3). Loaded rather than hard-coded so the
#: two engines cannot drift on a stream index.
PAX_STREAM: int = int(CONSTANTS["PAX_STREAM"])
ORDER_STREAM: int = int(CONSTANTS["ORDER_STREAM"])
DOOR_STREAM_BASE: int = int(CONSTANTS["DOOR_STREAM_BASE"])
SERVICE_STREAM_BASE: int = int(CONSTANTS["SERVICE_STREAM_BASE"])
SERVICE_STREAM_STRIDE: int = int(CONSTANTS["SERVICE_STREAM_STRIDE"])

#: Phase offsets within a passenger's service sub-stream block. Each phase is a
#: separate stream so that a phase whose draw COUNT depends on the boarding
#: order (bin search, shuffle movements) cannot shift the phases either side of
#: it. See ENGINE_SPEC 1.3.
SERVICE_PHASE_STOW = 0
SERVICE_PHASE_BIN = 1
SERVICE_PHASE_SHUFFLE = 2
SERVICE_PHASE_BEHAVIOUR = 3

DOOR_ASSIGNMENTS = ("single", "split_by_row", "split_by_aisle")
OPEN_SEATING_POLICIES = ("aisle_first", "window_first", "front_first", "avoid_neighbours")

#: Passenger states, shared with the replay format and the web renderer.
QUEUED, WALKING, STOWING, SHUFFLING, SEATED = 0, 1, 2, 3, 4


class ConfigError(ValueError):
    """Raised for a scenario that cannot physically be simulated."""


def _numeric_weight_map(raw: Mapping[str, Any], name: str) -> Tuple[Tuple[int, ...], Tuple[float, ...]]:
    """Turn `{"0": w, "1": w}` into parallel key/weight tuples sorted by key.

    Numeric ordering (not JSON insertion order) is the canonical order for
    integer-keyed maps, so Python and JS agree without relying on either
    language's dict-ordering rules.
    """
    try:
        keys = sorted(int(k) for k in raw)
    except (TypeError, ValueError) as exc:
        raise ConfigError(f"{name}: keys must be integers, got {list(raw)!r}") from exc
    weights = [float(raw[str(k)]) if str(k) in raw else float(raw[k]) for k in keys]
    if not keys:
        raise ConfigError(f"{name}: must not be empty")
    if any(w < 0 for w in weights):
        raise ConfigError(f"{name}: weights must be non-negative")
    if sum(weights) <= 0:
        raise ConfigError(f"{name}: weights must not all be zero")
    return tuple(keys), tuple(weights)


def _string_weight_map(raw: Mapping[str, Any], name: str) -> Tuple[Tuple[str, ...], Tuple[float, ...]]:
    """String-keyed weights keep JSON insertion order, which both languages preserve."""
    keys = tuple(str(k) for k in raw)
    weights = tuple(float(raw[k]) for k in raw)
    if not keys:
        raise ConfigError(f"{name}: must not be empty")
    if sum(weights) <= 0:
        raise ConfigError(f"{name}: weights must not all be zero")
    return keys, weights


class SimConfig:
    """A fully resolved scenario. Immutable in practice; treat it as read-only.

    Attributes are plain floats/ints rather than a nested dict because the
    engine's inner loop touches them tens of thousands of times per run.
    """

    __slots__ = (
        "aircraftId", "strategy", "seed", "loadFactor", "doors", "doorAssignment",
        "bagKeys", "bagWeights", "partyKeys", "partyWeights",
        "walkSpeedMean", "walkSpeedSd",
        "preboardRate", "slowPaxRate", "slowSpeedFactor", "slowStowFactor", "childRate",
        "eliteKeys", "eliteWeights", "eliteForwardBias",
        "stowWeibullShape", "stowWeibullScale", "stowVariability",
        "shuffleMoveMin", "shuffleMoveMode", "shuffleMoveMax",
        "shuffleMovements", "shuffleSamePartyMovements",
        "stowPassSpeedFactor", "doorArrivalMean",
        "binBagsPerRowSide", "binSearchRadius", "binSearchPenalty",
        "gateCheckPenalty", "binCongestionWeight",
        "zoneCount", "keepPartiesTogether", "preboardFirst",
        "nonComplianceRate", "complianceJitter", "lateRate", "openSeatingPolicy",
        "dt", "sampleInterval", "raw",
    )

    def __init__(self, resolved: Mapping[str, Any]):
        r = resolved
        self.raw: Dict[str, Any] = dict(r)

        self.aircraftId = str(r["aircraftId"])
        self.strategy = str(r["strategy"])
        self.seed = int(r["seed"])
        self.loadFactor = float(r["loadFactor"])
        doors = r.get("doors")
        self.doors: Optional[Tuple[str, ...]] = tuple(doors) if doors is not None else None
        self.doorAssignment = str(r["doorAssignment"])

        self.bagKeys, self.bagWeights = _numeric_weight_map(r["bagWeights"], "bagWeights")
        self.partyKeys, self.partyWeights = _numeric_weight_map(r["partySizeWeights"], "partySizeWeights")
        self.eliteKeys, self.eliteWeights = _string_weight_map(r["eliteMix"], "eliteMix")
        self.eliteForwardBias = float(r["eliteForwardBias"])

        self.walkSpeedMean = float(r["walkSpeedMean"])
        self.walkSpeedSd = float(r["walkSpeedSd"])
        self.preboardRate = float(r["preboardRate"])
        self.slowPaxRate = float(r["slowPaxRate"])
        self.slowSpeedFactor = float(r["slowSpeedFactor"])
        self.slowStowFactor = float(r["slowStowFactor"])
        self.childRate = float(r["childRate"])

        self.stowWeibullShape = float(r["stowWeibullShape"])
        self.stowWeibullScale = float(r["stowWeibullScale"])
        self.stowVariability = float(r["stowVariability"])

        self.shuffleMoveMin = float(r["shuffleMoveMin"])
        self.shuffleMoveMode = float(r["shuffleMoveMode"])
        self.shuffleMoveMax = float(r["shuffleMoveMax"])
        mv = r["shuffleMovements"]
        self.shuffleMovements = {
            "none": int(mv["none"]), "aisle": int(mv["aisle"]),
            "middle": int(mv["middle"]), "both": int(mv["both"]),
        }
        self.shuffleSamePartyMovements = int(r["shuffleSamePartyMovements"])

        self.stowPassSpeedFactor = float(r["stowPassSpeedFactor"])
        self.doorArrivalMean = float(r["doorArrivalMean"])

        bb = r.get("binBagsPerRowSide")
        self.binBagsPerRowSide: Optional[int] = None if bb is None else int(bb)
        self.binSearchRadius = int(r["binSearchRadius"])
        self.binSearchPenalty = float(r["binSearchPenalty"])
        self.gateCheckPenalty = float(r["gateCheckPenalty"])
        self.binCongestionWeight = float(r["binCongestionWeight"])

        self.zoneCount = int(r["zoneCount"])
        self.keepPartiesTogether = bool(r["keepPartiesTogether"])
        self.preboardFirst = bool(r["preboardFirst"])
        self.nonComplianceRate = float(r["nonComplianceRate"])
        self.complianceJitter = int(r["complianceJitter"])
        self.lateRate = float(r["lateRate"])
        self.openSeatingPolicy = str(r["openSeatingPolicy"])

        self.dt = float(r["dt"])
        self.sampleInterval = float(r["sampleInterval"])

        self._validate()

    # -- validation ---------------------------------------------------------

    def _validate(self) -> None:
        if not 0.0 <= self.loadFactor <= 1.0:
            raise ConfigError(f"loadFactor must be in [0, 1], got {self.loadFactor}")
        if self.doorAssignment not in DOOR_ASSIGNMENTS:
            raise ConfigError(
                f"doorAssignment must be one of {DOOR_ASSIGNMENTS}, got {self.doorAssignment!r}"
            )
        if self.openSeatingPolicy not in OPEN_SEATING_POLICIES:
            raise ConfigError(
                f"openSeatingPolicy must be one of {OPEN_SEATING_POLICIES}, "
                f"got {self.openSeatingPolicy!r}"
            )
        if self.dt <= 0:
            raise ConfigError(f"dt must be positive, got {self.dt}")
        if self.sampleInterval <= 0:
            raise ConfigError(f"sampleInterval must be positive, got {self.sampleInterval}")
        if self.zoneCount < 1:
            raise ConfigError(f"zoneCount must be >= 1, got {self.zoneCount}")
        if self.walkSpeedMean <= 0:
            raise ConfigError(f"walkSpeedMean must be positive, got {self.walkSpeedMean}")
        if self.walkSpeedSd < 0:
            raise ConfigError(f"walkSpeedSd must be non-negative, got {self.walkSpeedSd}")
        if not (self.shuffleMoveMin <= self.shuffleMoveMode <= self.shuffleMoveMax):
            raise ConfigError(
                "shuffle movement triangular must satisfy min <= mode <= max, got "
                f"({self.shuffleMoveMin}, {self.shuffleMoveMode}, {self.shuffleMoveMax})"
            )
        if not 0.0 <= self.stowPassSpeedFactor <= 1.0:
            raise ConfigError(
                "stowPassSpeedFactor must be in [0, 1] -- it is a fraction of walk "
                f"speed, got {self.stowPassSpeedFactor}"
            )
        if self.doorArrivalMean < 0:
            raise ConfigError(f"doorArrivalMean must be non-negative, got {self.doorArrivalMean}")
        if self.binSearchRadius < 0:
            raise ConfigError(f"binSearchRadius must be non-negative, got {self.binSearchRadius}")
        if self.binBagsPerRowSide is not None and self.binBagsPerRowSide < 0:
            raise ConfigError("binBagsPerRowSide must be non-negative")
        for name in ("preboardRate", "slowPaxRate", "childRate", "nonComplianceRate", "lateRate"):
            v = getattr(self, name)
            if not 0.0 <= v <= 1.0:
                raise ConfigError(f"{name} must be a probability in [0, 1], got {v}")
        if self.complianceJitter < 0:
            raise ConfigError("complianceJitter must be non-negative")
        if not 0.0 <= self.eliteForwardBias <= 1.0:
            raise ConfigError(
                "eliteForwardBias must be in [0, 1] -- it is a linear tilt on the "
                f"eliteMix weights and 1.0 already zeroes the rearmost row, got "
                f"{self.eliteForwardBias}"
            )
        for k in ("none", "aisle", "middle", "both"):
            if self.shuffleMovements[k] < 0:
                raise ConfigError(f"shuffleMovements[{k}] must be non-negative")

    # -- convenience --------------------------------------------------------

    def replace(self, **overrides: Any) -> "SimConfig":
        """Return a copy with `overrides` applied. Used heavily by sweeps."""
        merged = dict(self.raw)
        merged.update(overrides)
        return SimConfig(merged)

    def to_dict(self) -> Dict[str, Any]:
        return dict(self.raw)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return (
            f"SimConfig(aircraft={self.aircraftId!r}, strategy={self.strategy!r}, "
            f"seed={self.seed}, loadFactor={self.loadFactor})"
        )


def build_config(
    aircraft_defaults: Optional[Mapping[str, Any]] = None,
    overrides: Optional[Mapping[str, Any]] = None,
) -> SimConfig:
    """Layer defaults -> aircraft defaults -> user overrides into a `SimConfig`.

    `aircraftId`, `strategy` and `seed` have no entry in defaults.json (they are
    scenario identity, not calibration), so they get pragmatic fallbacks here.
    """
    resolved: Dict[str, Any] = {
        "aircraftId": "a320neo",
        "strategy": "random",
        "seed": 1,
        "doors": None,
    }
    resolved.update(_strip_comments(load_defaults()))
    resolved.pop("_constants", None)
    if aircraft_defaults:
        resolved.update(_strip_comments(aircraft_defaults))
    if overrides:
        unknown = set(overrides) - set(resolved)
        if unknown:
            raise ConfigError(f"unknown config keys: {sorted(unknown)}")
        resolved.update(overrides)
    return SimConfig(resolved)


def expected_bags_per_pax(cfg: SimConfig) -> float:
    """Mean overhead-bin pieces per passenger. Reported by the CLI because it is
    the single parameter that most moves absolute boarding time."""
    total = sum(cfg.bagWeights)
    return sum(k * w for k, w in zip(cfg.bagKeys, cfg.bagWeights)) / total


def ticks_for(duration: float, dt: float) -> int:
    """Number of whole `dt` steps a service time occupies.

    Integer tick arithmetic (rather than accumulating floats) is what keeps the
    two implementations from drifting apart over a 10,000-step run.
    """
    if duration <= 0:
        return 0
    return int(math.ceil(duration / dt - 1e-9))
