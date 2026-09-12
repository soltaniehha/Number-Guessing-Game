"""Aircraft geometry resolution.

Reads the declarative roster in `parity/aircraft.json` and turns it into the
numbers the engine actually needs: where every row sits in metres, which aisle
serves each seat, how many bodies a passenger must climb over to reach it, and
where the doors are.

Two ideas do most of the work here:

**Row slots vs row numbers.** The number printed on a boarding pass is not a
coordinate. Airlines skip 13 out of superstition and renumber freely between
cabins. So the geometry is indexed by a contiguous *row slot*, and skipped
numbers cost no cabin length. A galley or lavatory bank is a different animal --
that is real metres of aisle with no seats in it -- and is declared separately
as a `monument`.

**Seat depth.** How blocked a seat is, measured as the number of seats you cross
to reach it from its serving aisle, counting itself. Aisle seat = 1, middle = 2,
window = 3. This single integer drives WilMA, Steffen, the reverse pyramid and
the whole seat-shuffle model, and it is why an asymmetric 2-3 cabin behaves
differently on its two sides.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from .config import INCH, PARITY_DIR, ConfigError

AIRCRAFT_PATH = PARITY_DIR / "aircraft.json"

AISLE = "|"

#: Seat "kind" as a passenger would describe it. Distinct from `depth`, which is
#: a geometric fact: in a 1-2-1 business cabin the A seat is both a window and an
#: aisle seat (depth 1), and the label has to say "Window" while the physics uses 1.
WINDOW, MIDDLE, AISLE_SEAT = "Window", "Middle", "Aisle"


class Seat:
    """One physical seat, with everything the engine needs precomputed."""

    __slots__ = (
        "index", "rowNumber", "letter", "id", "cabinId", "classKey",
        "rowSlot", "x", "aisleIndex", "depth", "blockId", "binRun",
        "kind", "layoutPos", "lateral", "isExitRow",
    )

    def __init__(self, **kw: Any):
        for k, v in kw.items():
            setattr(self, k, v)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Seat {self.id} depth={self.depth} aisle={self.aisleIndex} x={self.x:.2f}>"


class Door:
    """A boarding door, resolved to a longitudinal position."""

    __slots__ = ("id", "name", "x", "aisleIndex", "kind", "boardable", "defaultEnabled", "rowBefore")

    def __init__(self, **kw: Any):
        for k, v in kw.items():
            setattr(self, k, v)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Door {self.id} x={self.x:.2f} aisle={self.aisleIndex}>"


class RowSlot:
    """A contiguous physical row position. `number` is what is printed on the seat."""

    __slots__ = ("slot", "number", "x", "pitch", "cabinId", "binCaps")

    def __init__(self, **kw: Any):
        for k, v in kw.items():
            setattr(self, k, v)


class Aircraft:
    """Fully resolved geometry. Built once per aircraft id and cached."""

    __slots__ = (
        "id", "name", "manufacturer", "description", "aisleCount", "seatPitchIn",
        "binBagsPerRowSide", "defaultConfig", "cabins", "seats", "doors",
        "rowSlots", "seatCount", "maxDepth", "blockCount", "length",
        "seatByPos", "rowSlotByNumber", "economyRowSlots", "cabinById",
    )

    def __init__(self, **kw: Any):
        for k, v in kw.items():
            setattr(self, k, v)

    # -- queries used by strategies and the engine --------------------------

    def boardable_doors(self) -> List[Door]:
        return [d for d in self.doors if d.boardable]

    def default_doors(self) -> List[str]:
        return [d.id for d in self.doors if d.boardable and d.defaultEnabled]

    def resolve_doors(self, requested: Optional[Sequence[str]]) -> List[Door]:
        """Filter and order the enabled doors.

        Order follows the roster's declaration order, not the caller's, so the
        release order in the engine cannot depend on how a user happened to type
        the list.
        """
        boardable = {d.id: d for d in self.doors if d.boardable}
        if requested is None:
            ids = set(self.default_doors())
        else:
            ids = set(requested)
            unknown = ids - {d.id for d in self.doors}
            if unknown:
                raise ConfigError(
                    f"{self.id}: no such door(s): {sorted(unknown)}. "
                    f"Doors on this aircraft: {[d.id for d in self.doors]}"
                )
            not_boardable = ids - set(boardable)
            if not_boardable:
                raise ConfigError(
                    f"{self.id}: door(s) {sorted(not_boardable)} are not boarding doors "
                    f"(service doors and overwing exits cannot be used to board). "
                    f"Boardable doors: {sorted(boardable)}"
                )
        enabled = [d for d in self.doors if d.id in ids and d.boardable]
        if not enabled:
            raise ConfigError(
                f"{self.id}: no boarding doors enabled -- a boarding scenario needs at "
                f"least one. Boardable doors on this aircraft: {sorted(boardable)}"
            )
        return enabled

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Aircraft {self.id} seats={self.seatCount} aisles={self.aisleCount}>"


# ---------------------------------------------------------------------------
# Layout analysis
# ---------------------------------------------------------------------------

def _analyse_layout(layout: Sequence[str]) -> Dict[str, Dict[str, Any]]:
    """Work out, for every letter in a cabin layout, which aisle serves it, how
    deep it sits, which side-of-aisle block it belongs to and which overhead bin
    run it stows under.

    The rules (ENGINE_SPEC 2.1):
      * a seat is served by the aisle it is nearest to, counted in seats;
        ties go to the lower aisle index (matters for the middle seat of a
        3-3-3 centre block, which is equidistant from both aisles);
      * depth counts the seats from the serving aisle up to and including this
        one, so the aisle seat is 1;
      * a *block* is (serving aisle, side of it) -- this is the unit a passenger
        must climb across, and the unit the shuffle model reasons about;
      * a *bin run* is a maximal group of seats between two aisles (or an aisle
        and the fuselage) -- a 3-4-3 row has three of them, and they are what
        the overhead bins physically span.
    """
    aisle_positions = [i for i, s in enumerate(layout) if s == AISLE]
    if not aisle_positions:
        raise ConfigError(f"layout {list(layout)!r} has no '{AISLE}' aisle marker")

    # Everything below is keyed by seat LETTER, and `_resolve` looks the letter
    # up again per row to build the seats. A layout that repeats a letter would
    # therefore silently collapse two physically distinct positions onto one set
    # of geometry -- both "D" seats in a 3-3-3 would get the depth, block and bin
    # run of whichever came last, and the error would show up only as a boarding
    # time that is quietly wrong. Fail at load instead.
    seen: Dict[str, int] = {}
    for i, s in enumerate(layout):
        if s == AISLE:
            continue
        if s in seen:
            raise ConfigError(
                f"layout {list(layout)!r} repeats seat letter {s!r} at positions "
                f"{seen[s]} and {i}. Seat letters index this cabin's per-letter "
                f"geometry (aisle, depth, block, bin run), so they must be unique "
                f"within a layout."
            )
        seen[s] = i

    # Bin runs: maximal seat groups between aisle markers.
    runs: List[List[int]] = []
    current: List[int] = []
    for i, s in enumerate(layout):
        if s == AISLE:
            runs.append(current)
            current = []
        else:
            current.append(i)
    runs.append(current)

    run_of_pos: Dict[int, int] = {}
    for ri, run in enumerate(runs):
        for pos in run:
            run_of_pos[pos] = ri

    n_runs = len(runs)
    info: Dict[str, Dict[str, Any]] = {}
    block_keys: List[Tuple[int, int]] = []

    for pos, letter in enumerate(layout):
        if letter == AISLE:
            continue
        best_aisle = 0
        best_depth = 10 ** 9
        for ai, apos in enumerate(aisle_positions):
            lo, hi = (apos, pos) if apos < pos else (pos, apos)
            # Count real seats between the aisle marker and this seat, inclusive
            # of the seat: crossing another aisle marker is possible in theory,
            # but the nearest-aisle rule means it never wins.
            depth = sum(1 for j in range(lo, hi + 1) if layout[j] != AISLE)
            if depth < best_depth:
                best_depth, best_aisle = depth, ai
        side = 1 if pos > aisle_positions[best_aisle] else -1
        key = (best_aisle, side)
        if key not in block_keys:
            block_keys.append(key)
        run_index = run_of_pos[pos]
        run = runs[run_index]
        # Window = an outboard end of an outboard run, i.e. actually against the
        # fuselage. Everything else that is not an aisle seat is a middle.
        is_window = (run_index == 0 and pos == run[0]) or (
            run_index == n_runs - 1 and pos == run[-1]
        )
        if is_window:
            kind = WINDOW
        elif best_depth == 1:
            kind = AISLE_SEAT
        else:
            kind = MIDDLE
        info[letter] = {
            "aisleIndex": best_aisle,
            "depth": best_depth,
            "blockKey": key,
            "binRun": run_index,
            "kind": kind,
            "layoutPos": pos,
        }

    block_keys.sort(key=lambda k: min(
        v["layoutPos"] for v in info.values() if v["blockKey"] == k
    ))
    for v in info.values():
        v["blockId"] = block_keys.index(v["blockKey"])
    for v in info.values():
        v["runCount"] = n_runs
    return info


# ---------------------------------------------------------------------------
# Roster loading
# ---------------------------------------------------------------------------

_ROSTER_CACHE: Optional[Dict[str, Any]] = None
_RESOLVED_CACHE: Dict[str, Aircraft] = {}


def load_roster() -> Dict[str, Any]:
    global _ROSTER_CACHE
    if _ROSTER_CACHE is None:
        with AIRCRAFT_PATH.open("r", encoding="utf-8") as fh:
            _ROSTER_CACHE = json.load(fh)
    return _ROSTER_CACHE


def aircraft_ids() -> List[str]:
    return [a["id"] for a in load_roster()["aircraft"]]


def get_aircraft(aircraft_id: str) -> Aircraft:
    """Resolve (and cache) an aircraft's geometry."""
    if aircraft_id in _RESOLVED_CACHE:
        return _RESOLVED_CACHE[aircraft_id]
    for spec in load_roster()["aircraft"]:
        if spec["id"] == aircraft_id:
            ac = _resolve(spec)
            _RESOLVED_CACHE[aircraft_id] = ac
            return ac
    raise ConfigError(f"unknown aircraft {aircraft_id!r}; known: {aircraft_ids()}")


