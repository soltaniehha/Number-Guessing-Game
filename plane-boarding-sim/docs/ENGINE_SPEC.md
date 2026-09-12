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

A run uses **three independent PCG32 streams**, all seeded from the run seed so
that changing one phase does not perturb another:

| Stream | `initseq` | Used for |
|---|---|---|
| `pax`   | 1 | Passenger generation: who shows up, parties, bags, speeds, per-passenger time multipliers |
| `order` | 2 | Boarding-order construction: shuffles within groups, non-compliance, open-seating choices |
| `sim`   | 3 | Runtime draws: stow duration, shuffle duration, gate-scan intervals, bin search |

All three use `initstate = seed`.

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
   `eliteMix` cumulative weights.

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

### 4.1 Implemented strategies

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
| `open_seating` | Open seating (Southwest legacy) | No assigned seats; passengers pick per `openSeatingPolicy`. |
| `priority_5tier` | 5-tier priority (revenue) | Preboard → First/Business → Elite+Group1 → Group2 → Group3 → Group4. Realistic revenue-driven order. |
| `common_sense_5tier` | 5-tier common sense | Revenue tiers honoured only for the cabin, then outside-in × back-to-front within economy. The "best boarding you could actually sell". |
| `by_bags` | Bag-count boarding | Zero-bag passengers first, then 1 bag, then 2. |
| `slowest_first` | Slowest first | Sorted by expected service time descending. |

`open_seating` is special: passengers have **no seat** until they enter. See §6.5.

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

When it is **0** (the shipped default) a STOWING passenger is a hard obstruction
and the model reduces exactly to the strict-blocking process described above.

**Why the default is 0.** Turning the mechanism on brings absolute single-door
boarding time onto Schultz's field regression, which the strict model overshoots
by ~50%. But it also compresses every strategy ratio toward 1.0 -- Steffen moves
from 0.77 to 0.85, outside the published band -- and at 0.30 it inverts the
WilMA/reverse-pyramid ordering and loses the twin-aisle result that reverse
pyramid is best on a B777. Since the product's comparative claims rest on those
ratios and its absolute claims carry a documented offset, the ratios win. The
full experiment is recorded in docs/RESEARCH_PARAMETERS.md 12.3.

**(e) Bookkeeping** — record per-tick aisle occupancy, seated count, and each
passenger's state for the visualization event log.

Termination: all passengers SEATED, or `MAX_SIM_SECONDS` reached.

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

---

## 7. Metrics

```
RunResult {
  totalSeconds, totalMinutes,
  strategy, aircraftId, seed, paxCount, seatCount, loadFactor,
  seatedCurve:     [{t, seated}],          // sampled every `sampleInterval` s
  aisleOccupancy:  [{t, count}],
  congestion:      number[][],             // [rowSlot][timeBucket] mean bodies in aisle
  perPassenger: [{
      id, seat, row, letter, depth, tier, groupLabel, doorId, bags, party,
      enterTime, sitTime, timeInAisle, walkTime, stowTime, shuffleTime, blockedTime,
      queueWaitTime, blockers, gateChecked
  }],
  timeBreakdown: {walk, stow, shuffle, blocked},   // pax-seconds, summed
  interference: {none, one, two, sameParty},        // counts
  gateChecks, binSearches,
  aisleBlockEvents,
  p50TimeToSeat, p90TimeToSeat, maxTimeToSeat,
  throughputPaxPerMin,
  doors, completed,
  doorStats:      {doorId: {count, meanWalk, farFirst}},
  doorSequencing: number,
}
```

Notes on a few fields that are easy to read the wrong way:

- **`p50/p90/maxTimeToSeat`** are percentiles of `sitTime` measured from the
  start of boarding, not of `timeInAisle`. Everyone is queued at t = 0, so this
  is the passenger-experienced wait. Percentiles are linearly interpolated
  (`pos = q*(n-1)`, blend the two neighbours); both implementations must use
  that formula rather than a language built-in, because built-ins disagree.
- **`interference`** buckets by blocker count, with `sameParty` taking priority:
  `none` if there were no blockers, else `sameParty` if they all shared the
  passenger's party, else `one` or `two`. The four buckets sum to `paxCount`.
- **`aisleBlockEvents`** counts *episodes*, not ticks: it increments when a
  walker transitions from unobstructed to obstructed.
- **`congestion`** is sampled at `sampleInterval`, not accumulated every tick.
  Per-tick accumulation would mean an O(occupants) row lookup on every step for
  a figure that is only ever plotted; sampling is an unbiased estimator of the
  same quantity and keeps a 350-passenger run under a second.
- **`doorSequencing`** scores how well the boarding order suits the doors. Per
  door it is the mean distance-from-door of the first half of that door's queue
  minus that of the second half, over the cabin length: positive means the far
  end of that door's region loads first, which is what you want. The reported
  figure is the **worst** door, not the average, because a cabin-wide rear-first
  order scores about +0.25 at a forward door and -0.25 at an aft one and the two
  cancel if averaged -- hiding exactly the effect this is here to measure.
- **`completed`** is false if the run hit `MAX_SIM_SECONDS`. Any consumer that
  averages `totalSeconds` should check it.

`BatchResult` aggregates `n` runs per strategy: mean, sd, min, max, p05/p50/p95
of `totalSeconds`, plus the per-run values for histograms and the pooled
per-passenger distribution.

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
  zoneCount, keepPartiesTogether, preboardFirst,
  nonComplianceRate, complianceJitter, lateRate,
  openSeatingPolicy,
  // engine
  dt, sampleInterval,
}
```

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
{ config_hash, totalSeconds, paxCount, seatCount, doors,
  timeBreakdown, interference, gateChecks, binSearches, aisleBlockEvents,
  seatedCurve (every 10s), first20SitTimes }
```

- `config_hash` is FNV-1a/32 over the fixture config re-serialised canonically
  (keys sorted, no whitespace). Fixture configs must therefore stick to plain
  JSON-round-trippable values — no exponents, no 17-digit floats — since the
  hash is over the *re-serialised* text, not the bytes on disk.
- `seatedCurve` is resampled onto a fixed **10 s** grid straight from the sit
  times, deliberately not from the engine's own sampled curve: `sampleInterval`
  is a presentation setting and must not leak into the parity contract.
- Every float is rounded to **9 decimal places** before serialisation, and `-0.0`
  is normalised to `0.0`.

Floats are compared with `abs(a-b) <= 1e-6 * max(1,|a|)`.
`npm run parity` / `make parity` runs both and diffs. **CI fails on any mismatch.**
