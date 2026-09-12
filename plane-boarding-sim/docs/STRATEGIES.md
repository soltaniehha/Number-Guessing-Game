# Boarding strategies — normative algorithms

Each strategy is a pure function returning the passenger queue. `rng` is the
`order` stream. `depth` is distance from the aisle (1 = aisle seat, 2 = middle,
3 = window in a 3-3 cabin; 2 = window in a 2-2 cabin).

Every strategy assigns a human-readable `groupLabel` used by the UI legend and
by the "boarding pass group" display.

Throughout: `rowsAft` = rows sorted rear→front, `rowsFwd` = front→rear.
"random within" always means `rng.shuffle` on that bucket, applied to buckets in
a deterministic order.

---

### 1. `random` — Free-for-all
```
shuffle(all)
```
The literature's inconvenient baseline: it beats most zone schemes because it
naturally spreads passengers along the aisle.

### 2. `back_to_front` — Back-to-front zones
```
split rows into `zoneCount` contiguous bands
for band from rearmost to foremost: emit shuffle(band)
```
Intuitive, and reliably among the worst: it concentrates everyone into one
short stretch of aisle at a time, so all the queueing happens in one place.

### 3. `front_to_back` — Front-to-back zones
As above, foremost band first. Included as the pathological control — every
later passenger must walk past every earlier one.

### 4. `wilma` — Window / Middle / Aisle (outside-in)
```
for d from maxDepth down to 1:  emit shuffle(all seats with depth == d)
```
Eliminates seat-shuffle interference by construction. United's current scheme.

### 5. `wilma_zoned` — Outside-in × back-to-front
```
for d from maxDepth down to 1:
    for band from rear to front (zoneCount bands): emit shuffle(band ∩ depth d)
```
Adds aisle-spreading to WilMA. Usually a little better than plain WilMA.

### 6. `steffen_perfect` — Steffen (perfect)
The theoretical optimum. Passengers board so that **adjacent boarders are two
rows apart**, letting many people stow simultaneously.
```
for side in [left, right]:                     # left = seats before the aisle
  for parity in [even, odd]:                   # row-slot parity
    for d from maxDepth down to 1:             # window → aisle
      emit rows of that side/parity/depth, ordered REAR → FRONT
```
Produces the classic 4·maxDepth waves. Requires perfect passenger compliance,
which is exactly why no airline runs it.

### 7. `steffen_modified` — Steffen (modified / practical)
Four gate-callable groups, no per-passenger sequencing:
```
G1 = even row-slots, left side ; G2 = even row-slots, right side
G3 = odd  row-slots, left side ; G4 = odd  row-slots, right side
within each group: sort by depth descending (window first), then shuffle ties
```
Captures most of the perfect method's benefit while being announceable at a gate.

### 8. `reverse_pyramid` — Reverse pyramid (America West / US Airways)
A diagonal wave from rear-window toward front-aisle. Score each passenger:
```
score = wRow * (normalisedRowFromRear) + wDepth * (normalisedDepth)
      where both terms are in [0,1] and higher = board earlier
sort descending by score, break ties by shuffle
```
`wRow = 0.5, wDepth = 0.5` by default. Blends outside-in with back-to-front, and
in most studies lands between WilMA and Steffen.

### 9. `rotating_zone` — Rotating zone
```
bands = zoneCount contiguous bands
emit rearmost, foremost, 2nd-rearmost, 2nd-foremost, ... (shuffled within)
```
Deliberately alternates the two ends of the aisle so the two flows interleave
instead of queueing behind one another.

### 10. `block_boarding` — Zone blocks (classic airline)
`zoneCount` bands, rear→front, but **parties and cabins respected first**: the
premium cabin boards ahead of all bands. This is the plain vanilla scheme most
airlines used before status tiers took over.

### 11. `open_seating` — Open seating (Southwest, pre-2026)
No seat is assigned. The queue is by check-in position (a proxy: shuffle, with
elites pulled to the front). Each passenger picks a seat on entering the cabin
per `openSeatingPolicy` — see ENGINE_SPEC §6.5. Interestingly fast, because
people self-select to avoid each other.

### 12. `priority_5tier` — 5-tier priority (revenue-driven)
The realistic modern scheme. Order:
```
Preboard      wheelchair/assistance, unaccompanied minors, families w/ infants
Tier 1        First / Business cabin + top-tier elites
Tier 2        Mid elites, premium-economy, co-brand cardholders
Tier 3        Main cabin, group 3 (usually the bulk of the aircraft)
Tier 4        Main cabin, group 4
Tier 5        Basic economy — last, by design
```
Within each tier, `shuffle`. Note this scheme has **no spatial logic at all** —
it sells position rather than optimising flow — which is precisely the point of
comparing it against the next one.

### 13. `common_sense_5tier` — 5-tier common sense ★
The headline "what a sensible airline could actually sell" strategy. It keeps
the commercially non-negotiable parts (premium cabin boards first, preboards
board first) and then applies real flow logic to the ~85% of the aircraft that
is economy — using only five gate-announceable groups.
```
Preboard   assistance + unaccompanied minors
Group 1    Premium cabin (rows fore of the economy section) — commercially fixed
Group 2    Economy WINDOW seats, rear half     (rear-window: furthest to walk)
Group 3    Economy WINDOW seats, front half  +  MIDDLE seats, rear half
Group 4    Economy MIDDLE seats, front half  +  AISLE seats, rear half
Group 5    Economy AISLE seats (front half) — shortest walk, boards last
within each group: rear → front, shuffled within row bands
```
This is a coarse reverse-pyramid quantised to five printable groups. It
preserves the two effects that actually matter — outside-in (kills seat
shuffles) and rear-first (spreads the aisle) — while remaining implementable
with today's boarding passes and gate displays. Elite status is honoured by
letting elites board at the **front of their assigned group** rather than
ahead of everyone, so status still buys something without wrecking the flow.

### 14. `by_bags` — Carry-on-based
```
emit shuffle(0-bag), then shuffle(1-bag), then shuffle(2-bag)
```
Tests the "the bags are the bottleneck" hypothesis directly.

### 15. `slowest_first` — Slowest passengers first
Sort by expected service time (bags, mobility, seat depth) descending. The
theory: get the slow stows started early and let fast passengers fill in behind.

---

## Universal post-processing

Applied by the engine to every strategy above, in this exact order
(ENGINE_SPEC §4):

1. **Preboards to the front** (if `preboardFirst`)
2. **Party cohesion** (if `keepPartiesTogether`) — a party boards together at
   its earliest member's slot, window-first within the party
3. **Non-compliance** — each passenger, with probability `nonComplianceRate`,
   drifts ±`complianceJitter` places
4. **Late arrivals** — with probability `lateRate`, moved to the very end

Party cohesion is the single biggest reason theoretically optimal methods
underperform in reality: a family of four boarding together destroys a
Steffen ordering locally. The simulator lets you turn it off to see exactly how
much it costs.
