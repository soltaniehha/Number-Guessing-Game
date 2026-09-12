# Plane Boarding Simulator — Canonical Engine Specification

**Version:** 2.0
**Status:** Normative. Two implementations exist and MUST agree bit-for-bit:
- `python/plane_boarding/` (reference, batch/research)
- `web/src/sim/` (browser, visualization + Monte Carlo in a Web Worker)

Any behavioural difference between the two is a **bug**. The parity harness in
`parity/` runs both against shared fixtures and compares full metric output.

### What changed in 2.0

The service-time models were replaced wholesale with Schultz's (DLR)
field-calibrated ones — the best-validated boarding model in the literature,
fitted against >400 recorded flights of which 282 A320/737 boarding events form
the validation set. Provenance for every number is in
`docs/RESEARCH_PARAMETERS.md`; the changes are:

| Was | Is | Why |
|---|---|---|
| Lognormal stow, `stowBaseMean * bags^0.85` | **Sum of `Weibull(1.7, 16 s)` per piece** (§6c) | The only field-fitted stow distribution; per-piece summation produces the right super-linear variance without an exponent hack |
| Flat blocker-count shuffle `{1: 9 s, 2: 15 s}` | **Elementary-movement counts** `{none 1, aisle 4, middle 5, both 9}` × `Triangular(1.8, 2.4, 3.0)` (§6d) | The penalty depends on *which* seat blocks, not just how many; and every passenger pays one movement simply to sit |
| Lognormal gate-scan, applied in series | **`exponential(3.7 s)` door arrival, cumulative clock in parallel with aisle blocking** (§5) | It is an arrival process, not a service time. Serialising it roughly doubled modelled boarding time |
| `binBagsPerRowSide` a global default | **Per-airframe**, config-overridable (§6.4) | Bin volume is a property of the aeroplane; 1 bag/row-side on a legacy E175 against 4 on an A320neo |
| A stowing passenger closed the aisle outright | **Partial blocking**: they step into the seat-row gap and one follower at a time edges past at `stowPassSpeedFactor` (§6.3), while a SHUFFLING passenger still blocks completely | The strict version overshoots the field regression by ~50% on single-door boarding; the asymmetry also makes seat interference correctly more expensive than bag stowing |
| — | `monuments`, `Door.boardable`, `Aircraft.defaultConfig` (§2) | Real galley banks cost cabin length that a skipped row number does not; service doors and overwing hatches are exits, not boarding doors |

---

## 0. Design principles

1. **Deterministic given a seed.** Same `(config, seed)` ⇒ identical event log and
   identical metrics, in both languages. This is non-negotiable; it is what makes
   the parity harness possible and what makes the visualization reproducible.
2. **Continuous space, discrete time.** Passengers hold a real-valued position
   along a 1-D aisle lane. The world advances in fixed steps of `dt`.
3. **Draw order is part of the spec.** Every random draw is specified with an
   exact call site and order. Adding a draw is a breaking change.
4. **Units.** Distance in **metres**, time in **seconds**, speed in **m/s**.
   Row positions are converted to metres via seat pitch.

---

## 1. Random number generation

### 1.1 Core generator: PCG32

Both implementations use PCG32 (XSH-RR variant, 64-bit state, 64-bit increment).
JS uses `BigInt` for the 64-bit arithmetic to guarantee exactness.

```
state: uint64, inc: uint64 (always odd)
MULT = 6364136223846793005
seed(initstate, initseq):
    state = 0
    inc   = (initseq << 1) | 1
    next_uint32()
    state = state + initstate
    next_uint32()

next_uint32() -> uint32:
    old = state
    state = (old * MULT + inc) mod 2^64
    xorshifted = uint32(((old >> 18) ^ old) >> 27)
    rot        = uint32(old >> 59)
    return uint32((xorshifted >> rot) | (xorshifted << ((-rot) & 31)))
```

### 1.2 Derived distributions

All are defined in terms of `next_uint32()`.

- `random()` → float in [0,1):  `next_uint32() * 2^-32`
- `uniform(a,b)` → `a + (b-a)*random()`
- `randint(n)` → integer in [0,n): rejection-sampled to avoid modulo bias:
  ```
  if n <= 0: return 0
  limit = 2^32 - (2^32 mod n)
  loop: r = next_uint32(); if r < limit: return r mod n
  ```
- `normal(mu, sigma)` → **Box–Muller, no caching of the second variate.**
  Every call consumes exactly two uint32 draws:
  ```
  u1 = random(); if u1 < 1e-12: u1 = 1e-12
  u2 = random()
  z  = sqrt(-2*ln(u1)) * cos(2*pi*u2)
  return mu + sigma*z
  ```
  Discarding the second variate is deliberate: caching would make the draw
  sequence depend on call history and is a classic parity-breaker.
- `truncnormal(mu, sigma, lo, hi)` → resample `normal` up to 32 times until the
  value is in `[lo,hi]`; on exhaustion return `clamp(value, lo, hi)`.
- `lognormal(mean, sd)` → parameterised by the **mean and sd of the resulting
  variable** (not of the underlying normal):
  ```
  if mean <= 0: return 0
  var    = sd*sd
  mu     = ln(mean^2 / sqrt(var + mean^2))
  sigma  = sqrt(ln(1 + var/mean^2))
  return exp(normal(mu, sigma))
  ```
- `exponential(mean)` → inverse CDF, **exactly one** uint32 draw:
  ```
  u = 1 - random(); if u < 1e-12: u = 1e-12
  return -mean * ln(u)
  ```
- `weibull(shape, scale)` → inverse CDF, **exactly one** uint32 draw:
  ```
  u = 1 - random(); if u < 1e-12: u = 1e-12
  return scale * (-ln(u))^(1/shape)
  ```
- `triangular(lo, mode, hi)` → inverse CDF, **exactly one** uint32 draw:
  ```
  if hi <= lo: return lo
  u = random(); c = (mode - lo) / (hi - lo)
  if u < c:  return lo + sqrt(u * (hi-lo) * (mode-lo))
  else:      return hi - sqrt((1-u) * (hi-lo) * (hi-mode))
  ```
  The single-draw property of these three is load-bearing: the parity harness's
  `mixed` vector interleaves them with the two-draw `normal` precisely because a
  draw-count mismatch is invisible in a block of same-kind calls.
- `shuffle(list)` → **Fisher–Yates, descending index**:
  ```
  for i from len-1 down to 1:
      j = randint(i+1)
      swap(list[i], list[j])
  ```