def _resolve(spec: Mapping[str, Any]) -> Aircraft:
    cabins = spec["cabins"]
    monuments = {int(m["afterRow"]): float(m["lengthM"]) for m in spec.get("monuments", [])}

    # --- row slots, fore to aft, in declared cabin order --------------------
    row_slots: List[RowSlot] = []
    seen_numbers = set()
    x = 0.0
    for cabin in cabins:
        pitch = float(cabin["pitchIn"]) * INCH
        for number in cabin["rows"]:
            number = int(number)
            if number in seen_numbers:
                raise ConfigError(f"{spec['id']}: row number {number} declared twice")
            seen_numbers.add(number)
            row_slots.append(RowSlot(
                slot=len(row_slots), number=number, x=x, pitch=pitch,
                cabinId=cabin["id"], binCaps=[],
            ))
            x += pitch
            if number in monuments:
                # A galley/lav bank: real aisle length, no seats. Passengers
                # walking past it pay for the distance, which is the point.
                x += monuments[number]
    if not row_slots:
        raise ConfigError(f"{spec['id']}: no rows declared")
    length = x
    row_slot_by_number = {rs.number: rs for rs in row_slots}

    # --- seats in canonical order -------------------------------------------
    seats: List[Seat] = []
    max_depth = 0
    block_count = 0
    for cabin in cabins:
        info = _analyse_layout(cabin["layout"])
        missing = set(cabin.get("missingSeats", []))
        exit_rows = set(int(r) for r in cabin.get("exitRows", []))
        block_count = max(block_count, max(v["blockId"] for v in info.values()) + 1)
        for number in cabin["rows"]:
            number = int(number)
            rs = row_slot_by_number[number]
            for letter in cabin["layout"]:
                if letter == AISLE:
                    continue
                seat_id = f"{number}{letter}"
                if seat_id in missing:
                    continue
                m = info[letter]
                max_depth = max(max_depth, m["depth"])
                seats.append(Seat(
                    index=len(seats), rowNumber=number, letter=letter, id=seat_id,
                    cabinId=cabin["id"], classKey=cabin["classKey"],
                    rowSlot=rs.slot, x=rs.x,
                    aisleIndex=m["aisleIndex"], depth=m["depth"],
                    blockId=m["blockId"], binRun=m["binRun"], kind=m["kind"],
                    layoutPos=m["layoutPos"],
                    # Lateral offset in metres, used only by the open-seating
                    # "avoid_neighbours" policy to measure real distance.
                    lateral=m["layoutPos"] * 0.5,
                    isExitRow=number in exit_rows,
                ))

    # --- overhead bin capacity per (row slot, bin run) ----------------------
    # A run with no surviving seats at this row (the tapered tail of a 787, the
    # galley side of 737 row 1) has no bin above it either.
    bin_bags = int(spec["binBagsPerRowSide"])
    run_counts: Dict[str, int] = {}
    for cabin in cabins:
        run_counts[cabin["id"]] = cabin["layout"].count(AISLE) + 1
    seats_per_run: Dict[Tuple[int, int], int] = {}
    for s in seats:
        seats_per_run[(s.rowSlot, s.binRun)] = seats_per_run.get((s.rowSlot, s.binRun), 0) + 1
    for rs in row_slots:
        n_runs = run_counts[rs.cabinId]
        rs.binCaps = [
            bin_bags if seats_per_run.get((rs.slot, r), 0) > 0 else 0
            for r in range(n_runs)
        ]

    # --- doors ---------------------------------------------------------------
    doors: List[Door] = []
    for d in spec["doors"]:
        rb = d["rowBefore"]
        if rb is None:
            last = row_slots[-1]
            dx = last.x + 0.5 * last.pitch
        else:
            rs = row_slot_by_number.get(int(rb))
            if rs is None:
                raise ConfigError(
                    f"{spec['id']}: door {d['id']} references row {rb}, which has no seats"
                )
            dx = rs.x - 0.5 * rs.pitch
        doors.append(Door(
            id=d["id"], name=d["name"], x=dx, aisleIndex=int(d["aisleIndex"]),
            kind=d["kind"], boardable=bool(d.get("boardable", True)),
            defaultEnabled=bool(d["defaultEnabled"]), rowBefore=rb,
        ))
    if not any(d.boardable for d in doors):
        raise ConfigError(f"{spec['id']}: declares no boardable door")

    aisle_count = int(spec["aisleCount"])
    used_aisles = {s.aisleIndex for s in seats}
    if used_aisles and max(used_aisles) + 1 != aisle_count:
        raise ConfigError(
            f"{spec['id']}: declares aisleCount={aisle_count} but the layouts use "
            f"{max(used_aisles) + 1}"
        )

    economy_slots = sorted({s.rowSlot for s in seats if s.classKey == "economy"})

    return Aircraft(
        id=spec["id"], name=spec["name"], manufacturer=spec.get("manufacturer", ""),
        description=spec.get("description", ""), aisleCount=aisle_count,
        seatPitchIn=float(spec["seatPitchIn"]), binBagsPerRowSide=bin_bags,
        defaultConfig=spec.get("defaultConfig", {}),
        cabins=[dict(c) for c in cabins], seats=seats, doors=doors, rowSlots=row_slots,
        seatCount=len(seats), maxDepth=max_depth, blockCount=block_count, length=length,
        seatByPos={s.id: s for s in seats},
        rowSlotByNumber={rs.number: rs.slot for rs in row_slots},
        economyRowSlots=economy_slots,
        cabinById={c["id"]: dict(c) for c in cabins},
    )


