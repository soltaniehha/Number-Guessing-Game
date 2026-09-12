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
Eliminates seat-shuffle interference by construction.

**Adopters, precisely.** United applies WilMA only to the economy *residual*
below Groups 1–2, and Basic Economy boards **after** the aisle group — so
United's scheme is a hybrid, not this. **Lufthansa** (with an explicit
"and companions" rule) and **ANA** also run it, and **Southwest adopted it in
January 2026**. Real-world WilMA is always a hybrid; this entry is the pure
form, which is what makes it a useful control rather than a model of any one
carrier.

### 5. `wilma_zoned` — Outside-in × back-to-front
```
for d from maxDepth down to 1:
    for band from rear to front (zoneCount bands): emit shuffle(band ∩ depth d)
```
Adds aisle-spreading to WilMA.

**This has a live deployment, and it is the strongest realism claim in this
file.** Southwest's replacement for open seating, live since **27 January
2026**, is exactly W/M/A × rear→front. See §16 for the version with Southwest's
fare and status ladder merged in, which is what they actually board; this entry
is the flow logic on its own, with no commercial constraints attached.

### 6. `steffen_perfect` — Steffen (perfect)
The theoretical optimum. Passengers board so that **adjacent boarders are two
rows apart**, letting many people stow simultaneously.
```
for side in [left, right]:                     # left = seats before the aisle
  for parity in [even, odd]:                   # row-slot parity
    for d from maxDepth down to 1:             # window → aisle
      emit rows of that side/parity/depth, ordered REAR → FRONT
```
Produces the classic 4·maxDepth waves.

**Why no airline runs it — and compliance is only the fourth reason.** Ahead of
it, in order: mandatory **party cohesion** (a family of four boarding together
destroys the alternating pattern locally, and no carrier will split a booking);
**alliance and status contractual obligations**, which promise named customers a
boarding position that a per-seat sequence cannot honour; and the plain absence
of any **gate infrastructure** for sequencing individual passengers — the
displays, the lane furniture and the agent scripts are all built around calling
groups. Passenger compliance is the reason this *model* can put a number on,
which is not the same as the binding one.

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

**It was measured in revenue service and it worked.** America West / US Airways
recorded **−2 minutes, about −20%, on full flights** and **−21% departure
delays** across the first three months (van den Briel, Villalobos, Hogg, Lindemann
& Mulé, *Interfaces* 35(3):191–201, 2005). It is the best-evidenced ordering
change ever flown. It then disappeared through two merger integrations, and **no
source states a performance reason for abandoning it** — so this is a method
that stopped being used, not one that failed. **JAL's 2024** window-and-rear
scheme is a coarse two-group descendant of the same idea.

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

### 11. `open_seating` — Open seating (Southwest, 1971–2026) — **retired**
No seat is assigned. The queue is by check-in position (a proxy: shuffle, with
elites pulled to the front). Each passenger picks a seat on entering the cabin
per `openSeatingPolicy` — see ENGINE_SPEC §6.5. Interestingly fast, because
people self-select to avoid each other.

**This is now a historical method.** Southwest ran it for 53 years and ended it
on **27 January 2026**, replacing it with assigned seats and the scheme in §16.
No airline of consequence uses open seating today, so treat this as a baseline
worth understanding rather than an option anyone could adopt. Its replacement is
the interesting comparison.

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
Within each tier, `shuffle`.

**Revenue-only, and that is a minority position rather than the universal one.**
This models **Delta, American and Air France**, whose economy ordering is driven
by fare and status alone. It is *not* how United, Lufthansa, ANA, JAL, BA,
Emirates, Qatar or Southwest board — all of those layer flow logic underneath
the status ladder, and are modelled by `wilma` (§4) and `southwest_2026` (§16).
The comparison this strategy anchors is therefore **revenue-only vs
revenue-then-flow**, not "airlines vs sense".

