# Plane Boarding Simulator — Canonical Engine Specification

**Version:** 1.0
**Status:** Normative. Two implementations exist and MUST agree bit-for-bit:
- `python/plane_boarding/` (reference, batch/research)
- `web/src/sim/` (browser, visualization + Monte Carlo in a Web Worker)

Any behavioural difference between the two is a **bug**. The parity harness in
`parity/` runs both against shared fixtures and compares full metric output.

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
  binBagsPerRowSide: number,      // overhead bag slots per row, per side of the cabin
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
  kind: 'jetbridge'|'airstair',
  defaultEnabled: boolean,
}
```

### 2.1 Derived geometry

Let the cabin's rows, in physical order fore→aft, be `R[0..N-1]`.
`slot(i)` = the i-th physical row slot (0-based, contiguous — this is the index
used for geometry; the printed row *number* may skip values).

- Row `i` is at longitudinal position `x_i = sum of pitch(0..i-1)` metres,
  where `pitch(i) = pitchIn(row i) * 0.0254`.
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

### 2.2 Physical constants

| Constant | Value | Note |
|---|---|---|
| `BODY_DEPTH` | 0.40 m | min centre-to-centre spacing of two people in an aisle |
| `INCH` | 0.0254 m | |
| `dt` | 0.10 s | fixed simulation step |
| `MAX_SIM_SECONDS` | 7200 s | hard stop guard |

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

Each door has its own independent queue. The engine releases from a door's queue
when (a) the aisle cell at the door position is clear by `BODY_DEPTH`, and
(b) the door's gate-scan timer has elapsed. Gate-scan interval is
`lognormal(gateScanMean, gateScanSd)` drawn per release (stream `sim`).

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
desired = p.speed * dt
blocker = nearest passenger ahead in the same lane (any non-SEATED state)
if blocker exists:
    gap = |blocker.x - p.x| - BODY_DEPTH
    allowed = max(0, gap)
else:
    allowed = infinity
step = min(desired, allowed, |p.targetX - p.x|)
p.x += dir * step
if step < desired: p.blockedTime += dt * (1 - step/desired)
if |p.x - p.targetX| < 1e-9: begin STOWING (or skip to seat, see below)
```

**Density-dependent speed.** Effective speed is
`p.walkSpeed * min(1, gapAhead / DESIRED_HEADWAY)` clamped to
`[0.15, walkSpeed]` where `DESIRED_HEADWAY = 0.85 m`. This reproduces the
observed speed/density fundamental diagram instead of a binary stop/go.

**(c) Stowing.** On arrival at the target row a passenger occupies the aisle for
`t_stow`, drawn once (stream `sim`):
```
if bags == 0: t_stow = 0
else:
    base = stowBaseMean * bags^stowBagExponent
    t_stow = lognormal(base, base * stowCv) * p.stowMultiplier
    t_stow *= binPenaltyFactor(row)      // §6.4
```
`stowBagExponent` defaults to 0.85 (two bags are less than twice one bag).

**(d) Seat shuffle.** After stowing, count `blockers` = seated passengers in the
same row, same side of the aisle, at strictly smaller `depth` than `p`
(i.e. between `p` and the aisle). Then:
```
sameParty = all blockers share p.partyId
if blockers == 0:                 t_shuffle = 0
elif sameParty:                   t_shuffle = shuffleSamePartyTime
else:                             t_shuffle = lognormal(shuffleTime[blockers],
                                                        shuffleTime[blockers]*shuffleCv)
t_shuffle *= p.stowMultiplier
```
`shuffleTime = {1: 9.0, 2: 15.0}` seconds by default (Schultz-calibrated).
The passenger blocks the aisle for the whole shuffle, then becomes SEATED and
is removed from the lane.

**(e) Bookkeeping** — record per-tick aisle occupancy, seated count, and each
passenger's state for the visualization event log.

Termination: all passengers SEATED, or `MAX_SIM_SECONDS` reached.

### 6.4 Overhead bin model

Each `(rowSlot, aisleSide)` has `binBagsPerRowSide` slots. A passenger stowing
`b` bags at row `r` consumes `b` slots from their own side. If the row is full,
they search outward `r±1, r±2, … r±binSearchRadius` (stream `sim` decides the
tie-break direction with one `bernoulli(0.5)`), adding `binSearchPenalty` seconds
per row of displacement. If nothing is found within the radius the bag is
**gate-checked**: `gateCheckPenalty` seconds and the bag is removed. Every
gate-check is counted in the metrics.

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
      queueWaitTime
  }],
  timeBreakdown: {walk, stow, shuffle, blocked},   // pax-seconds, summed
  interference: {none, one, two, sameParty},        // counts
  gateChecks, binSearches,
  aisleBlockEvents,
  p50TimeToSeat, p90TimeToSeat, maxTimeToSeat,
  throughputPaxPerMin,
}
```

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
  stowBaseMean, stowCv, stowBagExponent, stowVariability,
  shuffleTime: {1:s, 2:s}, shuffleCv, shuffleSamePartyTime,
  gateScanMean, gateScanSd,
  // bins
  binBagsPerRowSide, binSearchRadius, binSearchPenalty, gateCheckPenalty,
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
drift.

---

## 9. Parity contract

`parity/fixtures.json` holds N configurations. For each, both engines emit a
canonical JSON digest:

```
{ config_hash, totalSeconds, paxCount, timeBreakdown, interference,
  gateChecks, seatedCurve (every 10s), first20SitTimes }
```

Floats are compared with `abs(a-b) <= 1e-6 * max(1,|a|)`.
`npm run parity` / `make parity` runs both and diffs. **CI fails on any mismatch.**