def geometry_payload(ac: Aircraft) -> Dict[str, Any]:
    """The resolved geometry, JSON-ready, for the replay format and the renderer."""
    return {
        "id": ac.id,
        "name": ac.name,
        "manufacturer": ac.manufacturer,
        "description": ac.description,
        "aisleCount": ac.aisleCount,
        "seatCount": ac.seatCount,
        "maxDepth": ac.maxDepth,
        "lengthM": round(ac.length, 6),
        "binBagsPerRowSide": ac.binBagsPerRowSide,
        "cabins": [
            {
                "id": c["id"], "name": c["name"], "classKey": c["classKey"],
                "rows": list(c["rows"]), "layout": list(c["layout"]),
                "pitchIn": c["pitchIn"], "exitRows": list(c.get("exitRows", [])),
                "missingSeats": list(c.get("missingSeats", [])),
            }
            for c in ac.cabins
        ],
        "rows": [
            {"slot": r.slot, "number": r.number, "x": round(r.x, 6),
             "pitch": round(r.pitch, 6), "cabinId": r.cabinId}
            for r in ac.rowSlots
        ],
        "seats": [
            {"index": s.index, "id": s.id, "row": s.rowNumber, "letter": s.letter,
             "cabinId": s.cabinId, "classKey": s.classKey, "rowSlot": s.rowSlot,
             "x": round(s.x, 6), "aisle": s.aisleIndex, "depth": s.depth,
             "blockId": s.blockId, "binRun": s.binRun, "kind": s.kind,
             "layoutPos": s.layoutPos, "exitRow": s.isExitRow}
            for s in ac.seats
        ],
        "doors": [
            {"id": d.id, "name": d.name, "x": round(d.x, 6), "aisle": d.aisleIndex,
             "kind": d.kind, "boardable": d.boardable, "defaultEnabled": d.defaultEnabled,
             "rowBefore": d.rowBefore}
            for d in ac.doors
        ],
    }