**It has no *deliberate* spatial logic, but it is not spatially neutral, and
that is the whole finding.** Status flyers sit in the forward economy rows —
Comfort+, Main Cabin Extra, Economy Plus — and premium cabins are forward by
definition, so calling Tiers 1–2 first means calling the front of the aircraft
first, which is a front-to-back boarding in all but name. The simulator models
this explicitly through `eliteForwardBias` (ENGINE_SPEC §3.1 step 6); with
status modelled as uniform over the cabin this strategy came out level with
`random`, which flattered it considerably.

**Tier 1 is carrier-dependent at the top.** This is the generic US-legacy case,
with First and Business in Tier 1. **American has preboarded First and Business
since 1 May 2025**, which would move them out of Tier 1 entirely. That is
deliberately *not* encoded here: pinning one carrier's 2025 change makes the
strategy less representative of the class it stands for.

### 13. `common_sense_5tier` — 5-tier common sense ★
The headline "what a sensible airline could actually sell" strategy. It keeps
the commercially non-negotiable parts (premium cabin boards first, preboards
board first) and then applies real flow logic to the ~85% of the aircraft that
is economy — using only five gate-announceable groups.

**Status is an input to the group assignment, not a sort inside it.** Seat
location proposes a group; the status ladder then shifts you whole groups
earlier or later; the result is one merged ordering.
```
Preboard   assistance + unaccompanied minors
base group from seat location:
   0    Premium cabin (rows fore of the economy section) — commercially fixed
   1    Economy WINDOW seats, rear half     (rear-window: furthest to walk)
   2    Economy WINDOW seats, front half  +  MIDDLE seats, rear half
   3    Economy MIDDLE seats, front half  +  AISLE seats, rear half
   4    Economy AISLE seats (front half) — shortest walk

status shift, added to the base group and clamped to 0..4:
   First / Business / top-tier elite      -3
   Premium economy / mid-tier elite       -2
   Co-brand cardholder                    -1
   Standard                                0
   Basic economy                          +1

within each group: premium cabin first, then rear → front, shuffled within a row
```
This is a coarse reverse-pyramid quantised to five printable groups. It
preserves the two effects that actually matter — outside-in (kills seat
shuffles) and rear-first (spreads the aisle) — while remaining implementable
with today's boarding passes and gate displays.

**Why the elite rule changed.** The previous version let elites board at the
front of the group their *seat* earned. That is done by no airline, and on an
outside-in scheme it is actively perverse: elites disproportionately choose
**aisle** seats, outside-in calls aisles **last**, so the rule seated a top-tier
flyer behind every basic-economy window passenger. No revenue department would
approve it, and in this model it also made the strategy **slower than random**.
The construction above is the one Southwest actually shipped — status and seat
location feeding one merged ordering — and it is both sellable and faster. See
RESEARCH_AIRLINES §7 #2.

**Party cohesion is mandatory for this strategy**, not an optional
post-processing step. Every deployed carrier that boards by seat location
promotes the entire booking to its earliest-boarding member — United's "same and
highest applicable", Lufthansa's "and companions" — so a run with
`keepPartiesTogether = false` is not a model of anything real, and the strategy
forces it on regardless of the config. The engine's cohesion rule is
**promote-to-earliest** (verified, not assumed: see
`test_party_cohesion_promotes_to_the_earliest_member`), which is what deployed
companion rules do.

**On family seating and the law.** The US DOT family-seating rule is a
**proposed** rule — an NPRM published 9 August 2024, **not finalised**. What
actually binds seven carriers is their **voluntary** Dashboard commitments. The
operational constraint on this strategy is real; the legal one is not, and
nothing in this document or the UI should say otherwise.

### 14. `by_bags` — Carry-on-based
```
emit shuffle(0-bag), then shuffle(1-bag), then shuffle(2-bag)
```
Tests the "the bags are the bottleneck" hypothesis directly. Note the literature
finds the **reverse** order (most bin luggage first) is what shortens boarding,
so this particular sort is a foil rather than a proposal.