- `choice(list)` → `list[randint(len(list))]`
- `bernoulli(p)` → `random() < p`

### 1.3 Stream separation

A run uses **many independent PCG32 streams**, all seeded from the run seed so
that changing one phase does not perturb another. The stream indices live in
`parity/defaults.json` under `_constants`, so neither engine can drift on them.

| Stream `initseq` | Name | Used for |
|---|---|---|
| 1 | `pax` | Passenger generation: who shows up, parties, bags, speeds, per-passenger time multipliers, status tier |
| 2 | `order` | Boarding-order construction: shuffles within groups |
| 3 | *retired* | Was the single event-ordered `sim` stream. Not reused. |
| `10 + doorIndex` | door arrival | One stream per boarding door, advanced once per release |
| `1000 + paxId*4 + phase` | per-passenger service | One stream per passenger per service phase (below) |

All streams use `initstate = seed`.

#### Why the service draws are per passenger

The `sim` stream used to be a single stream consumed in **event order**: the
first stow to begin took the first Weibull draw, whoever that happened to be.
That made a passenger's own service time a function of **when they boarded**,
which is precisely the thing a strategy comparison is trying to vary. Common
random numbers were therefore only partial — the manifest was shared, but only
about a fifth of passengers kept their stow time across a change of ordering,
the residual correlation collapsed for strategies far from the baseline, and a
paired confidence interval could come out **wider** than the unpaired one.

Every service draw now comes from a sub-stream keyed on the **passenger id** —
which is assigned in canonical seat order off the `pax` stream and is therefore
the same person under every strategy — so the same traveller draws the same
stow time, the same shuffle movements and the same bin behaviour whenever they
board.

**Phases, and why they are separate streams.** Within a passenger's block:

| Phase | `initseq` | Draws, in order |
|---|---|---|
| 0 | `base + id*4 + 0` | Stow duration: one Weibull(shape, scale) per bag, `bags` of them |
| 1 | `base + id*4 + 1` | Bin search: one Bernoulli(0.5) per bag that did not fit, choosing which way to search first |
| 2 | `base + id*4 + 2` | Seat shuffle: one Triangular(min, mode, max) per elementary movement |
| 3 | `base + id*4 + 3` | Boarding behaviour: Bernoulli(nonComplianceRate), then — only if that came up — randint(2*jitter+1), then Bernoulli(lateRate) |

Phases 1 and 2 consume a number of draws that legitimately depends on the
boarding order: how many bin searches you make depends on who filled the bin
above your row, and how many shuffle movements you make depends on who is
already sitting there. If all four phases shared one stream, that variable
count would shift every later draw and reintroduce exactly the order dependence
this exists to remove. Separate streams contain it.

Phase 3's draw count depends only on its own first Bernoulli, which is itself
invariant, so the whole sequence is deterministic per passenger.

**Door arrivals are keyed on the door, not the passenger**, because that is what
they are a property of: the k-th person to reach a given door waits the k-th
drawn gap, whoever that person turns out to be. Door assignment is a function of
the seat map, so each door's passenger *count* is the same under every strategy
and the whole drawn arrival schedule cancels in a paired comparison. The
*realised* entry times can still slip later than the drawn ones — nobody can
step through a doorway somebody is still standing in — and that slip is genuine
aisle backpressure, not RNG.

#### What is deliberately still order-dependent

Three things, all of them the effect being measured rather than noise to cancel:

* **Bin congestion.** Stow duration carries a `(1 + binCongestionWeight * fill²)`
  term, and `fill` — how full the bin above your row is when you reach it —
  depends on who boarded first. Under shipped defaults this is why roughly a
  third of passengers do *not* keep an identical stow time across a change of
  ordering. With `binCongestionWeight = 0` and roomy bins the match is 100%.
* **Shuffle movement count.** How many people you climb over depends on who is
  already seated. The *durations* come from a fixed per-passenger sequence, so
  two runs that produce the same movement count produce the same shuffle time.
* **Within-group shuffles** on the `order` stream. These are part of the
  strategy's definition — "random within the called group" — not an artefact.

---

---

## 2. Aircraft model

```
Aircraft {
  id, name, manufacturer, description,
  seatPitchIn: number,            // default economy pitch, inches
  aisleCount: 1 | 2,
  cabins: Cabin[],
  doors: Door[],
  monuments: Monument[],          // galley/lavatory banks: real cabin length, no seats
  binBagsPerRowSide: number,      // overhead bag slots per row, per bin run (see 2.1)
  defaultConfig?: object,         // per-airframe config overrides, applied under user overrides
}

Monument {
  afterRow: number,               // sits immediately AFT of this row number
  lengthM: number,
}

Cabin {                            // a contiguous class section
  id, name,                        // e.g. "economy", "Main Cabin"
  classKey: 'first'|'business'|'premium'|'economy',
  rows: number[],                  // EXPLICIT list of row numbers, e.g. [7,8,9,11,12] (13 skipped)
  layout: string[],                // e.g. ["A","B","C","|","D","E","F"]  ('|' = aisle)
  pitchIn: number,
  exitRows: number[],              // subset of rows that are overwing exits
  missingSeats: string[],          // "12A" style, seats that do not exist
}

Door {
  id, name,                        // "1L", "2L", "4L"
  rowBefore: number|null,          // door sits immediately FORWARD of this row number
  aisleIndex: number,              // which aisle it feeds (0-based)
  kind: 'jetbridge'|'airstair'|'service'|'overwing',
  boardable: boolean,             // service doors and overwing hatches are exits, NOT boarding doors
  defaultEnabled: boolean,
}
```

### 2.1 Derived geometry

Let the cabin's rows, in physical order fore→aft, be `R[0..N-1]`.
`slot(i)` = the i-th physical row slot (0-based, contiguous — this is the index
used for geometry; the printed row *number* may skip values).

- Row `i` is at longitudinal position `x_i = sum over j<i of (pitch(j) + monument(j))`
  metres, where `pitch(i) = pitchIn(row i) * 0.0254` and `monument(j)` is the
  declared length of any monument sitting aft of row slot `j` (0 if none).
- **Two kinds of gap, and they behave differently.** A skipped row *number* (the
  superstitious 13, or renumbering between cabins) costs **no** cabin length: it
  never appears in the row-slot list at all. A galley or lavatory bank is real
  metres of aisle that a passenger has to walk down, and is declared as a
  `monument`. Conflating the two is the classic way to get a widebody's walking
  distances wrong by several metres.
