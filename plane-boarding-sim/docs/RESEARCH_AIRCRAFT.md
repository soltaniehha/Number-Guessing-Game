# Aircraft Cabin Layout Research

**This document is the citation trail for `parity/aircraft.json`.**

Every cabin encoded in `parity/aircraft.json` derives from the research below. If you change an
encoded layout — a row range, a seat letter, a deletion, a door position, a pitch value — the change
must be justified against this document: either cite a better source here, or explain why the source
recorded here is wrong. Silent edits to `aircraft.json` that contradict this file should be treated
as regressions.

## Research constraints (read this before trusting anything)

Direct page fetching (WebFetch and curl) was blocked by the session's egress proxy during this
research — including `aerolopa.com`, `seatguru.com`, `seatmaps.com`, and even Wikipedia. Everything
below was assembled from web-search result extracts rather than from primary seat maps. That is the
single biggest limitation on this data set, and it is why the confidence markers matter.

## Confidence notation

Every non-obvious claim carries a marker:

| Marker | Meaning |
|---|---|
| `[A]` | Corroborated by two or more sources **and** the seat-count arithmetic closes exactly. Encode with confidence. |
| `[B]` | Single reasonable source, not independently corroborated. Probably right. Worth spot-checking before it drives a headline result. |
| `[C]` | Inferred from structure, convention, or arithmetic rather than stated by a source. Treat as a placeholder. Verify before relying on it. |

The seat-arithmetic verifications scattered through this document are load-bearing. They are the
reason a `[A]` marker means something: a layout whose published seat total reproduces exactly from
its row ranges and deletions is very unlikely to be wrong in its structure, even when no single
source stated that structure outright. Do not delete these verifications when editing this file.

---

## Design decision 1: the two kinds of row gap

**This is the most important structural distinction in the whole document, and the geometry code now
models the two cases separately because of it.**

A gap in the row numbering and a gap in the cabin are not the same thing. Conflating them produces
cabins that are the wrong physical length, aisles with the wrong walking time, and door positions in
the wrong place.

### Type 1 — Skipped row number (zero physical length)

A row number that simply does not exist. There is no monument, no galley, no gap in the seats. The
seats on either side of the "gap" are adjacent in the cabin. Airlines skip numbers for branding
(cabin classes starting at round numbers), superstition (row 13), or fleet-commonality reasons.

Examples in this document:

- **E175 (Alaska): row 5.** First class ends at row 4, Main Cabin starts at row 6. They are physically adjacent.
- **E175 (United): rows 5, 6, 13, 14.** Two separate numbering conventions colliding; no cabin length at all.
- **A220-300 (Delta): rows 4–9.** Six skipped numbers, zero inches. Delta's house convention is that Main Cabin always starts at row 10.
- **A321neo (Delta): rows 6–9.** Same Delta convention.
- **737-8200 (Ryanair): row 13.** Superstition only.

**Model as: `skipped_rows` — advance the row counter, advance the x-position by nothing.**

### Type 2 — Physical monument (real cabin length, no seats)

A galley, lavatory bank, closet, crew rest, or cross-aisle door zone. It occupies real cabin length,
it takes real time to walk past, and on widebodies it is usually co-located with a door — which is
exactly why it matters for boarding.

Examples in this document:

- **787-9 (United): rows 13–19, 23–29, 36–41.** Three separate galley/lavatory complexes. The 36–41 block physically splits Economy into two sections. These are large — the mid-cabin complex is a substantial fraction of cabin length.
- **777-300ER (Emirates): rows 20–22 and 34–36 lavatory blocks**, plus the rear lav block at 49D/E/F/G.
- **A380 (Emirates): rows 44–45, 64–66, 86–88** lav/galley zones on the main deck.
- **737-8200 (Ryanair): forward galley (modules G1, G2) and aft galley (G3, G4, G6).**
- Every aircraft here: forward galley/lav ahead of row 1, aft galley/lav behind the last row.

**Model as: a monument segment with an explicit length, no seats, and — where applicable — an
associated door.**

### Why the distinction changes simulation results

On the 787-9 the two large monument blocks sit between the door positions. If you model rows 13–19
and 36–41 as zero-length skips, the aircraft comes out far too short, doors land in the wrong place
relative to seats, and the walking-time component of boarding is badly underestimated. Conversely,
if you give the A220's rows 4–9 physical length, you invent about fifteen feet of cabin that does
not exist.

A useful heuristic when the sources are ambiguous: **a skipped number with a door or galley attached
is a monument; a skipped number that exists only to make a cabin start at a round figure is a
numbering artefact.** Delta's rows 4–9 and 6–9 are the clearest examples of the latter — the same
gap appears on every Delta aircraft type regardless of what is physically there.

---

## Design decision 2: the E175 is the pathological worst case

**Despite being the smallest aircraft in the fleet, the E175 is the hardest boarding problem here,
and the simulator should treat it as the stress case rather than the easy case.**

Three compounding factors:

### 1. Single boarding door, with no alternative

The E170/E175 has four floor-level doors — 1L, 1R, 2L, 2R — and **no overwing exits at all** `[A]`.
Of those four, exactly one is ever used for passengers: **1L**. 1R is the forward service door
(catering), and the aft pair sit at the aft galley/lavatory and are used for servicing and as
emergency exits only. In US regional operations there is no rear-door boarding, no dual-bridge
option, no airstair alternative that changes the topology. Every passenger enters through one door
at the extreme front of a single-aisle cabin and walks the full length of it.

Contrast: Ryanair and easyJet board front *and* rear simultaneously, roughly halving boarding time;
widebodies can split premium and economy across 1L and 2L. The E175 has no such lever. Whatever
inefficiency the boarding strategy produces, the aircraft cannot absorb it by opening another door.

