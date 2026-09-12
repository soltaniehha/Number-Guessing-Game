#!/usr/bin/env python3
"""Emit COMPLETE `RunResult` documents for the full scenario matrix, from the
PYTHON engine.

`parity/emit_full_js.mjs` must be a direct mirror of this file. Keep the two
structurally identical -- same helper names, same matrix, same order -- so that
a reviewer can diff them by eye.

Where `emit_py.py` emits a *digest* -- a hash of a summary, which catches gross
divergence but can pass while per-passenger records differ -- this emits
everything: every per-passenger record, the seated curve, the aisle-occupancy
curve, the congestion matrix, the door stats. That is the comparison that
actually proved the port, and `parity/compare.py --full` is what re-runs it.

Output is NDJSON -- one `{"name": ..., "result": {...}}` object per line -- so
the comparator can diff one scenario at a time and drop it, instead of holding
384 complete results in memory on each side.

    python3 parity/emit_full_py.py             # NDJSON on stdout
    python3 parity/emit_full_py.py --list      # scenario names only
    python3 parity/emit_full_py.py --only NAME
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, Iterator, List, Sequence

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "python"))

from plane_boarding.aircraft import aircraft_ids, get_aircraft   # noqa: E402
from plane_boarding.config import build_config                   # noqa: E402
from plane_boarding.engine import simulate                       # noqa: E402
from plane_boarding.strategies import STRATEGIES                 # noqa: E402

#: The four scenario shapes each (aircraft, strategy) pair is run through.
#: Chosen to cover the axes that change the CODE PATH rather than just the
#: numbers: one door against the aircraft's own door set, both door-assignment
#: policies, a full cabin and a light one, and the cabin-wide zone fallback.
CONFIGS: List[Dict[str, Any]] = [
    {"_name": "default"},
    {"_name": "single_door", "doorAssignment": "single", "_one_door": True},
    {"_name": "full_split_by_aisle", "loadFactor": 1.0,
     "doorAssignment": "split_by_aisle"},
    {"_name": "light_cabinwide_zones", "loadFactor": 0.55,
     "doorAwareZones": False, "openSeatingPolicy": "window_first", "dt": 0.25},
]


def scenarios() -> Iterator[Dict[str, Any]]:
    """16 strategies x 6 aircraft x 4 configs = 384, in a fixed order.

    The seed is a function of the position in the matrix rather than a constant,
    so the sweep covers 384 different passenger manifests instead of 24.
    """
    n = 0
    for aid in aircraft_ids():
        ac = get_aircraft(aid)
        one_door = [d.id for d in ac.boardable_doors()][:1]
        for strategy in STRATEGIES:
            for shape in CONFIGS:
                cfg = {k: v for k, v in shape.items() if not k.startswith("_")}
                if shape.get("_one_door"):
                    cfg["doors"] = list(one_door)
                cfg.update({"aircraftId": aid, "strategy": strategy, "seed": 1000 + n})
                yield {"name": f"{aid}|{strategy}|{shape['_name']}", "config": cfg}
                n += 1


def result_for(scenario: Dict[str, Any]) -> Dict[str, Any]:
    cfg_in = scenario["config"]
    ac = get_aircraft(cfg_in["aircraftId"])
    cfg = build_config(ac.defaultConfig, cfg_in)
    return simulate(cfg, ac).to_dict(per_passenger=True)


def main(argv: Sequence[str] = ()) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--list", action="store_true", help="print scenario names and exit")
    ap.add_argument("--only", default=None, help="emit a single scenario by name")
    args = ap.parse_args(list(argv) or None)

    out = sys.stdout
    for scenario in scenarios():
        if args.list:
            out.write(scenario["name"] + "\n")
            continue
        if args.only and scenario["name"] != args.only:
            continue
        out.write(json.dumps(
            {"name": scenario["name"], "config": scenario["config"],
             "result": result_for(scenario)},
            sort_keys=True, separators=(",", ":")) + "\n")
        out.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