- The door for `rowBefore = r` sits at `x = x_{slot(r)} - 0.5 * pitch(slot(r))`.
  A door with `rowBefore = null` (rear door) sits at `x = x_{N-1} + 0.5*pitch(N-1)`.
- **Aisle lanes.** `layout` contains one or two `'|'` markers. Aisle index `k` is
  the lane at the k-th `'|'`. Every seat letter is assigned to the aisle it is
  nearest to in the layout array (ties → lower index).
- **Seat depth** `depth(seat)` = number of seats between it and its serving aisle,
  counting the seat itself as depth 1. Aisle seat → 1, middle → 2, window → 3.
  In a 2-2 layout: aisle seat → 1, window → 2.
  In a 3-4-3 middle block `D E F G` with aisles at both sides: D→1, E→2 (aisle 0);
  G→1, F→2 (aisle 1).
- **Blocks.** A seat's *block* is `(serving aisle, which side of it)`. This is the
  unit a passenger climbs across and the unit the seat-shuffle model reasons
  about, so D/E and F/G in a 3-4-3 centre section are two different blocks even
  though they are one physical run of seats. Blocks are numbered in layout order.
- **Bin runs.** A seat's *bin run* is the maximal group of seats between two
  aisles, or between an aisle and the fuselage — a 3-4-3 row has three runs, a
  3-3 row has two. This is what an overhead bin physically spans, and it is what
  `binBagsPerRowSide` is per. A run with no surviving seats at a given row (the
  tapered tail of a 787, the galley side of 737 row 1) has no bin either, so its
  capacity there is zero.
- **Seat kind** (`Window` / `Middle` / `Aisle`) is a label, not a coordinate, and
  is *not* derivable from depth: in a 1-2-1 business cabin the A seat is a window
  with direct aisle access, so it is kind `Window` at depth 1. A seat is a window
  iff it sits at the outboard end of an outboard run; otherwise it is an aisle
  seat iff depth is 1; otherwise a middle.

### 2.2 Physical constants

| Constant | Value | Note |
|---|---|---|
| `BODY_DEPTH` | 0.40 m | min centre-to-centre spacing of two people in an aisle. Chosen so the 1-D jam density reproduces Weidmann's 5.4 pers/m^2; it is the near-universal cell size in the CA boarding literature and must not be rescaled to make a calibration test pass |
| `DESIRED_HEADWAY` | 0.85 m | free space at which a walker reaches free-flow speed (so ~1.25 m centre to centre) |
| `MIN_SPEED_FRACTION` | 0.15 | floor on the density slowdown, as a fraction of free speed |
| `INCH` | 0.0254 m | |
| `dt` | 0.10 s | fixed simulation step |
| `MAX_SIM_SECONDS` | 7200 s | hard stop guard |

Service durations are converted to **whole ticks** — `ceil(duration/dt - 1e-9)` —
rather than compared against an accumulating float clock. Integer tick
arithmetic is what stops the two implementations drifting apart over a
10,000-step run.

---

## 3. Passenger model

```
Passenger {
  id: int,                    // 0..n-1, assigned in seat-map order (stable)
  seat: {rowNumber, letter, cabinId, aisleIndex, depth, x},
  partyId: int,               // travellers who board together
  bags: 0|1|2,
  walkSpeed: m/s,             // free-flow
  stowMultiplier: float,      // per-person dexterity factor, mean 1
  isPreboard: bool,           // wheelchair / assistance / UM
  isSlow: bool,               // reduced mobility (not preboard)
  hasChild: bool,
  tier: string,               // fare/status tier key, used by strategies
  groupLabel: string,         // assigned by the boarding strategy
  boardingIndex: int,         // position in the final boarding sequence
  doorId: string,             // which door they use
}
```

### 3.1 Generation (stream `pax`) — exact order

1. Build the full seat list in **canonical order**: cabins in declared order;
   within a cabin, rows fore→aft; within a row, layout order left→right
   (skipping `'|'` and `missingSeats`). Assign `seatIndex` 0..S-1.
2. **Occupancy.** `nPax = round(loadFactor * S)`, clamped to `[0, S]`.
3. **Party formation.** Draw party sizes until their sum ≥ `nPax`:
   for each party, `size = weightedPick(partySizeWeights)` using one
   `random()` draw against the cumulative weights; truncate the final party so the
   sum equals `nPax`.
4. **Seat assignment.** Copy the seat list, `shuffle` it, then walk parties in
   order assigning consecutive seats from a **contiguity-preferring** pass:
   for each party of size k, scan the shuffled seat list for the first seat whose
   row has ≥ k free seats on one side of an aisle; take k of them left-to-right.
   If none, take the first k free seats in shuffled order. (This makes families
   sit together, as real seat-assignment does.)
5. **Per-passenger attributes**, iterating passengers in ascending `id`
   (i.e. canonical seat order — NOT party order), drawing in exactly this order:
   1. `bags` — weighted pick from `bagWeights` (one `random()`)
   2. `walkSpeed` — `truncnormal(walkSpeedMean, walkSpeedSd, 0.20, 2.00)`
   3. `stowMultiplier` — `truncnormal(1.0, stowVariability, 0.35, 3.00)`
   4. `isPreboard` — `bernoulli(preboardRate)`
   5. `isSlow` — `bernoulli(slowPaxRate)` (only if not preboard; the draw is
      still consumed either way)
   6. `hasChild` — `bernoulli(childRate)` if party size ≥ 2 else false
      (draw always consumed)
6. **Tier assignment.** Seats in a `first`/`business`/`premium` cabin get that
   cabin's class as their tier. Economy passengers are assigned status tiers by
   drawing `random()` per passenger in ascending id and bucketing against
   `eliteMix` cumulative weights — **tilted toward the front of the cabin** by
   `eliteForwardBias`.

   The tilt: with `f = 1 - 2 * rowSlot / (nRowSlots - 1)` running +1 at the nose
   to -1 at the tail, the weights of `elite_top`, `elite_mid` and `cardholder`
   are multiplied by `max(0, 1 + bias*f)` and the weight of `basic` by
   `max(0, 1 - bias*f)`. `standard` is untouched. The cumulative weights are
   renormalised by the weighted pick, so the cabin-wide mix is unchanged and
   only its distribution down the cabin moves. `eliteForwardBias = 0` reproduces
   the uniform draw exactly. **Exactly one `random()` either way**, so the draw
   count does not depend on the bias.

   This is not cosmetic. Status flyers sit in the forward economy rows —
   Comfort+, Main Cabin Extra, Economy Plus — and premium cabins are forward by
   definition, so a scheme that boards by status is boarding the front of the
   aircraft first, which is close to the worst possible order. Modelling status
   as uniform over the cabin made every status-ordered strategy look markedly
   better than it is. See RESEARCH_AIRLINES §7 #6.