### 2. The tightest bins in the fleet

Pre-retrofit E175 overhead bins take a standard 22" roller **only sideways or flat**, which consumes
disproportionate bin volume per bag.

Derived capacity, pre-retrofit: **~36 bags for 76 seats ≈ 0.47 bags per seat.**

For comparison (see the overhead-bin section for sources and derivations):

| Aircraft | Bags per seat |
|---|---|
| E175, legacy bins | **~0.47** |
| E175, United 2024 retrofit | ~0.86 |
| 737-800/MAX 8, Sky Interior pivot bins | ~0.67 |
| 737-800/MAX 8, Space Bins | ~0.99 |

The legacy E175 is the only aircraft in this set where fewer than half the passengers can stow a
roll-aboard overhead. Bin-full events are therefore not an edge case on this type; they are the
normal condition, and they occur early in the boarding sequence.

### 3. The resulting gate-check rate: ~9% of the cabin

United's March 2024 press release announcing the larger E175 bins states that the retrofit "will
nearly eliminate the need for **one million annual passengers** to gate-check bags on **more than
150,000 E175 flights**."

**Derivation, so the arithmetic is auditable:**

```
1,000,000 passengers / 150,000 flights  =  6.67 gate-checked bags per flight
6.67 bags per flight / 76 seats         =  8.8%  ≈ 9% of a full cabin
```

**Caveats on this number, which matter:**

- It is **United's own marketing arithmetic**, published to justify a retrofit programme. It has not been independently verified.
- It describes gate-checks **eliminated** by the new bins, not total gate-checks. Any residual gate-checking that survives the retrofit is excluded. It is therefore arguably a **floor** on the pre-retrofit rate, not a central estimate.
- The "more than 150,000 flights" figure is a lower bound on the denominator, which pushes the per-flight number down; the true pre-retrofit rate could be higher on both counts.
- It is an annual average across the fleet. Peak-season, full-load flights will be worse; lightly loaded flights will be better.

Treat ~9% as a defensible baseline parameter with upside risk, and expose it as a tunable rather than
a constant.

### Net effect

One door, a cabin that must be walked end to end, bins that fill before half the passengers have
boarded, and roughly one in eleven passengers requiring a gate-check interaction at the door — the
gate-check itself happening at the single chokepoint every other passenger must pass through. The
E175 concentrates every source of boarding delay at one point in space. That is why it is the worst
case and why it is worth modelling carefully.

---

# Per-aircraft data

---

## A. Embraer E175 — regional jet

The single most important structural fact: **the E170/E175 has NO overwing exits.** It has four
floor-level doors (two forward, two aft) and nothing in between `[A]`. This is unlike the E190/E195.
So there is no mid-cabin exit row, no mid-cabin legroom bump, and no mid-cabin aisle discontinuity —
the E175 is one continuous 2-2 tube.

