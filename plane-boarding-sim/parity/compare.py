#!/usr/bin/env python3
"""Cross-language parity harness.

Runs every fixture in `fixtures.json` through BOTH the Python engine and the
JS engine, then diffs the canonical digests. Exits non-zero on any mismatch.

    python3 parity/compare.py            # the fast gate: RNG vectors + digests
    python3 parity/compare.py --rng      # RNG vectors only (fastest)
    python3 parity/compare.py --full     # ...and the 384-scenario exact diff

**What the default gate does and does not prove.** The digest is a hash of a
SUMMARY -- totals, the time breakdown, interference counts, gate checks, bin
searches, block events, a 10 s-grid seated curve, the first 20 sit times and the
geometry fingerprint. It catches gross divergence and it runs in seconds, which
is why it is the gate. It can also pass while individual per-passenger records
differ, and those differences are exactly what later turns into a wrong chart.

`--full` is the check that actually proved the port: 16 strategies x 6 aircraft
x 4 configurations = 384 scenarios, comparing COMPLETE `RunResult` documents
field by field -- every per-passenger record, both curves, the congestion
matrix, the door statistics -- with no tolerance at all. It takes a few minutes.
Run it before any release and after any change to the engine.
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


def exact(a, b):
    """Bit-for-bit, with no tolerance.

    `int` and `float` still compare numerically, because the two languages
    disagree only about how they SPELL an integral value -- Python writes `0.0`
    where JavaScript writes `0` -- and that is a JSON serialisation difference,
    not an engine one. Everything else must be identical.
    """
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b or a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    return a == b


def diff(a, b, path="", eq=close):
    """Yield human-readable difference paths between two JSON structures."""
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                yield f"{path}.{k}: missing in python"
            elif k not in b:
                yield f"{path}.{k}: missing in js"
            else:
                yield from diff(a[k], b[k], f"{path}.{k}", eq)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            yield f"{path}: length {len(a)} (py) != {len(b)} (js)"
        for i, (x, y) in enumerate(zip(a, b)):
            yield from diff(x, y, f"{path}[{i}]", eq)
    elif not eq(a, b):
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


def _stream(cmd, cwd):
    """Run an NDJSON emitter and yield its scenarios one at a time.

    Streamed rather than collected because 384 complete `RunResult` documents
    are tens of megabytes per side, and holding both in memory to compare them
    is the one part of this that does not need to scale.
    """
    proc = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, bufsize=1)
    for line in proc.stdout:
        line = line.strip()
        if line:
            yield json.loads(line)
    proc.stdout.close()
    err = proc.stderr.read()
    proc.stderr.close()
    if proc.wait() != 0:
        print(f"{RED}command failed:{RESET} {' '.join(cmd)}\n{err}", file=sys.stderr)
        sys.exit(2)


def full_section():
    """The 384-scenario exact-equality diff over COMPLETE RunResults.

    No tolerance: the two engines are required to be bit-identical, and a
    tolerance here would quietly permit exactly the drift this exists to catch.
    """
    py = _stream(["python3", "parity/emit_full_py.py"], ROOT)
    js = _stream(["node", "parity/emit_full_js.mjs"], ROOT)
    n = 0
    bad = 0
    shown = 0
    for a, b in zip(py, js):
        n += 1
        if a["name"] != b["name"]:
            print(f"{RED}FAIL{RESET}  full: scenario {n} is {a['name']!r} (py) "
                  f"but {b['name']!r} (js) -- the two matrices have diverged")
            return False
        diffs = list(diff(a["result"], b["result"], a["name"], exact))
        if diffs:
            bad += 1
            if shown < 5:
                shown += 1
                print(f"{RED}FAIL{RESET}  {a['name']}  ({len(diffs)} difference(s))")
                for d in diffs[:10]:
                    print(f"        {d}")
                if len(diffs) > 10:
                    print(f"        {DIM}... and {len(diffs) - 10} more{RESET}")
        elif n % 32 == 0:
            print(f"{DIM}      {n} scenarios identical so far...{RESET}")
    leftover = sum(1 for _ in py) + sum(1 for _ in js)
    if leftover:
        print(f"{RED}FAIL{RESET}  full: the two emitters produced different scenario counts")
        return False
    if bad:
        print(f"{RED}FAIL{RESET}  full  ({bad} of {n} scenarios differ)")
        return False
    print(f"{GREEN}PASS{RESET}  full  {DIM}({n} scenarios, complete RunResults "
          f"identical field for field){RESET}")
    return True


def main():
    only_rng = "--rng" in sys.argv
    want_full = "--full" in sys.argv
    print(f"\n{'=' * 62}\n Cross-language parity: Python engine  vs  JavaScript engine\n{'=' * 62}")
    ok = section("rng", ["python3", "parity/rng_vectors.py"], ["node", "parity/rng_vectors.mjs"])
    if not only_rng:
        ok &= section("engine", ["python3", "parity/emit_py.py"], ["node", "parity/emit_js.mjs"])
    if want_full:
        print(f"{DIM}      running the 384-scenario exact diff; this takes a few "
              f"minutes{RESET}")
        ok &= full_section()
    print("=" * 62)
    if ok:
        print(f"{GREEN}All parity checks passed.{RESET} Both engines are behaviourally identical.\n")
    else:
        print(f"{RED}Parity broken.{RESET} The two engines disagree -- fix before shipping.\n")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