A slow passenger's `walkSpeed` is multiplied by `slowSpeedFactor` and their
`stowMultiplier` by `slowStowFactor` after step 5.

---

## 4. Boarding strategies

A strategy is a pure function:

```
buildOrder(passengers, aircraft, params, rngOrder) -> Passenger[]   // the queue
```

It assigns `groupLabel` and returns the passengers in boarding sequence.

**Universal post-processing**, applied by the engine to every strategy's output
(in this order):

1. **Preboards first.** All `isPreboard` passengers are lifted to the front,
   preserving relative order, and labelled `Preboard`. (Disable with
   `preboardFirst=false`.)
2. **Party cohesion.** If `keepPartiesTogether`, each party boards at the
   position of its **earliest-ordered** member, contiguously, ordered within the
   party by `depth` descending (window first — parties self-organise).
3. **Non-compliance.** With probability `nonComplianceRate` per passenger
   (draw in queue order, stream `order`), a passenger is displaced by
   `k = randint(2*complianceJitter+1) - complianceJitter` positions
   (a stable sort on `index + k`). Models people who ignore their group.
4. **Late arrivals.** With probability `lateRate`, a passenger is moved to the
   very end of the queue (preserving relative order among late arrivals).

### 4.1 Door-aware spatial ordering

Every strategy with a spatial component measures position **from the door the
passenger will actually use**, not from the nose of the aircraft.

This matters only when more than one boarding door is open, and then it matters
a lot. "Board the rear zone first" is far-end-first at 1L and **near-end-first
at 2L**, and near-end-first is the front-to-back pathology applied to half the
aircraft. The `doorSequencing` metric (§7) exists to measure exactly that, and
it was scoring the headline strategy badly at the aft door: on the shipped
two-door a320neo default, `common_sense_5tier` measured *slower* than a
free-for-all while beating it comfortably through one door.

The rule: the cabin is partitioned between the boarding doors by the same
`SeatDoorSplit` the engine uses to assign them (§5 -- shared code, so a
strategy's idea of a region and the engine's idea of a door cannot drift);
within each region a passenger's rank runs from the far end of that region
toward its door; bands are cut inside each region; and band *k* of every region
is called together, so both doors are fed at once rather than one standing idle.
With two doors on a single-aisle cabin the practical effect is that boarding
works **outward from the middle** instead of back to front.

It applies to `back_to_front`, `front_to_back`, `wilma_zoned`, `rotating_zone`,
`block_boarding`, `reverse_pyramid`, `steffen_perfect`, `common_sense_5tier` and
`southwest_2026`. It does not apply to `random`, `wilma`, `steffen_modified`,
`by_bags`, `slowest_first`, `priority_5tier` or `open_seating`, none of which
orders by position along the cabin. `steffen_perfect` is a special case: its
outer loop is side x parity x depth and each WAVE sweeps far-to-near
independently, so the far-end-first property holds per wave rather than across
the queue.

**With one boarding door -- or `doorAssignment: "single"`, or
`doorAwareZones: false` -- there is one region spanning the whole cabin and
every strategy takes the old cabin-wide code path verbatim.** Verified: all 288
single-door boarding queues (6 aircraft x 16 strategies x 3 seeds) are identical
to the cabin-wide implementation, and every single-door calibration figure in
RESEARCH_PARAMETERS §12.3 is therefore untouched.

`doorAwareZones: false` restores the naive cabin-wide ordering. It is kept
because the contrast is the clearest demonstration of what `doorSequencing`
measures, and because every published zone scheme actually describes the naive
version.

### 4.2 Implemented strategies

| key | Name | Description |
|---|---|---|
| `random` | Random / free-for-all | Full shuffle. The literature's surprising baseline. |
| `back_to_front` | Back-to-front zones | `zoneCount` contiguous row blocks, rear block first, random within block. |
| `front_to_back` | Front-to-back zones | The pathological worst case; included for contrast. |
| `wilma` | WilMA (outside-in) | All windows, then all middles, then all aisles; random within each. |
| `wilma_zoned` | WilMA + zones | Outside-in, and within each seat-column band, back-to-front by `zoneCount`. |
| `steffen_perfect` | Steffen (perfect) | Alternating rows, window→aisle, alternating sides. Theoretical optimum. |
| `steffen_modified` | Steffen (modified / practical) | 4 boarding groups: window-even, window-odd, middle+aisle-even, middle+aisle-odd, by side. Gate-implementable. |
| `reverse_pyramid` | Reverse pyramid | Diagonal wave from rear-window to front-aisle. Used by America West. |
| `rotating_zone` | Rotating zone | Alternates rear zone / front zone to spread the aisle load. |
| `block_boarding` | Block (by zone, random) | The classic 4-5 zone airline scheme. |
| `open_seating` | Open seating (Southwest, 1971-2026) | No assigned seats; passengers pick per `openSeatingPolicy`. Retired: Southwest ended it 27 Jan 2026. |
| `priority_5tier` | 5-tier priority (revenue) | Preboard → First/Business → Elite+Group1 → Group2 → Group3 → Group4. Realistic revenue-driven order. |
| `common_sense_5tier` | 5-tier common sense | Outside-in × back-to-front within economy, with fare/status merged **into** the group assignment. Party cohesion forced on. The "best boarding you could actually sell". |
| `southwest_2026` | Southwest 2026 | WilMA × back-to-front projected onto 8 groups, with fare/status shifting whole groups. The real converged design, live since 27 Jan 2026. Party cohesion forced on. |
| `by_bags` | Bag-count boarding | Zero-bag passengers first, then 1 bag, then 2. |
| `slowest_first` | Slowest first | Sorted by expected service time descending. |

`open_seating` is special: passengers have **no seat** until they enter. See §6.5.

