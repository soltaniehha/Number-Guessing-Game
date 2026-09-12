#!/usr/bin/env python3
"""Cross-language parity harness.

Runs every fixture in `fixtures.json` through BOTH the Python engine and the
JS engine, then diffs the canonical digests. Exits non-zero on any mismatch.

    python3 parity/compare.py            # full run
    python3 parity/compare.py --rng      # RNG vectors only (fast)
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TOL = 1e-6

GREEN, RED, YELLOW, DIM, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


def close(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= TOL * max(1.0, abs(a), abs(b))
    return a == b


def diff(a, b, path=""):
    """Yield human-readable difference paths between two JSON structures."""
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                yield f"{path}.{k}: missing in python"
            elif k not in b:
                yield f"{path}.{k}: missing in js"
            else:
                yield from diff(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            yield f"{path}: length {len(a)} (py) != {len(b)} (js)"
        for i, (x, y) in enumerate(zip(a, b)):
            yield from diff(x, y, f"{path}[{i}]")
    elif not close(a, b):
        yield f"{path}: {a!r} (py) != {b!r} (js)"


def run(cmd, cwd):
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"{RED}command failed:{RESET} {' '.join(cmd)}\n{proc.stderr}", file=sys.stderr)
        sys.exit(2)
    return json.loads(proc.stdout)


def section(name, py_cmd, js_cmd):
    py = run(py_cmd, ROOT)
    js = run(js_cmd, ROOT)
    diffs = list(diff(py, js, name))
    if diffs:
        print(f"{RED}FAIL{RESET}  {name}  ({len(diffs)} difference(s))")
        for d in diffs[:25]:
            print(f"        {d}")
        if len(diffs) > 25:
            print(f"        {DIM}... and {len(diffs) - 25} more{RESET}")
        return False
    keys = len(py) if isinstance(py, dict) else len(py)
    print(f"{GREEN}PASS{RESET}  {name}  {DIM}({keys} entries identical){RESET}")
    return True


def main():
    only_rng = "--rng" in sys.argv
    print(f"\n{'=' * 62}\n Cross-language parity: Python engine  vs  JavaScript engine\n{'=' * 62}")
    ok = section("rng", ["python3", "parity/rng_vectors.py"], ["node", "parity/rng_vectors.mjs"])
    if not only_rng:
        ok &= section("engine", ["python3", "parity/emit_py.py"], ["node", "parity/emit_js.mjs"])
    print("=" * 62)
    if ok:
        print(f"{GREEN}All parity checks passed.{RESET} Both engines are behaviourally identical.\n")
    else:
        print(f"{RED}Parity broken.{RESET} The two engines disagree -- fix before shipping.\n")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
