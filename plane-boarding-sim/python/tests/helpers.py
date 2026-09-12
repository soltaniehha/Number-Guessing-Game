"""Shared scaffolding for the test suite."""

from __future__ import annotations

from typing import Any, Dict

from plane_boarding.aircraft import get_aircraft
from plane_boarding.config import build_config, SimConfig
from plane_boarding.passengers import generate
from plane_boarding.rng import PCG32
from plane_boarding.strategies import build_order

#: A scenario stripped of every source of ordering noise. Used wherever a test
#: needs to assert a property of the *strategy itself* rather than of the
#: post-processing that deliberately corrupts it.
CLEAN = {
    "partySizeWeights": {"1": 1.0},
    "keepPartiesTogether": False,
    "nonComplianceRate": 0.0,
    "lateRate": 0.0,
    "preboardRate": 0.0,
    "preboardFirst": False,
    "slowPaxRate": 0.0,
}


def cfg_for(aircraft: str = "a320neo", strategy: str = "random", seed: int = 1,
            use_aircraft_defaults: bool = True, **overrides: Any) -> SimConfig:
    ac = get_aircraft(aircraft)
    base: Dict[str, Any] = {"aircraftId": aircraft, "strategy": strategy, "seed": seed}
    base.update(overrides)
    return build_config(ac.defaultConfig if use_aircraft_defaults else None, base)


def clean_cfg(aircraft: str = "a320neo", strategy: str = "random", seed: int = 1,
              **overrides: Any) -> SimConfig:
    merged = dict(CLEAN)
    merged.update(overrides)
    return cfg_for(aircraft, strategy, seed, **merged)


def make_queue(cfg: SimConfig):
    """Reproduce the engine's manifest + ordering without running the simulation."""
    ac = get_aircraft(cfg.aircraftId)
    pax = generate(PCG32(cfg.seed, 1), ac, cfg)
    return ac, build_order(pax, ac, cfg, PCG32(cfg.seed, 2))