Two strategies set `requiresCohesion`, which forces `keepPartiesTogether` on for
the run regardless of the config: `common_sense_5tier` and `southwest_2026`. For
everything else party cohesion is a friction knob you turn off to see what the
method would be worth if families did not exist. For a scheme whose group
assignment is a joint function of seat location and fare it is part of the
construction — every carrier that boards that way promotes the whole booking to
its earliest-boarding member (United's "same and highest applicable",
Lufthansa's "and companions") — so a run with it off is not a model of anything
operated. Cohesion is **promote-to-earliest**: the party is emitted whole at the
queue position of whichever member the strategy called first.

---

## 5. Doors

`doorAssignment` decides which enabled door each passenger uses:

- `single` — everyone uses the first enabled door.
- `split_by_row` — the cabin is divided at the midpoint between consecutive
  doors; a passenger uses the door whose serving region contains their row.
- `split_by_aisle` — (twin-aisle only) passengers use the door feeding their
  seat's aisle; ties broken by row.

Only doors with `boardable = true` may be enabled; asking to board through a
service door or an overwing hatch is a configuration error, and so is enabling
none. Enabled doors are processed in the roster's declaration order, never in
the order the caller happened to list them.

The three rules above live in **one** place, `aircraft.SeatDoorSplit`, and are
imported by both the engine (which stamps `doorId`) and the boarding strategies
(which need to know a passenger's door before they can order them relative to
it — §4.1). Two copies that drifted apart would put a strategy's idea of a
region and the engine's idea of a door out of step, and the resulting queue
would be wrong in a way no single-engine test could see.

Open seating is the exception and is handled separately: nobody has a seat yet,
so the split is a queue quota proportional to each door's region capacity rather
than a geometric partition. That quota is what stops two streams walking head-on
down a single-file aisle.

Each door has its own independent jetbridge queue. A passenger is released into
the aisle when **both**:

  (a) the aisle at the door position is clear by `BODY_DEPTH` in the lane that
      passenger will use, and
  (b) that passenger has arrived at the door.

Arrival at the door is a **Poisson process**: inter-arrival time is
`exponential(doorArrivalMean)`, drawn once per release (stream `sim`), with mean
3.7 s from Schultz's field measurements.

> **The arrival clock is cumulative and runs in PARALLEL with aisle congestion,
> not in series.** On each release the door's arrival clock advances by
> `arrival_tick += ceil(exponential(doorArrivalMean) / dt)` — it is *not* reset
> to the current tick. People keep piling up on the jetbridge while the aisle is
> jammed, and the backlog then walks on back-to-back. Adding the door delay to
> the blocking delay instead of overlapping them roughly doubles modelled
> boarding time; this was the single largest calibration error in the first cut
> of the engine and it is worth restating loudly.

The global boarding sequence is preserved *within* each door's queue: a
passenger with a lower `boardingIndex` always enters their own door first, but
two doors run in parallel.

---

## 6. Simulation loop

State per passenger: `QUEUED → WALKING → STOWING → SHUFFLING → SEATED`.

Each tick of `dt`:

**(a) Release from door queues** — for each door in `id` order.

**(b) Move walkers** — within each aisle lane, process passengers in **descending
distance-travelled order** (the one furthest along moves first, so a follower
sees the leader's updated position within the same tick).

For a walking passenger `p` heading in direction `dir` (+1 aft, −1 fore):
```
free    = p.walkSpeed * dt                      # unobstructed
blocker = nearest passenger ahead in the same lane (any non-SEATED state)
if blocker exists:
    gap = max(0, |blocker.x - p.x| - BODY_DEPTH)
else:
    gap = infinity
desired = free * densityFactor(gap)             # see below
allowed = min(desired, gap)
step    = min(allowed, |p.targetX - p.x|)
p.x += dir * step
if allowed < free: p.blockedTime += dt * (1 - allowed/free)
if |p.x - p.targetX| < 1e-9: begin STOWING (or skip to seat, see below)
```

`blockedTime` is measured against **free flow**, so it captures the density
slowdown as well as a hard stop. `|p.targetX - p.x|` is deliberately excluded
from that comparison: the final partial step onto your own row is arrival, not
obstruction, and counting it would give a lone passenger on an empty aircraft a
non-zero blocked time.

**Density-dependent speed.** Effective speed is
`p.walkSpeed * min(1, gapAhead / DESIRED_HEADWAY)` clamped to
`[0.15, walkSpeed]` where `DESIRED_HEADWAY = 0.85 m`. This reproduces the
observed speed/density fundamental diagram instead of a binary stop/go.

**(c) Stowing.** On arrival at the target row a passenger occupies the aisle for
`t_stow`. Luggage time is **per piece**, summed (stream `sim`):
```
if bags == 0: t_stow = 0
else:
    t_stow = sum over each bag of weibull(stowWeibullShape, stowWeibullScale)
    t_stow *= p.stowMultiplier
    t_stow *= binPenaltyFactor(row)      // §6.4, evaluated BEFORE this
                                         //       passenger's bags are placed
    t_stow += binSearchPenalties(row)    // §6.4
```
`Weibull(shape 1.7, scale 16.0 s)` is Schultz's field fit for stowing **one**
piece: mean 14.3 s, sd 8.6 s, against a measured field mean of 13.9 s. Summing
independent per-piece draws is what gives the right super-linear variance for a
two-bag passenger — there is no exponent term and none is needed.

**(d) Seat shuffle — the elementary-movement model.** After stowing, collect
`blockers` = already-SEATED passengers in the same row and the same **block**
(§2.1) at strictly smaller `depth` than `p`, i.e. physically between `p` and the
aisle. The cost is an integer number of *elementary movements* — stand, step
out, step back, sit — each `triangular(shuffleMoveMin, shuffleMoveMode,
shuffleMoveMax)` = `Triangular(1.8, 2.4, 3.0)` s, drawn independently and summed:

| Situation | key | movements | mean |
|---|---|---|---|
| No blockers — just sit down | `none` | 1 | 2.4 s |
| Aisle seat occupied, target is the middle | `aisle` | 4 | 9.6 s |
| Aisle seat occupied, target is the window, middle free | `aisle` | 4 | 9.6 s |
| Middle occupied, target is the window, aisle free | `middle` | 5 | 12.0 s |
| Aisle AND middle occupied, target is the window | `both` | 9 | 21.6 s |
| All blockers share `p.partyId` | — | `shuffleSamePartyMovements` = 2 | 4.8 s |

```
depths = set of blocker depths
if depths is empty:                       m = shuffleMovements.none
elif all blockers share p.partyId:        m = shuffleSamePartyMovements
elif 1 in depths and any(d >= 2):         m = shuffleMovements.both
elif any(d >= 2):                         m = shuffleMovements.middle
else:                                     m = shuffleMovements.aisle
t_shuffle = (sum of m triangular draws) * p.stowMultiplier
```

Two things about this model matter more than they look. First, the penalty
depends on **which** seat blocks, not merely how many — 5 movements for a
middle-blocked window against 4 for an aisle-blocked one. Second, `none` is
**1 movement, not 0**: every passenger pays ~2.4 s simply to sit down, and on a
full narrowbody that is several minutes of aisle occupancy in aggregate. A
2-2 or 1-2 cabin has no depth-3 seat, so its worst case is the 4-movement one.

The passenger blocks the aisle for the whole shuffle, then becomes SEATED and is
removed from the lane.

### 6.3 Partial blocking while stowing (`stowPassSpeedFactor`)

A passenger stowing a bag does not stand in the middle of the aisle: they step
into the seat-row gap and reach up. The aisle narrows; it does not close. People
routinely edge past someone loading a bin.

`stowPassSpeedFactor` models that. When it is **> 0**:

* A **STOWING** passenger is a *soft* obstruction. Exactly one follower at a
  time may squeeze past them, moving at `stowPassSpeedFactor x walkSpeed` while
  alongside. The mutual exclusion is a per-stower lock, taken on entering the
  squeeze and released once the passer is a full `BODY_DEPTH` beyond.
* A follower may only squeeze past if their **own seat is further on**. Two
  passengers bound for the same row still queue: there is one aisle position to
  stand in and they both need it.
* Squeezing does not license a collision. The passer is still bounded by the
  first non-stowing body beyond the stower.
* Once a stow finishes, the squeeze closes to new entrants and the transition to
  SHUFFLING waits for the current passer to clear. Seated occupants cannot stand
  up into somebody who is edging past, and closing the squeeze first bounds that
  wait to one passer rather than letting heavy traffic starve the stower.
* A **SHUFFLING** passenger always blocks completely, whatever this parameter is
  set to. When the aisle and middle occupants stand up to let a window passenger
  in, they are physically in the aisle. This asymmetry is the point of the
  mechanism: it makes seat interference strictly more expensive than bag
  stowing, which is the effect outside-in methods exist to exploit.

When it is **0** a STOWING passenger is a hard obstruction and the model
reduces exactly to the strict-blocking process described above. That setting is
Schultz's own cellular behaviour and is kept as a first-class option, labelled
*strict aisle blocking (Schultz-comparable)*; the `schultz_reference` parity
fixture pins it explicitly so it cannot drift when the default moves.

**Shipped default: 0.40.** Calibrated so that single-door boarding lands on
Schultz's field regression. The strict model overshoots it by ~50%, and the
regression describes single-door jetbridge operations, which are the most common
boarding in the world and the thing the product's headline number reports. The
cost is that strategy advantages compress toward parity -- Steffen reads a 16%
saving where Schultz's realistic figure is 20-25% -- because a shorter queue
behind a stower makes avoiding a stow-block worth less, and that is most of what
outside-in and Steffen buy you. Ordering is unaffected and both twin-aisle
findings survive. Full sweep and reasoning: docs/RESEARCH_PARAMETERS.md 12.3.

**On the handover.** The squeeze lock passes to the next follower when the
outgoing passer's next obstruction changes, not when they are fully clear. So
two people can briefly be within a body depth of one stower -- but on opposite
sides of them, still a body depth apart from each other, one finishing and one
starting. Holding the lock until fully clear is the obvious alternative and it
deadlocks: a passer that cannot advance would pin the stower indefinitely.

### 6.4 Overhead bin model

Each `(rowSlot, binRun)` has `binBagsPerRowSide` slots — see §2.1 for what a bin
run is. Capacity is a property of the **airframe**, declared per aircraft, and
varies enormously: 1 bag per row-side on a legacy E175 against 4 on an A320neo
with Airspace XL bins. A config-level `binBagsPerRowSide` overrides the airframe
when set.

A passenger stowing `b` bags at row `r` consumes `b` slots from their own run.
If the run is full at their row, they search outward `r±1, r±2, … r±binSearchRadius`
(one `bernoulli(0.5)` per search event, stream `sim`, decides which direction is
tried first), adding `binSearchPenalty` seconds per row of displacement. If
nothing is found within the radius the bag is **gate-checked**: `gateCheckPenalty`
seconds and the bag is removed. Every search and every gate-check is counted.

> These constants are **extrapolation, not literature**. No peer-reviewed
> boarding paper publishes a walk-back or gate-check time penalty; see
> docs/RESEARCH_PARAMETERS.md §7 and §12.2.

`binPenaltyFactor(row)` returns `1 + binCongestionWeight * (fillFraction)^2` to
model the extra fiddling in a nearly-full bin.

### 6.5 Open seating

Passengers with no assigned seat choose one on arriving at the cabin entrance:
- `aisle_first` — prefer, in order: aisle seat nearest the front, then window,
  then middle.
- `window_first` — prefer windows fore→aft, then aisles, then middles.
- `front_first` — nearest free seat to the door, any letter.
- `avoid_neighbours` — maximise distance to the nearest already-seated
  passenger; ties broken by proximity to the door.

The choice happens at the moment the passenger crosses the door line, so it
depends on who is already seated — which is exactly the real dynamic.

**What these four policies do not model, and what that costs.** Every one of
them chooses on **position or spacing alone**. None models *interference*
avoidance — declining a seat because it means climbing over a stranger, or
because it will make a stranger climb over you — which is the self-selection
usually credited with making open seating quick, and which would produce
window-first filling for free.

The consequence is visible and it is not a bug: `open_seating` is the slowest
strategy in the model on every aircraft. `front_first` is the extreme case at
3.37× random on a single-door a320neo, and the mechanism is real rather than an
artefact — if everyone takes the first free seat, the free frontier is one row
wide, the passenger stowing is always standing exactly where the next passenger
must walk, and the boarding serialises completely. `avoid_neighbours` (the
shipped default) avoids that and pays for it in walking, landing at 1.46×.

Adding an interference-avoiding policy needs a source for how real passengers
trade the two off, and no reachable paper publishes one, so it is recorded as a
known limitation (RESEARCH_PARAMETERS §12.2) rather than guessed at. One
plausible-looking repair was measured and rejected: reserving a seat for spacing
purposes when it is *chosen* rather than when it is *sat in* — which removes the
opening phase in which nobody is seated yet and every arrival therefore ties —
makes `avoid_neighbours` worse, 1.46× → 1.76×, not better.

---

## 7. Metrics

```
RunResult {
  totalSeconds, totalMinutes,
  strategy, aircraftId, seed, paxCount, seatCount, loadFactor,
  seatedCurve:     [{t, seated}],          // sampled every `sampleInterval` s
  aisleOccupancy:  [{t, count}],
  congestion:      number[][],             // [rowSlot][timeBucket] integer body count
  perPassenger: [{
      id, seat, row, letter, depth, tier, groupLabel, doorId, bags, party,
      enterTime, sitTime, timeInAisle, walkTime, stowTime, shuffleTime, blockedTime,
      queueWaitTime, blockers, gateChecked
  }],
  timeBreakdown: {walk, stow, shuffle, blocked},   // pax-seconds, summed
  interference: {none, one, two, sameParty},        // counts
  gateChecks, binSearches, gateCheckRate,           // rate = gateChecks/paxCount
  aisleBlockEvents,
  p50AisleSeconds, p90AisleSeconds, maxAisleSeconds,
  p50BoardingWaitSeconds, p90BoardingWaitSeconds,
  p50TimeToSeat, p90TimeToSeat, maxTimeToSeat,   // deprecated aliases of the aisle trio
  throughputPaxPerMin,
  doors, completed,
  doorStats:      {doorId: {count, meanWalk, farFirst}},
  doorSequencing: number,
}
```

Notes on a few fields that are easy to read the wrong way:

- **Wait statistics.** "Time to seat" is two different questions and the field
  names now say which is which, because conflating them is what produced a
  reported "worst time to seat" that was identically `totalSeconds`.

  - **`p50/p90/maxAisleSeconds`** are percentiles of `sitTime - enterTime`: the
    time from stepping through the aircraft door to sitting down. This is the
    per-passenger `timeInAisle`, aggregated. It answers *"how long was I stuck
    in the aisle"*, and it is the quantity the passenger-wait chart plots,
    because a fast mean hiding a miserable tail is the thing that chart exists
    to show.
  - **`p50/p90BoardingWaitSeconds`** are percentiles of `sitTime`: the wait from
    doors-open to seated, jetbridge queue included. It answers *"how long was I
    waiting overall"*. The per-passenger `queueWaitTime` is the jetbridge half
    of it on its own.
  - There is **no `maxBoardingWaitSeconds`**, deliberately. The last passenger
    to sit down sits at `totalSeconds` by construction, so its maximum is the
    run length restated and carries no information. `maxAisleSeconds` is a real
    statistic — on a320neo/seed 1/single door it is about 200 s against a
    728 s boarding — which is why the maximum is kept for that family and
    dropped for this one.
  - **`p50/p90/maxTimeToSeat`** are retained as deprecated aliases of the aisle
    trio, so existing consumers keep working and now receive the quantity the
    name always claimed. New code should use the explicit names.

  Percentiles are linearly interpolated (`pos = q*(n-1)`, blend the two
  neighbours); both implementations must use that formula rather than a language
  built-in, because built-ins disagree.
- **`interference`** buckets by blocker count, with `sameParty` taking priority:
  `none` if there were no blockers, else `sameParty` if they all shared the
  passenger's party, else `one` or `two`. The four buckets sum to `paxCount`.
- **`aisleBlockEvents`** counts *episodes*, not ticks: it increments when a
  walker transitions from unobstructed to obstructed.
- **`congestion`** is an **instantaneous count of bodies in the aisle in that
  row slot**, sampled at `sampleInterval` -- not a mean over the interval, and
  the field was described as "mean bodies in aisle" for longer than it should
  have been. Per-tick accumulation would mean an O(occupants) row lookup on
  every step for a figure that is only ever plotted; sampling is an unbiased
  estimator of the mean and keeps a 350-passenger run under a second. The
  averaging that does happen is across REPLICATIONS, in `BatchResult`.

  The values are **integers**. Python used to store them as floats, so it
  serialised `0.0` where JavaScript serialised `0` and the replay JSON was not
  byte-comparable between the two engines even though every value agreed.

  **`congestion` is one sample SHORTER than `seatedCurve` and `aisleOccupancy`,
  deliberately.** Those two get a closing sample at the true end time so a plot
  closes on the real boarding time, and they carry an explicit `t` with every
  point, so an off-grid final point is well defined. `congestion` is a bare
  matrix whose column index *is* the time axis: column k means
  `k * sampleInterval`. Appending a closing sample taken at an arbitrary
  fraction of an interval would put a column on the heatmap that does not mean
  what every other column means. The run is over at that point and the aisle is
  empty, so nothing is lost.
- **`doorSequencing`** scores how well the boarding order suits the doors. Per
  door it is the mean distance-from-door of the first half of that door's queue
  minus that of the second half, over the cabin length: positive means the far
  end of that door's region loads first, which is what you want. The reported
  figure is the **worst** door, not the average, because a cabin-wide rear-first
  order scores about +0.25 at a forward door and -0.25 at an aft one and the two
  cancel if averaged -- hiding exactly the effect this is here to measure.
- **`aisleOccupancy`** counts bodies actually in an aisle lane, including the
  closing sample. On an incomplete run that is *not* `paxCount - seated`: the
  difference is everybody still queued on the jetbridge, who are QUEUED rather
  than in the aisle, and counting them put a spike on the end of the chart that
  never happened.
- **`completed`** is false if the run hit `MAX_SIM_SECONDS`. Any consumer that
  averages `totalSeconds` should check it.

`BatchResult` aggregates `n` runs per strategy: mean, sd, min, max, p05/p50/p95
of `totalSeconds`, plus the per-run values for histograms and the pooled
per-passenger distribution.

**Confidence intervals use `t(n-1)`, not a flat 1.96.** 1.96 is the
large-sample limit and this project routinely reports n = 5..25, where it
understates the interval by 41.6% at n=5, 20.7% at n=8 and 12.3% at n=12,
falling below 0.5% only past n≈50. A "95% interval" 40% too narrow changes which
strategy comparisons read as significant, which is the one question the tool
exists to answer. The critical-value table is shared with the charts so the same
quantity cannot be drawn one way and reported another.

### 7.1 Replay document

Two fields are easy to misread, and both were being misread:

- **`duration` is the span of the FRAME BUFFER, not the boarding time.**
  `frames[i]` is the state at `i * frameInterval`. A run almost never ends
  exactly on that grid, so the closing frame -- the terminal state, everybody
  seated -- sits at the first grid point at or after the run end. Reporting
  `totalSeconds` here put a scrubber's right edge one grid step *short* of that
  frame, so the last thing a renderer could draw was a mid-interval frame with
  somebody still shuffling in it while the status bar said all N were seated.
  `result.totalSeconds` remains the boarding time and is what every statistic
  is computed from; `duration` is within one frame interval of it.
- **`partyId` and `partySize` are different numbers**, and the payload used to
  emit the party's *index* under the name `party`. A renderer printing that as a
  size reported "44 together" on an aircraft whose party sizes stop at 5. Both
  are now spelled out; `party` is retained as a deprecated alias and carries the
  SIZE, which is the quantity every consumer was already treating it as.

---

## 8. Configuration object

```
SimConfig {
  aircraftId, strategy, seed,
  loadFactor,                 // 0..1
  doors: string[],            // enabled door ids
  doorAssignment,
  // passenger mix
  bagWeights: {0:w,1:w,2:w},
  partySizeWeights: {1:w,2:w,3:w,4:w,5:w},
  walkSpeedMean, walkSpeedSd,
  preboardRate, slowPaxRate, slowSpeedFactor, slowStowFactor, childRate,
  eliteMix: {tier: weight},
  eliteForwardBias,           // 0..1, forward concentration of status (3.1 step 6)
  // service times
  stowWeibullShape, stowWeibullScale, stowVariability,
  stowPassSpeedFactor,        // 0 = a stowing passenger closes the aisle (default)
  shuffleMoveMin, shuffleMoveMode, shuffleMoveMax,
  shuffleMovements: {none, aisle, middle, both}, shuffleSamePartyMovements,
  doorArrivalMean,
  // bins
  binBagsPerRowSide,          // null = use the airframe's own figure
  binSearchRadius, binSearchPenalty, gateCheckPenalty,
  binCongestionWeight,
  // order shaping
  zoneCount, doorAwareZones, keepPartiesTogether, preboardFirst,
  nonComplianceRate, complianceJitter, lateRate,
  openSeatingPolicy,
  // engine
  dt,                         // seconds; 0 < dt <= MAX_DT (1.0)
  sampleInterval,
}
```

**Rejected values.** The validator refuses scenarios that are not physically
meaningful, not merely out of taste: a negative `stowWeibullScale` made boarding
*faster* (a negative Weibull draw subtracts from the stow clock) and a `dt` of
1e6 reported a 00:00 boarding because every passenger arrived, stowed and sat
inside a single step. Both produced plausible-looking output from a meaningless
scenario, which is the worst failure mode a validator can allow. `dt` is capped
at `MAX_DT`; durations, standard deviations, penalties and rates must be
non-negative; `walkSpeedMean`, `slowSpeedFactor` and `stowWeibullShape` must be
strictly positive. Integer-keyed weight maps follow Python's `int()` exactly, so
a key of `"1.0"` is rejected by both engines rather than by one.

Every field has a documented default in `defaults`. Both implementations import
their defaults from the **same JSON file** `parity/defaults.json` so they cannot
drift, and the aircraft roster from the same `parity/aircraft.json`.

**Config layering**, in this order:

```
parity/defaults.json  ->  aircraft.defaultConfig  ->  user overrides
```

The middle layer exists because a few parameters are properties of the airframe
and its operator rather than of the simulation. The E175 is the motivating case:
with only ~36 bin slots for 76 seats the airline valet-checks most roll-aboards
at the jetbridge *before* anyone steps aboard, so the bag mix that actually
enters that cabin is materially lighter than a mainline flight's. An unknown key
in the user overrides is an error, not a silent no-op.

**Weight maps.** Integer-keyed maps (`bagWeights`, `partySizeWeights`) are read
in ascending numeric key order; string-keyed maps (`eliteMix`) in JSON insertion
order. Both languages preserve those orders, so `weightedPick` consumes the same
single draw against the same cumulative weights in each.

---

## 9. Parity contract

`parity/fixtures.json` holds N configurations. For each, both engines emit a
canonical JSON digest:

```
{ config_hash, geometry_hash, totalSeconds, paxCount, seatCount, doors,
  timeBreakdown, interference, gateChecks, binSearches, aisleBlockEvents,
  seatedCurve (every 10s), first20SitTimes }
```

- `config_hash` is FNV-1a/32 over the fixture config re-serialised canonically
  (keys sorted, no whitespace). Fixture configs must therefore stick to plain
  JSON-round-trippable values — no exponents, no 17-digit floats — since the
  hash is over the *re-serialised* text, not the bytes on disk.
- `geometry_hash` is FNV-1a/32 over every **rounded** value in
  `geometry_payload` — cabin length, every row `x` and `pitch`, every seat `x`,
  every door `x` — plus the identifiers that give them meaning. The digest used
  to stop at the cabin door, so a disagreement between Python's `round(x, 6)`
  and a hand-rolled `Math.round(v*1e6)/1e6` could ship undetected until an
  airframe's pitch happened to land on a rounding tie. It is a **hash** rather
  than a list of numbers precisely because the numeric comparison below has a
  1e-6 tolerance and the disagreement being looked for is exactly 1e-6 wide.
  Floats enter the hash as fixed-point `%.6f` text with `-0.0` normalised,
  because Python prints an integral float as `1.0` and JavaScript prints it
  as `1`.
- `seatedCurve` is resampled onto a fixed **10 s** grid straight from the sit
  times, deliberately not from the engine's own sampled curve: `sampleInterval`
  is a presentation setting and must not leak into the parity contract.
- Every float is rounded to **9 decimal places** before serialisation, and `-0.0`
  is normalised to `0.0`.

Floats are compared with `abs(a-b) <= 1e-6 * max(1,|a|)`.
`npm run parity` / `make parity` runs both and diffs. **CI fails on any mismatch.**

### 9.1 The full diff — what the digest does *not* prove

The digest is a hash of a **summary**. It catches gross divergence and it runs
in seconds, which is why it is the gate. It can also pass while individual
per-passenger records differ, and those differences are exactly what later turns
into a wrong chart.

`python3 parity/compare.py --full` is the check that actually proves the port:

* **16 strategies × 6 aircraft × 4 configurations = 384 scenarios**, each on its
  own seed, covering one door and the aircraft's own door set, both
  door-assignment policies, a full cabin and a light one, and the cabin-wide
  zone fallback.
* Complete `RunResult` documents compared **field by field with no tolerance at
  all** — every per-passenger record, both curves, the congestion matrix, the
  door statistics.

The two emitters (`parity/emit_full_py.py`, `parity/emit_full_js.mjs`) stream
NDJSON so the comparator diffs one scenario at a time; 384 complete results are
tens of megabytes a side. It takes a few minutes. Run it before any release and
after any change to the engine — `make parity` stays the fast gate.