**The commentary matters more than the strategy.** Spirit reportedly cut
boarding by about **six minutes** by charging for carry-ons — roughly **three
times** the best claimed benefit of any ordering change, achieved by a pricing
decision with no gate process change whatsoever. Over the same period boarding
has slowed from about **15 minutes in the 1970s to 30–40 minutes for ~140
passengers today**, a rate reduction of more than half, and the bag mix is the
main suspect. If this simulator shows bag policy dominating boarding order, that
is not a quirk of the model — it matches the field evidence, and it is arguably
the most actionable finding the tool produces.

### 15. `slowest_first` — Slowest passengers first
Sort by expected service time (bags, mobility, seat depth) descending. The
theory: get the slow stows started early and let fast passengers fill in behind.

### 16. `southwest_2026` — Southwest 2026 (WilMA × zones + status, 8 groups)
The real converged design, and the benchmark every other entry in this file
should be measured against. On **27 January 2026** Southwest ended 53 years of
open seating and, given a blank sheet, chose **window → middle → aisle boarded
back to front**, merged with fare and Rapid Rewards status into **eight**
numbered boarding groups. It runs on roughly 4,000 flights a day.

```
location rank = (maxDepth - depth) * zoneCount + (rearmost band first)
                # i.e. exactly the emission order of wilma_zoned (§5)
base group    = floor(location rank * 8 / (maxDepth * zoneCount))
group         = clamp(base group + status shift, 0, 7)      # shifts as in §13
within each group: window → middle → aisle, then rear → front
```
The within-group WilMA sort matters: Southwest's own material describes Group 1
as the **window subset first**, and without it an A-List aisle seat shifted into
an early group would board ahead of that group's windows and undo the
zero-interference property the scheme is built on.

Eight groups rather than five is not cosmetic — finer quantisation preserves
more of the underlying spatial order. Party cohesion is mandatory here for the
same reason as §13.

**What it is for.** Having this in the list means the headline comparison is
*our proposal vs. the real converged design* rather than *our proposal vs. a
strawman*. It also measures, directly, what merging a status ladder into a
flow-optimal ordering costs — which is the central tension this whole simulator
exists to quantify.

---

## Universal post-processing

Applied by the engine to every strategy above, in this exact order
(ENGINE_SPEC §4):

1. **Preboards to the front** (if `preboardFirst`)
2. **Party cohesion** (if `keepPartiesTogether`, or always for the strategies
   that require it) — a party boards together at its earliest member's slot,
   window-first within the party
3. **Non-compliance** — each passenger, with probability `nonComplianceRate`,
   drifts ±`complianceJitter` places
4. **Late arrivals** — with probability `lateRate`, moved to the very end

Party cohesion is the single biggest reason theoretically optimal methods
underperform in reality: a family of four boarding together destroys a
Steffen ordering locally. The simulator lets you turn it off to see exactly how
much it costs — except for `common_sense_5tier` (§13) and `southwest_2026`
(§16), which force it on because for a scheme that boards by seat location it is
part of the construction rather than a friction.

The rule is **promote-to-earliest**: the party is emitted whole at the queue
position of whichever member the strategy called first, never at a mean or a
latest position. That is what every carrier with a published companion rule
does, and it is asserted by
`test_party_cohesion_promotes_to_the_earliest_member`.

Steps 3 and 4 draw a **per-passenger** behaviour — the same traveller ignores
their group, or turns up late, under every strategy — rather than consuming a
shared stream in queue order. That is what lets a paired strategy comparison
cancel them instead of counting them as noise. See ENGINE_SPEC §1.3.

**Preboarding is a first-class swept parameter.** `preboardRate` defaults to
2.5%, but the realistic baseline is **5–10% of the cabin** and leisure-market
flights credibly reach **20–33%**. Above roughly 15% preboarding stops being a
prologue and becomes the binding constraint — the boarding time is set by the
preboard block and the ordering strategy underneath it barely matters. That is a
regime change, not a shift in a number, and it is worth sweeping for:
`plane_boarding.cli sweep --param preboardRate`.
