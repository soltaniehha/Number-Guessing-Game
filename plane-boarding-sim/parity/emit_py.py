#!/usr/bin/env python3
"""Emit the canonical parity digest for every fixture, from the PYTHON engine.

`parity/emit_js.mjs` must be a direct mirror of this file and produce
byte-comparable output. Keep the two structurally identical -- same helper
names, same order of operations -- so that a reviewer can diff them by eye.

    python3 parity/emit_py.py            # digest JSON on stdout
    python3 parity/emit_py.py --list     # fixture names only

Digest contract (ENGINE_SPEC 9): keys sorted, every float rounded to 9 decimal
places. Rounding is what makes the comparison meaningful -- IEEE doubles agree
between the two languages to far better than 1e-9 for these quantities, but
their shortest-repr printing does not, so we round before serialising rather
than relying on the differ's tolerance.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from typing import Any, Dict, List, Sequence

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "python"))

from plane_boarding.aircraft import geometry_payload, get_aircraft  # noqa: E402
from plane_boarding.config import build_config              # noqa: E402
from plane_boarding.engine import simulate                  # noqa: E402

FIXTURES_PATH = os.path.join(HERE, "fixtures.json")

#: Curve resample step, in seconds. Fixed at 10 s so the digest does not depend
#: on `sampleInterval`, which is a presentation setting rather than physics.
CURVE_STEP = 10.0
ROUND_DP = 9


def fnv1a32(text: str) -> str:
    """32-bit FNV-1a over UTF-8. Chosen because it is four lines in any language
    and needs no crypto library on either side of the parity harness."""
    h = 0x811C9DC5
    for byte in text.encode("utf-8"):
        h ^= byte
        h = (h * 0x01000193) & 0xFFFFFFFF
    return format(h, "08x")


def canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def r9(value: float) -> float:
    """Round to 9 dp, normalising -0.0 to 0.0 so the two languages print alike."""
    out = round(float(value), ROUND_DP)
    return 0.0 if out == 0 else out


def f6(value: float) -> str:
    """A 6-dp float as fixed-point text, with -0.0 normalised to 0.0.

    Fixed-point rather than the language's own float repr, because Python
    prints an integral float as `1.0` and JavaScript prints it as `1`. Every
    value fed to this has already been through `round(x, 6)`, so it sits within
    an ulp of a 6-dp decimal and both `%.6f` and `Number.toFixed(6)` recover
    that decimal exactly -- there is no tie for their differing tie rules to
    disagree about.
    """
    return "%.6f" % (value + 0.0)


def i(value: int) -> str:
    return str(int(value))


def geometry_fingerprint(ac: Any) -> str:
    """Hash every ROUNDED value in `geometry_payload`, plus the identifiers that
    give them meaning.

    The digest covers the simulation but used to stop at the cabin door: nothing
    in it depended on the geometry payload, so a rounding disagreement between
    `round(x, 6)` and a hand-rolled `Math.round(v * 1e6) / 1e6` could ship
    undetected until an airframe's pitch happened to land on a tie. It is a hash
    rather than a list of numbers because the differ compares numerically with a
    1e-6 tolerance, which is precisely the size of the disagreement being looked
    for -- an exact string hash is the only thing that can see it.
    """
    g = geometry_payload(ac)
    parts: List[str] = [
        g["id"], i(g["aisleCount"]), i(g["seatCount"]), i(g["maxDepth"]),
        f6(g["lengthM"]), i(g["binBagsPerRowSide"]),
    ]
    for r in g["rows"]:
        parts += [i(r["slot"]), i(r["number"]), f6(r["x"]), f6(r["pitch"])]
    for s in g["seats"]:
        parts += [i(s["index"]), s["id"], f6(s["x"]), i(s["rowSlot"]), i(s["aisle"]),
                  i(s["depth"]), i(s["blockId"]), i(s["binRun"])]
    for d in g["doors"]:
        parts += [d["id"], f6(d["x"]), i(d["aisle"])]
    return fnv1a32("|".join(parts))


def seated_curve(sit_times: Sequence[float], total: float) -> List[List[float]]:
    """Cumulative seated count on a fixed 10 s grid, computed from the sit times
    themselves rather than from the engine's sampled curve -- the sampling
    interval is a config knob and must not leak into the parity contract."""
    ordered = sorted(sit_times)
    steps = int(math.floor(total / CURVE_STEP + 1e-9)) + 1
    out: List[List[float]] = []
    idx = 0
    for k in range(steps + 1):
        t = k * CURVE_STEP
        while idx < len(ordered) and ordered[idx] <= t + 1e-9:
            idx += 1
        out.append([r9(t), idx])
    return out


def digest_for(fixture: Dict[str, Any]) -> Dict[str, Any]:
    cfg_in = fixture["config"]
    ac = get_aircraft(cfg_in["aircraftId"])
    cfg = build_config(ac.defaultConfig, cfg_in)
    result = simulate(cfg, ac)
    sits = [p.sitTime for p in result.perPassenger]
    return {
        "config_hash": fnv1a32(canonical(cfg_in)),
        "geometry_hash": geometry_fingerprint(ac),
        "totalSeconds": r9(result.totalSeconds),
        "paxCount": result.paxCount,
        "seatCount": result.seatCount,
        "doors": list(result.doors),
        "timeBreakdown": {k: r9(v) for k, v in sorted(result.timeBreakdown.items())},
        "interference": {k: int(v) for k, v in sorted(result.interference.items())},
        "gateChecks": result.gateChecks,
        "binSearches": result.binSearches,
        "aisleBlockEvents": result.aisleBlockEvents,
        "seatedCurve": seated_curve(sits, result.totalSeconds),
        "first20SitTimes": [r9(t) for t in sits[:20]],
    }


def main(argv: Sequence[str] = ()) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--list", action="store_true", help="print fixture names and exit")
    ap.add_argument("--only", default=None, help="emit a single fixture by name")
    ap.add_argument("--indent", type=int, default=None)
    args = ap.parse_args(list(argv) or None)

    with open(FIXTURES_PATH, "r", encoding="utf-8") as fh:
        fixtures = json.load(fh)["fixtures"]

    if args.list:
        for f in fixtures:
            print(f["name"])
        return 0

    out: Dict[str, Any] = {}
    for f in fixtures:
        if args.only and f["name"] != args.only:
            continue
        out[f["name"]] = digest_for(f)
    print(json.dumps(out, sort_keys=True, indent=args.indent))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