Several AI-written seat-map sites claim overwing exits on the E175; they are wrong. Sources:
[airliners.net "Why No Overwing Exit On E170?"](https://www.airliners.net/forum/viewtopic.php?t=770367),
[Aircraft Recognition Guide](https://www.aircraftrecognitionguide.com/embraer-170-190).

### A1. Alaska Airlines / Horizon Air + SkyWest E175 — 76 seats

| Cabin | Rows | Seats | Layout | Pitch |
|---|---|---|---|---|
| First | 1–4 | 12 | `A ‖ C D` (1-2) | 37" |
| Premium Class | 6–9 | 16 | `A B ‖ C D` (2-2) | ~34" (up to 4" over Main) |
| Main Cabin | 10–21 | 48 | `A B ‖ C D` (2-2) | 31" |

- **Skipped rows: 5** (Type 1, zero length). Row 13 IS present. `[A]`
- **Seat arithmetic:** 12 (First) + 64 (Main Cabin, 16 rows 6–21 × 4) = **76** ✓ `[A]`
- Alaska's own page describes the letters reading across the printed map as "D and C, aisle, then A" (First) and "D and C, aisle, B and A" (Main). Under normal aviation convention (A = port window) that resolves to **A/B on the port side, C/D on starboard, with the single First seat being A at the port window.** `[B]`
- Rows to avoid per Alaska sources: 16A/16D, 17A/17D, 18A/18D have misaligned windows; rows 20–21 sit at the aft galley/lav.
- Source: [alaskaair.com/content/travel-info/our-aircraft/e175](https://www.alaskaair.com/content/travel-info/our-aircraft/e175)

### A2. United Express E175 — 76 seats (standard, non-"SC")

| Cabin | Rows | Seats | Layout | Pitch |
|---|---|---|---|---|
| First | 1–4 | 12 | `A ‖ C D` (1-2) | 37" |
| Economy Plus | 7–10 | 16 | `A B ‖ C D` | 34" |
| Economy | 11–12, 15–24 | 48 | `A B ‖ C D` | 31" |

- **Skipped rows: 5, 6, 13, 14** (all Type 1, zero length). `[A]`
- **Seat arithmetic:** rows 7–24 is 18 row numbers, minus 13 and 14 = 16 real rows × 4 = 64 Main Cabin seats; 64 + 12 First = **76** ✓. Split: Economy Plus rows 7–10 = 16; Economy rows 11, 12, 15–24 = 12 rows × 4 = 48; 16 + 48 = 64 ✓ `[A]`
- United also flies a 70-seat "Spacious Cabin" (SC) variant: 12F / 32 Economy Plus (rows 7–16) / 26 Economy, last row 23. `[B]`
- Sources: [seatcompare.ai United E175](https://seatcompare.ai/insights/united-airlines-embraer-175-seat-selection-guide-2026), [SimpleFlying E175 US layouts](https://simpleflying.com/embraer-e175-us-operators-layouts-analysis/)

### E175 doors, galleys, lavatories

- **Door 1L** — forward left, forward of row 1. **The only boarding door**, jet bridge or ramp stairs. `[A]`
- **Door 1R** — forward right, service door (catering). Opposite 1L.
- **Door 2L / 2R** — aft, behind the last seat row, at the aft galley/lav. Effectively never used for passenger boarding in US regional ops; used for catering/servicing and as emergency exits.
- Forward galley + forward lavatory: forward of row 1, flanking Door 1 (Type 2 monument).
- Aft galley + aft lavatory: behind the last row (row 21 Alaska / row 24 United), at Door 2 (Type 2 monument).
- **No mid-cabin monument at all** — the row-number gaps (row 5, or rows 5/6/13/14) are pure numbering. Model them as zero-length.

```json
{"id":"E175_AS_76","type":"E175","airline":"Alaska/Horizon","total":76,
 "cabins":[{"n":"First","rows":[1,2,3,4],"cols":[["A"],["C","D"]],"pitch":37},
           {"n":"Premium","rows":[6,7,8,9],"cols":[["A","B"],["C","D"]],"pitch":34},
           {"n":"Main","rows":[10,11,12,13,14,15,16,17,18,19,20,21],"cols":[["A","B"],["C","D"]],"pitch":31}],
 "skipped_rows":[5],"exit_rows":[],"overwing_exits":false,
 "doors":[{"id":"1L","pos":"fwd_of_row_1","boarding":true},{"id":"1R","pos":"fwd_of_row_1","boarding":false},
          {"id":"2L","pos":"aft_of_row_21","boarding":false},{"id":"2R","pos":"aft_of_row_21","boarding":false}],
 "monuments":[{"type":"galley+lav","pos":"fwd_of_row_1"},{"type":"galley+lav","pos":"aft_of_row_21"}]}
```

```json
{"id":"E175_UA_76","type":"E175","airline":"United Express","total":76,
 "cabins":[{"n":"First","rows":[1,2,3,4],"cols":[["A"],["C","D"]],"pitch":37},
           {"n":"EconomyPlus","rows":[7,8,9,10],"cols":[["A","B"],["C","D"]],"pitch":34},
           {"n":"Economy","rows":[11,12,15,16,17,18,19,20,21,22,23,24],"cols":[["A","B"],["C","D"]],"pitch":31}],
 "skipped_rows":[5,6,13,14],"exit_rows":[],"overwing_exits":false}
```

---

## B1. Airbus A320neo — easyJet, 186 seats

The cleanest data set in this whole report: **31 rows × 6 = 186 exactly, no deletions, no skipped
rows.** `[A]`

| Cabin | Rows | Seats | Layout | Pitch |
|---|---|---|---|---|
| Economy (single class) | 1–31 | 186 | `A B C ‖ D E F` | 29" (Recaro slimline, 28–29") |

- **Seat arithmetic:** 31 × 6 = **186** ✓ `[A]`
- **Exit rows: 12 and 13** — two pairs of Type III overwing hatches (one pair per row, both sides). **No seats deleted at the exits.** `[A]`
- Extra legroom: rows 12, 13 (exits) and row 1 (bulkhead, though the bulkhead limits knee room). Rows 1–5 are sold as premium for speed of exit, not legroom.
- Worst row: 31 — no window, narrower (fuselage taper), backs onto aft galley/lavs.
- **Doors:** `1L/1R` forward of row 1; overwing Type III ×2 per side at rows 12 & 13; `2L/2R` aft of row 31. Eight exits, which is exactly what certifies the A320 to its 195-seat limit. `[A]`
- **Boarding:** easyJet routinely boards **both 1L and 2L** — front airstairs/bridge plus rear stairs at remote stands; at bridge gates often front only, sometimes front + rear stairs. This front-and-rear dual-stream boarding is a defining behaviour for European LCCs.
- Monuments: forward lav + galley forward of row 1; two aft lavs + galley aft of row 31. No mid-cabin monument.
- Sources: [easyJet A320neo seat map](https://seatmap.app/seat-map/easyjet-a320neo), [seatmaps.com easyJet A320neo](https://seatmaps.com/airlines/u2-easyjet-uk/airbus-a320neo/)

```json
{"id":"A320N_U2_186","type":"A320neo","airline":"easyJet","total":186,
 "cabins":[{"n":"Economy","rows":"1-31","cols":[["A","B","C"],["D","E","F"]],"pitch":29}],
 "skipped_rows":[],"deleted_seats":[],"exit_rows":[12,13],
 "doors":[{"id":"1L","pos":"fwd_of_row_1","boarding":true},{"id":"1R","pos":"fwd_of_row_1"},
          {"id":"OW","pos":"rows_12_13","type":"typeIII","per_side":2},
          {"id":"2L","pos":"aft_of_row_31","boarding":true},{"id":"2R","pos":"aft_of_row_31"}]}
```

---

## B2. Airbus A321neo (ACF) — Delta, 194 seats

| Cabin | Rows | Seats | Layout | Pitch |
|---|---|---|---|---|
| First | 1–5 | 20 | `A C ‖ D F` (2-2) | 37" |
| Delta Comfort+ | ~10–19/20 | 60 | `A B C ‖ D E F` | 34"+ |
| Main Cabin | ~20/21–39 | 114 | `A B C ‖ D E F` | 31–32" |

- **Skipped rows: 6–9** (Type 1, zero length — Delta convention, Main Cabin starts at row 10). `[A]`
- **Deleted seats: 26A and 26F** — removed for the mid-cabin exit door on each side. This makes **27A and 27F the best economy seats on the aircraft** (nothing in front of them). `[A]`
- **Row 39 = 39A, 39B, 39C only.** The rear galley occupies the 39D/E/F space. Row 39 is the last row — a genuinely asymmetric last row. `[A]`
- **Exit rows: 19 and 20** (two pairs of oversized Type III overwing hatches — the A321neo ACF signature), plus **row 26** (mid-cabin door pair). `[B]`
- **Doors (Airbus Cabin Flex arrangement):** `1L/1R` forward of row 1 → overwing Type III at rows 19 & 20 → `3L/3R` at row 26 → `4L/4R` aft of row 39. Door 2 is plugged/deleted on ACF, which is why the mid-cabin door sits at row 26 rather than ahead of the wing. `[B]`/`[C]`
- Monuments: a **mid-cabin lavatory block inside Comfort+** around rows 10–12 (sources flag it for traffic and noise); rear galley/lavs at 39D/E/F and behind row 39; forward galley/lav ahead of row 1.
- **Seat arithmetic — DOES NOT CLOSE.** Rows 10–39 = 30 rows × 6 = 180; minus 26A, 26F, 39D, 39E, 39F = 175, but the published economy total is 174. **One further seat deletion is unaccounted for** in the sources reachable during this research. Sources also disagree on where Comfort+ ends (10–15, 10–19, 10–20, and 13–19 all appear). **Verify on delta.com before encoding.**
- Sources: [Delta A321neo aircraft page](https://www.delta.com/us/en/aircraft/airbus/a321-neo), [SimpleFlying 20F/60W/114M](https://simpleflying.com/seat-maps/airlines/delta-air-lines/airbus-a321neo/20f-60w-114m/), [seatcompare.ai Delta A321neo](https://seatcompare.ai/insights/delta-airbus-a321neo-seat-selection-guide-2026)

---

## B3. Boeing 737 MAX 8-200 — Ryanair, 197 seats

**This layout reconstructs exactly, and the arithmetic closes.** `[A]`

| Cabin | Rows | Seats | Layout | Pitch |
|---|---|---|---|---|
| Economy (single class) | 1–35, **no row 13** | 197 | `A B C ‖ D E F` | 28–30" (28–28.5" measured; pre-reclined, fixed) |

**Exact seat deletions:**

| Row | Seats present | Why |
|---|---|---|
| 1 | `1B, 1C` only (2 seats) | forward galley/jumpseat occupies the rest |
| 27 | `A B C D E` (5 seats) | 27F replaced by the No.3 aft-facing cabin-crew jumpseat |
| 28 | `B C D E` (4 seats) | **28A and 28F removed for the mid-cabin exit doors** |
| all others | 6 seats | — |

**Seat arithmetic:**

```
row numbers 1-35, minus row 13            = 34 rows
34 rows - 3 special rows                  = 31 full rows
31 full rows x 6 seats                    = 186
+ row 1  (1B, 1C)                         =   2
+ row 27 (A B C D E)                      =   5
+ row 28 (B C D E)                        =   4
                                            ---
                                            197  ✓
```

- **Skipped rows: 13** (Type 1, zero length — superstition only). `[A]`
- **Exit rows: 17, 18** (overwing Type III, two pairs per side) and **28** (the -8200's mid-cabin door pair). Row 1 gets bulkhead space. **29A and 29F have near-unlimited legroom** because 28A/28F do not exist. `[A]`
- **Doors — 10 exits total** (vs 8 on a standard MAX 8): `1L/1R` forward of row 1 → 4 overwing Type III at rows 17 & 18 → **mid-cabin exit pair at row 28** → `2L/2R` aft of row 35. The mid-cabin pair is exactly what raises the exit limit from 189 to 200. `[A]`
- **Galleys (Type 2 monuments):** forward galley = modules G1 + G2; aft galley = modules G3, G4, G6. `[B]`
- **Boarding:** Ryanair boards **front and rear simultaneously** as standard practice (airstairs at remote stands, or bridge + rear stairs). This is the highest-throughput real-world boarding operation in this data set.
- Fuselage taper: rows 1–2 and 34–35 are narrower.
- Sources: [seatcompare.ai Ryanair MAX 8-200](https://seatcompare.ai/insights/ryanair-737-max-8-200-seat-selection-guide-2026), [Ryanair B737-8200 e-learning reference pack](https://www.scribd.com/document/489512614/B737-8200-e-learning-reference-pack-rev-2-pdf), [Boeing MAX 200 launch release](https://boeing.mediaroom.com/2014-09-08-Boeing-Launches-737-MAX-200-with-Ryanair), [SimpleFlying MAX 8 vs 8-200](https://simpleflying.com/striking-differences-boeing-737-max-8-max-8-200/)

```json
{"id":"B738M200_FR_197","type":"737-8200","airline":"Ryanair","total":197,
 "cabins":[{"n":"Economy","rows":"1-35","cols":[["A","B","C"],["D","E","F"]],"pitch":28.5}],
 "skipped_rows":[13],
 "deleted_seats":["1A","1D","1E","1F","27F","28A","28F"],
 "exit_rows":[17,18,28],"bulkhead_rows":[1,29],
 "doors":[{"id":"1L","pos":"fwd_of_row_1","boarding":true},{"id":"1R","pos":"fwd_of_row_1"},
          {"id":"OW","pos":"rows_17_18","type":"typeIII","per_side":2},
          {"id":"MID_L","pos":"row_28"},{"id":"MID_R","pos":"row_28"},
          {"id":"2L","pos":"aft_of_row_35","boarding":true},{"id":"2R","pos":"aft_of_row_35"}]}
```

### B3b. Southwest 737 MAX 8 — 175 seats (US contrast case)

- Rows 1–30, `A B C ‖ D E F`, single class.
- **15A and 15F do not exist** — deleted for overwing exit clearance on the Heart interior, which gives **16A/16F virtually unlimited legroom.** `[A]`
- Extra legroom (34"): rows 1–5, **6ABC**, and 14–16. Standard: 31". 30 extra-legroom seats total.
- **Seat arithmetic — DOES NOT FULLY CLOSE.** 30 rows × 6 = 180 vs 175 actual → 5 deletions. 15A + 15F accounts for 2. The way sources single out "6ABC" as an extra-legroom block strongly implies **6D/E/F also do not exist** (3 more = 175 ✓), but this could not be confirmed directly. `[C]` — verify.
- Source: [seatcompare.ai Southwest MAX 8](https://seatcompare.ai/insights/southwest-737-max-8-seat-selection-guide-2026)

---

## C1. Boeing 777-300ER — Emirates, 3-class, 354 seats

**Configuration:** 8 First / 42 Business / 304 Economy. Emirates also flies a 6F variant at 354, a
2-class 428-seater, and a 4-class "Game Changer" retrofit — this is the classic 3-class frame.

| Cabin | Rows | Seats | Layout | Pitch |
|---|---|---|---|---|
| First (suites) | 1–2 | 8 | `A ‖ E F ‖ K` (1-2-1) — letters `[C]` | 79" flat bed |
| Business | 6–11 | 42 | `A B ‖ D E F ‖ J K` (2-3-2) | 44" pitch, 78.6" bed, angled-flat 166° |
| Economy | ~12–50 | 304 | **`A B C ‖ D E F G ‖ H J K`** (3-4-3) | 32–33" |

- **Seat letters for the 3-4-3:** `A B C` (port) ‖ `D E F G` (centre) ‖ `H J K` (starboard). **I is skipped; G is used; H and J are both used.** `[A]`
- **Seat arithmetic (partial):** Business rows 6–11 = 6 rows × 7 = **42** ✓ `[A]`. First rows 1–2 = 2 rows × 4 = **8** ✓ `[B]`. Economy 304 at 10-abreast implies ~30.4 full-row equivalents across rows ~12–50, with the lav blocks and door zones absorbing the remainder — this one does not close precisely because the per-row breakdown is unpublished. `[C]`
- **Skipped rows: 3–5** (between First and Business). Economy starts around row 12–14. `[B]`
- **Exit rows: 23 and 37.** Confirmed by seats **23A/23K and 37A/37K having exit-row legroom but no window** — the classic signature of a seat beside a door recess. `[A]`
- **Bulkhead: row 14** — extra legroom, no window (i.e. it sits at a door/monument). `[B]`
- **Lavatory/galley blocks that break the cabin (Type 2 monuments):** rows **20–22** (mid-forward lav block) and rows **34–36** (mid-cabin lav block); rear lav block at **49D/E/F/G**; **row 50 is the last row.** `[B]`
- **Doors — five pairs, 1L/1R through 5L/5R.** The 777-300ER has five door pairs, not four (the -200 has four). L3/R3 are the overwing pair and are *not* ditching exits (no rafts). `[A]` Positions below are derived from the anchors above: `[C]`

| Door | Approx. position | Jet-bridge use |
|---|---|---|
| 1L / 1R | forward of row 1 (First cabin) | **1L: primary premium boarding door** |
| 2L / 2R | between rows ~12/13 and 14 (Business→Economy break) | **2L: primary economy boarding door where a 2nd bridge exists** |
| 3L / 3R | at row 23 (overwing) | never a bridge; emergency only |
| 4L / 4R | at row 37 | catering / servicing |
| 5L / 5R | aft of row 50 | catering / servicing; stairs at remote stands |

- Sources: [seatcompare.ai Emirates 777-300ER](https://seatcompare.ai/insights/emirates-777-300er-seat-selection-guide-2025), [Cranky Boss Emirates 777-300ER seat map](https://crankyboss.org/blog/travel/emirates-airlines-boeing-777-300er-seat-map/), [SimpleFlying Emirates 777 configurations](https://simpleflying.com/emirates-boeing-777-seating-configurations-guide/)

> **Caution:** Emirates does not publish exact row starts and the 777-300ER fleet has roughly seven
> sub-variants. Rows 12/14 (economy start) and the exact First/Business letters are the weakest
> numbers here. The **exit rows (23, 37), lav blocks (20–22, 34–36), last row (50), and the 3-4-3
> letters are solid.**

---

## C2. Boeing 787-9 — United, 257 seats

**Configuration:** 48 Polaris / 21 Premium Plus / 188 Economy.

| Cabin | Rows | Seats | Layout | Pitch |
|---|---|---|---|---|
| Polaris business | 1–12 | 48 | 1-2-1 (letters `[C]`, likely `A ‖ D F ‖ L`) | 78" flat bed |
| Premium Plus | 20–22 | 21 | 2-3-2 → `A C ‖ D E F ‖ J L` `[C]` | 38" |
| Economy fwd | 30–35 | 54 | `A B C ‖ D E F ‖ J K L` | 31" (Economy Plus 34–35") |
| Economy aft | 42–~57 | ~134 | `A B C ‖ D E F ‖ J K L` | 31" |

- **Seat letters: `A B C ‖ D E F ‖ J K L`. United's 787 skips G, H AND I.** `[A]` This differs from Boeing's own convention (`ABC DEF HJK`) and from Emirates' 777. Get this right per airline; do not assume.
- **Seat arithmetic:** Polaris rows 1–12 × 4 = **48** ✓. Premium Plus rows 20–22 × 7 = **21** ✓. Economy: rows 30–35 = 6 × 9 = 54; rows 42–56 = 15 × 9 = 135; 54 + 135 = 189 vs 188 published — and if the cabin runs to row 57 it is 6×9 + 16×9 = 198, requiring ~10 seats of tail taper to reach 188. Both readings are consistent with the sourced note that the last row has "sets of two seats near the sidewalls" and no middle seats. The premium cabins close exactly `[A]`; the economy tail does not `[C]`.
- **Physical monument blocks (Type 2 — real cabin length, no seats):**
  - **rows 13–19 absent** (galley/lav between Polaris and Premium Plus)
  - **rows 23–29 absent** (galley/lav between Premium Plus and Economy)
  - **rows 36–41 absent** (mid-cabin galley/lav complex physically splitting Economy into two sections) `[A]`
- **Exit rows: 30 and 42.** Row 30 has door intrusion at 30A/30L and a lavatory door at 30B/30C/30J; row 42 has door intrusion at 42A/42L (no window). `[B]`
- **Economy Plus is column-based, not row-based** — rows 31–33 are Economy Plus in `A B C` and `J K L` only, with `D E F` at standard 31"; row 34 is Economy Plus in `A B C` only. `[B]`
- **Tail taper:** the last row (~57) has "sets of two seats near the sidewalls" and no middle seats. Rows 55–57 lose roughly 10 seats collectively vs a full 9-abreast row. `[B]`
- **Doors — four pairs.** `1L/1R` forward of row 1; `2L/2R` in the rows 13–19 gap / at the row-20 bulkhead; `3L/3R` at row 30; `4L/4R` at row 42. `[C]` — the row 30 and 42 door intrusions are sourced; assigning them numbers 3 and 4 is inference.
- **Boarding:** United boards the 787-9 with **L1 for Business and L2 for Economy** where two bridges exist. `[B]`
- Sources: [seatcompare.ai United 787](https://seatcompare.ai/insights/united-airlines-787-seat-selection-guide), [SimpleFlying best seats United 787 2026](https://simpleflying.com/best-seats-united-airlines-boeing-787-2026/), [seatmap.app United 787-9](https://seatmap.app/seat-map/united-787-9)

---

## D1. Airbus A220-300 — Delta, 130 seats (the asymmetric one)

The most interesting layout in the set: **2-3, so the aisle is off-centre and every row has one
middle seat instead of two.**

| Cabin | Rows | Seats | Layout | Pitch |
|---|---|---|---|---|
| First | 1–3 | 12 | `A C ‖ D F` (2-2) | 37" (20.5" wide) |
| Delta Comfort+ | 10–18 | 43 | `A C ‖ D E F` (2-3) | ~34" |
| Main Cabin | 19–33 | 75 | `A C ‖ D E F` (2-3) | 31" (18.6" wide) |

- **Skipped rows: 4–9** (Type 1, zero length — Delta convention). `[A]`
- **Seat arithmetic:**

```
First   rows 1-3    : 3 rows x 4 seats            =  12
Comfort+ rows 10-18 : (9 rows x 5) - 2 deleted    =  43
Main    rows 19-33  : 15 rows x 5                 =  75
                                                    ---
                                                    130  ✓
```

- **Row 17 is the overwing exit row and has only THREE seats** — the two window positions are deleted for exit clearance, one per side. The remaining seat on the 2-side is a **solo seat with no neighbour and an empty window space beside it, ~35" pitch** — a genuinely unique cell to render. `[A]`
- **Letter-scheme conflict `[C]` — resolve before encoding.** The A220 2-3 appears rendered two ways: the standard Airbus scheme **`A C ‖ D E F`** (deleting **A and F** at row 17, leaving **17C, 17D, 17E**), and one source using **`A B ‖ C D E`** (deleting **A and E**, leaving **17B, 17C, 17D**). The structural fact — 3 seats in row 17, both windows gone — is scheme-independent. Delta's house style elsewhere (A/C/D/F in 2-2 First) points to `A C ‖ D E F`. **Verify on delta.com.**
- Seat widths differ by side: on the A220 the 3-side seats are 18.6" and the 2-side seats are wider (~19"), so the cabin is asymmetric in more than seat count.
- **Doors:** `1L/1R` forward of row 1; **one Type III overwing exit per side at row 17**; `2L/2R` aft of row 33. Six exits, consistent with the A220-300's 160-seat exit limit. `[C]`
- Monuments: forward galley/lav ahead of row 1; aft galley/lavs behind row 33.
- Sources: [Delta A220-300 aircraft page](https://www.delta.com/us/en/aircraft/airbus/a220-300), [SimpleFlying 12F/43W/75M](https://simpleflying.com/seat-maps/airlines/delta-air-lines/airbus-a220-300/12f-43w-75m/), [seatcompare.ai Delta A220-300](https://seatcompare.ai/insights/delta-a220-300-seat-selection-guide-2026)

```json
{"id":"A223_DL_130","type":"A220-300","airline":"Delta","total":130,
 "cabins":[{"n":"First","rows":[1,2,3],"cols":[["A","C"],["D","F"]],"pitch":37},
           {"n":"Comfort+","rows":[10,11,12,13,14,15,16,17,18],"cols":[["A","C"],["D","E","F"]],"pitch":34},
           {"n":"Main","rows":"19-33","cols":[["A","C"],["D","E","F"]],"pitch":31}],
 "skipped_rows":[4,5,6,7,8,9],
 "deleted_seats":["17A","17F"],
 "exit_rows":[17],"asymmetric":"2-3, aisle off-centre; row 17 has 3 seats only",
 "doors":[{"id":"1L","pos":"fwd_of_row_1","boarding":true},{"id":"1R","pos":"fwd_of_row_1"},
          {"id":"OW","pos":"row_17","type":"typeIII","per_side":1},
          {"id":"2L","pos":"aft_of_row_33"},{"id":"2R","pos":"aft_of_row_33"}]}
```

---

## D2. Airbus A380 — Emirates, 489 seats (weakest data set)

**Configuration:** 14 First / 76 Business (both upper deck) / 399 Economy (entire main deck).

| Deck | Cabin | Rows | Seats | Layout |
|---|---|---|---|---|
| Upper | First suites | ~1–4 `[C]` | 14 | 1-2-1 (`A ‖ E F ‖ K` `[C]`) |
| Upper | Business | ~6–24 `[C]` | 76 | 1-2-1 |
| Main | Economy | ~41/43–88 | 399 | **`A B C ‖ D E F G ‖ H J K`** (3-4-3) |

- Economy runs the **entire main deck**, starting at row 41 or 43 depending on variant, ending at **row 88**. `[B]`
- **Extra-legroom bulkhead/exit rows: ~52, ~67, ~80.** `[B]`
- **Lav/galley zones (Type 2 monuments): rows 44–45, 64–66, 86–88.** `[B]`
- **Seat arithmetic:** Business rows 6–24 = 19 rows × 4 = **76** ✓ (this is why those row bounds are the best guess) `[C]`. First's 14 suites over 1-2-1 implies 3 full rows plus a partial `[C]`. Main deck: ~46 row numbers × 10 = 460 vs 399 actual → roughly **61 seats' worth of galley/lav/cross-aisle zones**, consistent with three large monument blocks, but the per-row breakdown could not be obtained. **Treat A380 row numbers as approximate.**
- Upper deck also has the **onboard lounge/bar at the rear of the upper deck** and shower spas forward — both real monuments.
- **Boarding:** Emirates uses **three jet bridges** at Dubai — two to main-deck doors and one direct to an upper-deck door, with both decks boarded simultaneously. Code F stands are built for this. `[A]`
- Sources: [seatcompare.ai Emirates A380](https://seatcompare.ai/insights/emirates-a380-seat-selection-guide-2025), [Executive Traveller best economy seats Emirates A380](https://www.executivetraveller.com/the-best-seats-in-economy-class-on-emirates-airbus-a380), [Aviation Souk on A380 boarding bridges](https://aviationsouk.com/knowledge/passenger-boarding-bridges-jet-bridges-types-and-a380-requirements/)

---

## 9. Overhead bin capacity

These numbers drive the gate-check model. Bin starvation is what turns a boarding-order difference
into a measurable time difference, so the per-seat capacities below are among the most
result-sensitive parameters in the simulator.

### Airbus A320 family

| Bin type | Bags per bin | Notes |
|---|---|---|
| Legacy / pivot bins | **5** | bags go in flat |
| Airspace **XL** bins | **8** | +40–60% volume; roll-aboards go in **on their side** |
| Airspace **L** bins (2025 retrofit) | +60% vs legacy | **vertical (wheels-first) loading** |

Airbus's own framing: "up to eight bags (three more than the current capacity of five), each
61 × 40.6 × 25.4 cm." Airbus has also published a variant figure of "four bags per bin instead of
three" for a different bin size — so **the bin module, not the row, is the unit**, and module length
varies. Airbus announced the end of pivot bins on single-aisles in 2023.

Sources: [Airbus A320 Family Airspace L Bins](https://aircraft.airbus.com/en/services/enhance/cabin-upgrades/a320fam-airspace-l-bins),
[Airbus "Upsize your overhead bins"](https://www.aircraft.airbus.com/en/newsroom/news/2023-05-upsize-your-overhead-bins-downsize-boarding-hassle-and-stress),
[Runway Girl Network on pivot bins](https://runwaygirlnetwork.com/2023/09/airbus-sounds-the-death-knell-for-pivot-bins-on-single-aisle-aircraft/)

### Boeing 737

| Aircraft | Sky Interior pivot bins | Space Bins | Per-bin |
|---|---|---|---|
| 737-800 / MAX 8 | **118 bags** | **174 bags** | 4 → **6** per 60" bin |
| 737-900ER / MAX 9 | **132 bags** | **194 bags** | 4 → **6** per 60" bin |

**Derived** (labelled as derived, not sourced): on a 175-seat MAX 8 that is
**0.67 bags/seat legacy → 0.99 bags/seat with Space Bins**, or roughly
**3.9 bags/row → 5.8 bags/row** over 30 rows. Space Bins reach approximately
one-roll-aboard-per-passenger; pivot bins do not, which is why bin-full backflow is a real
phenomenon on non-Space-Bin 737s.

Sources: [Boeing Space Bins](https://www.boeing.com/commercial/737max/space-bins),
[New Atlas on Space Bins](https://newatlas.com/boeing-space-bins-carry-on-luggage/32934/)

### Embraer E175 — the gate-check problem, quantified

The best-quantified part of this research, and the basis for the E175 worst-case treatment above.

- Old E175 bins: a 22" roller **fits, but only sideways or flat**, consuming disproportionate space.
- United's 2024 retrofit (first airline to do it): bins take bags **wheels-first**, like the E2.
  **+29 carry-on bags per aircraft, an 80% increase.** `[A]`
- **Derived from those two figures:** old capacity ≈ **36 bags** for 76 passengers (**~0.47 bags/seat**);
  new ≈ **65 bags** (**~0.86 bags/seat**). (29 / 0.80 ≈ 36; 36 + 29 = 65.)
- **Gate-check rate.** United states the retrofit "will nearly eliminate the need for one million
  annual passengers to gate-check bags on more than 150,000 E175 flights":

```
1,000,000 / 150,000  =  6.67 gate-checked bags per flight
6.67 / 76 seats      =  8.8%  ~= 9% of a full cabin
```

  This is **United's own marketing arithmetic**, and it counts gate-checks *eliminated* rather than
  total gate-checks — so it is arguably a **floor** on the pre-retrofit rate, not a central estimate.
  The "more than 150,000 flights" denominator is itself a lower bound, which pushes the per-flight
  figure down further.
- Rollout: 50 aircraft by end-2024, 150+ by end-2026.

Sources: [United press release, March 2024](https://www.prnewswire.com/news-releases/united-becomes-first-airline-to-add-new-larger-overhead-bins-to-embraer-e175-aircraft-302099459.html),
[Upgraded Points](https://upgradedpoints.com/news/larger-overhead-bins-united-embraer-e175/)

### 777 / 787

The weakest area — no clean bags-per-bin figure was found for either.

- **787:** Boeing markets the bins as "the largest in the industry"; they take an 11 × 16 × 22" bag in every class, in large drop-down bins. No per-bin count published.
- **777:** classic bins are comparable to the 787 in bag orientation; the 777X introduces larger bins. No per-bin count found.
- **Practical modelling note:** widebody bin starvation is far less common than on narrowbodies, because 3-4-3 seating puts 10 passengers under 3 bin runs (two sidewall + one centre) rather than 6 passengers under 2. Centre-section bins on a 3-4-3 fill last, since passengers prefer the bin directly above them.

---

## 10. Boarding-door usage reality at a hub

- **777 stands at large hubs normally have two bridges** (Code E gates). Whether both are *used* is an airline-by-airline, station-by-station decision, not an aircraft one.
- **Dual-door boarding does happen and is worth modelling:** United boards 777s at Denver through **1L and 2L simultaneously**, with separate scanning podiums merging in the jetway; some stations split by seat column (far-aisle seats via 1L, near-aisle via 2L). American has moved to **two-bridge deplaning** on 777s. `[B]`
- **But single-door boarding is still the norm for most widebodies:** most A330, A350 and 787 flights board **through 2L only, even when a second bridge is physically available** — the marginal gain is not judged worth the extra staffing and coordination. `[B]`
- **Typical premium/economy split when two doors are used:** 1L = First/Business, 2L = Premium Economy/Economy. United does exactly this on the 787-9.
- **A380 is the exception where multi-bridge is standard:** Code F stands use a **three-bridge arrangement** — two to main-deck doors, one direct to an upper-deck door — and Emirates boards both decks simultaneously at Dubai. `[A]`
- **Remote stand / airstair operations flip everything:** narrowbodies board front *and* rear (Ryanair, easyJet — this roughly halves boarding time and is why their turnarounds are 25 minutes); widebodies at remote stands typically use two sets of stairs at 1L and 2L.
- **Regional jets:** the E175 boards through **1L only, always**. No second option exists. Combined with the small bins, this is what makes the E175 the worst-case boarding scenario in the simulator despite having the fewest seats. See "Design decision 2" above.

Sources: [FlyerTalk — United 777 simultaneous 1L/2L boarding at DEN](https://www.flyertalk.com/forum/united-airlines-mileageplus/1962589-odd-boarding-process-den-777-simultaneous-bg1-door-1l-bg2-door-2l.html),
[Airliners.net dual jet bridge boarding](https://www.airliners.net/forum/viewtopic.php?t=1419423),
[View from the Wing — AA two-bridge 777 deplaning](https://viewfromthewing.com/american-airlines-starts-deplaning-boeing-777s-faster-using-two-jet-bridges-roundup/),
[Aviation Pros — A380 boarding bridges](https://www.aviationpros.com/ground-support-worldwide/gse/passenger-loading-systems-boarding-bridges-stairs-jetways/article/10856632/passenger-boarding-bridges-built-just-for-the-a380)

---

## What to verify before you encode

Ranked by risk. **This list is the honest statement of which numbers in `parity/aircraft.json` are
soft.** Do not delete an entry from it without actually resolving the item.

1. **Delta A220-300 letter scheme** — `A C ‖ D E F` vs `A B ‖ C D E`. Changes every seat ID in the cabin.
2. **United 787-9 Polaris and Premium Plus letters** — the economy `ABC DEF JKL` is solid; the premium cabin letters are inference.
3. **Delta A321neo** — the missing 6th economy seat, and where Comfort+ actually ends (sources give four different answers).
4. **Southwest MAX 8** — whether 6D/E/F are the other 3 missing seats.
5. **Emirates 777-300ER economy start row** (12 vs 13 vs 14) and the First/Business letters.
6. **Emirates A380 row numbers generally** — treat as approximate throughout.

Layouts that can be encoded with confidence today, because each reconciles to its published seat
total exactly: **Alaska E175, United E175, easyJet A320neo, Ryanair 737-8200, Delta A220-300
(structure, not letters).**

### The one action that would resolve almost everything

If the egress block on `aerolopa.com` is ever lifted, that single site resolves essentially every
remaining uncertainty above — its LOPAs are drawn from real airline cabin drawings and show
monuments, door positions and per-seat deletions precisely. The relevant pages:

```
/as-e75      Alaska E175
/ua-e75-2    United E175 (16 Economy Plus)
/u2-32n      easyJet A320neo
/dl-3ne      Delta A321neo
/fr-7m8      Ryanair 737-8200
/wn-7m8-1    Southwest 737 MAX 8
/ek-77wr     Emirates 777-300ER
/ua-78p      United 787-9
/dl-223      Delta A220-300
/ek-388j     Emirates A380
```
