# Boarding Lab

Board a 171-passenger A320 through one door, 40 times per strategy, and the
airline industry's boarding schemes come out like this:

| | strategy | mean | vs free-for-all |
|---|---|---|---|
| 1 | Steffen (perfect) | 13:53 | **−15.1%** |
| 8= | Southwest 2026 (the real one) | 16:09 | −1.3%, *not significant* |
| 8= | **Random free-for-all** | **16:21** | — |
| 11 | 5-tier priority (Delta/American/Air France) | 17:14 | **+5.4%** |
| 12= | Back-to-front zones | 18:50 | +15.1% |
| 15= | Front-to-back zones | 23:57 | +46.4% |

Four things in that table are worth the trouble of a simulator:

- **Random boarding beats most zone schemes.** Not a quirk of this model — it
  is the literature's oldest inconvenient result, and it reproduces here.
  A free-for-all spreads people along the aisle; calling one band of rows at a
  time concentrates them.
- **The revenue-driven scheme airlines actually use is slower than a
  free-for-all**, by 53 seconds on a paired test that is comfortably
  significant. Status flyers sit in the forward rows — Comfort+, Economy Plus,
  Main Cabin Extra — and premium cabins are forward by definition, so calling
  the top tiers first is a front-to-back boarding wearing a loyalty programme.
  The simulator models that explicitly (`eliteForwardBias`); with status spread
  evenly down the cabin the same scheme is only a hair slower than random,
  which flattered it considerably.
- **Southwest's real January 2026 scheme is a statistical tie with random.**
  Given a blank sheet after 53 years of open seating, Southwest chose
  window → middle → aisle boarded rear-to-front, then merged their fare and
  status ladder into it. The flow logic on its own (`wilma_zoned`) is worth
  about 6%; the same spatial ordering with the ladder merged in is worth
  1.3% with an interval that spans zero. That is not a criticism of Southwest.
  It is the price of the commercial constraint, measured.
- **On a twin-aisle 777, Steffen's famous advantage collapses to nothing** —
  +0:10 against random, interval spanning zero, while reverse pyramid quietly
  wins. With enough aisles, congestion stops being the binding constraint, and
  clever sequencing was only ever fixing congestion.

Boarding Lab is a discrete-time simulator built to produce numbers like those
with error bars attached: a Python reference engine, a bit-identical JavaScript
port, and a browser app with a live cabin animation and twelve analytics
charts. Sixteen boarding strategies, six real aircraft, every service-time
constant traced to a published measurement.

---

## Quick start

Nothing is downloaded at runtime and the Python engine has no dependencies.

**The web app**

```
cd web
npm install
npm run dev        # http://localhost:5173
```

or `make install && make dev` from the repository root.

**The command line** — no install needed; run it out of `python/`:

```
cd python
python3 -m plane_boarding.cli run     --aircraft a320neo --strategy wilma
python3 -m plane_boarding.cli compare --aircraft a320neo --doors 1L --runs 40
python3 -m plane_boarding.cli sweep   --param eliteForwardBias --doors 1L \
                                      --strategies priority_5tier random
python3 -m plane_boarding.cli export  --aircraft b777_300er --replay --out replay.json
```

`python3 -m pip install -e ".[dev]"` (or `make install`) additionally puts a
`boarding` command on your path and installs pytest. `make demo` is the
`compare` line above; `make sweep` is the `sweep` line. Progress counters go to
stderr, so piping stdout to a file gives you just the table.

### What `make demo` prints

Forty replications of each of the sixteen strategies, on the same forty
passenger manifests, ranked by the paired difference against a free-for-all.
Roughly 70 seconds.

```
======================================================================================================================
 Airbus A320neo  —  40 replications per strategy, 171 passengers, doors 1L
 ranked fastest first by the PAIRED comparison against free-for-all
======================================================================================================================
   #  strategy                mean  +/-95%    p95  vs rnd  paired vs random (95% CI) far-1st  relative time
----------------------------------------------------------------------------------------------------------------------
   1  steffen_perfect        13:53    21.1  16:07   0.849  -2:28 [-2:53,-2:04]         +0.02  ██████████░░░░░░░░
  =2  steffen_modified       15:01    20.8  17:11   0.919  -1:20 [-1:41,-0:59]         -0.00  ███████████░░░░░░░
  =2  slowest_first          15:05    24.8  17:03   0.922  -1:16 [-1:37,-0:55]         +0.01  ███████████░░░░░░░
  =2  wilma                  15:09    26.9  17:04   0.926  -1:12 [-1:38,-0:46]         -0.00  ███████████░░░░░░░
  =2  wilma_zoned            15:18    23.9  17:20   0.935  -1:04 [-1:25,-0:42]         +0.17  ███████████░░░░░░░
  =2  reverse_pyramid        15:21    22.8  17:05   0.938  -1:01 [-1:25,-0:37]         +0.18  ████████████░░░░░░
   7  common_sense_5tier     15:32    25.3  17:38   0.950  -0:49 [-1:16,-0:22]         +0.09  ████████████░░░░░░
  =8  southwest_2026         16:09    34.1  18:53   0.987  -0:13 [-0:50,+0:24]  ns     +0.15  ████████████░░░░░░
  =8  random                 16:21    24.0  18:20   1.000  (baseline)                  +0.00  ████████████░░░░░░
  10  by_bags                16:47    22.8  18:52   1.026  +0:25 [+0:01,+0:49]         -0.01  █████████████░░░░░
  11  priority_5tier         17:14    27.5  19:49   1.054  +0:53 [+0:30,+1:15]         -0.17  █████████████░░░░░
 =12  rotating_zone          18:47    25.7  21:22   1.148  +2:25 [+2:00,+2:51]         +0.15  ██████████████░░░░
 =12  back_to_front          18:50    36.3  21:32   1.151  +2:28 [+1:59,+2:57]         +0.34  ██████████████░░░░
 =12  block_boarding         18:50    36.3  21:32   1.151  +2:28 [+1:59,+2:57]         +0.34  ██████████████░░░░
 =15  open_seating           23:21    44.5  27:56   1.428  +7:00 [+6:16,+7:44]         +0.21  ██████████████████
 =15  front_to_back          23:57    38.6  26:33   1.464  +7:36 [+6:57,+8:15]         -0.35  ██████████████████
----------------------------------------------------------------------------------------------------------------------
 'mean +/-95%' is the MARGINAL interval: how long this strategy actually takes, on its own.
 'paired vs random' is the per-replication difference on matched seeds. Every strategy
   sees the identical passenger manifest, so the difference cancels it out. That makes this
   the correct test -- the samples are correlated, so overlapping marginal bars prove nothing
   either way -- and usually the tighter one. 'ns' = interval contains zero. RANKS USE THIS.
 '=' marks a SHARED rank: the paired test cannot separate those strategies at this many
   replications. Treat them as equal, not as ordered.
 best: Steffen (perfect)  —  2:28 faster than free-for-all (15.1%)
 seat interference (mean events/run):  steffen_perfect=21   steffen_modified=22   slowest_first=34   wilma=20
======================================================================================================================
```

Every strategy sees the same passengers with the same bags, walking speeds and
seat assignments, replication for replication — common random numbers, right
down to a per-passenger sub-stream for each service draw. That is why the
paired intervals are narrow enough to separate strategies whose absolute times
overlap heavily, and why `=` ties are reported as ties rather than ordered by
noise.

---

## The sixteen strategies

Ratios are from the run above: A320neo, one door, 171 passengers, 40
replications. `docs/STRATEGIES.md` is the normative definition of each, with
who flies it and where the claim comes from.

| key | what it does | ratio |
|---|---|---|
| `steffen_perfect` | Adjacent boarders two rows apart, window→aisle, alternating sides. The theoretical optimum, and unrunnable at a real gate. | 0.85 |
| `steffen_modified` | The same idea in four gate-callable groups: even/odd row slots × side. | 0.92 |
| `slowest_first` | Longest expected service time first. Mostly cuts variance, not the mean. | 0.92 |
| `wilma` | All windows, then middles, then aisles. Eliminates seat shuffles by construction. Lufthansa, ANA, United's economy residual. | 0.93 |
| `wilma_zoned` | Outside-in crossed with rear-to-front. The flow logic Southwest shipped in 2026, without the status ladder. | 0.94 |
| `reverse_pyramid` | A diagonal wave from rear-window to front-aisle. Flown in revenue service by America West in 2003: −2 min and −21% departure delays, and still the best-evidenced ordering change ever measured. | 0.94 |
| `common_sense_5tier` | The proposal: five printable groups quantising the reverse pyramid, with fare and status merged *into* the group assignment rather than sorted within it. Beats the real Southwest design on 8 of 8 independent seed bases. | 0.95 |
| `southwest_2026` | The real converged design, live on ~4,000 flights a day since 27 January 2026: WilMA × rear-to-front projected onto eight groups, shifted by fare and Rapid Rewards status. | 0.99 |
| `random` | Full shuffle. The baseline everything is measured against. | 1.00 |
| `by_bags` | No-bag passengers first, then one, then two. A foil: the literature finds the *reverse* order helps. | 1.03 |
| `priority_5tier` | Preboard → premium+top elite → mid elite → main → basic economy last. Revenue only: Delta, American, Air France. | 1.05 |
| `rotating_zone` | Alternates rearmost and foremost bands so the two flows interleave. | 1.15 |
| `back_to_front` | Contiguous bands, rearmost first. Intuitive, reliably poor. | 1.15 |
| `block_boarding` | Premium cabin, then rear-to-front blocks. The pre-status-tier standard. | 1.15 |
| `open_seating` | No assigned seats; pick one on entering. Southwest, 1971–2026. Retired, and slow here because everyone hunts. | 1.43 |
| `front_to_back` | Foremost band first. The pathological control: everyone walks past everyone. | 1.46 |

Four things are applied on top of whatever a strategy returns, in this order:
preboards to the front, party cohesion (a booking boards whole, at its
earliest-called member's slot), per-passenger non-compliance drift, and late
arrivals to the very end. Party cohesion is the single biggest reason
theoretically optimal orderings underperform in practice, and you can switch it
off to see exactly what it costs — except for the two strategies that board by
seat location *and* fare, where every real carrier promotes the whole booking
and a run without it would model nothing that exists.

---

## The six aircraft

| id | aircraft | seats | aisles | bins/row-side | why it is in the roster |
|---|---|---|---|---|---|
| `e175` | Embraer E175 | 76 | 1 | **1** | The pathological case. **One** boarding door — 1R is catering, the aft pair are exits — so every passenger enters at the nose and walks the whole cabin, and no strategy can be rescued by opening another door. Legacy bins hold ~36 bags for 76 seats, so bins fill before half the cabin is aboard and roughly 9% of passengers gate-check, at the one chokepoint everyone else must pass. Its own lighter bag mix is an airframe default, because the airline valet-checks roll-aboards on the bridge. |
| `a320neo` | Airbus A320neo | 186 | 1 | 4 | 186-seat single-class easyJet layout, 29" pitch. The calibration reference and the cleanest two-door case. |
| `b737_max8` | Boeing 737 MAX 8-200 | 197 | 1 | 3 | Ryanair's high-density MAX. Real seat deletions, not a rounded seat count: 1A/1D/1E/1F to the forward galley, 27F to a crew jumpseat, 28A/28F to the mid-cabin exit pair — the door pair that raises the certified limit from 189 to 200 and costs four seats to fit. Row 13 is skipped as a *number* and costs no cabin length. Boards front and rear at once. |
| `a220_300` | Airbus A220-300 | 130 | 1 | 3 | The asymmetric one: an off-centre aisle gives 2-3 seating, so there is one middle seat per row instead of two and the port side can never produce a worst-case 9-movement shuffle. Row 17 is the overwing exit and has **three** seats — both windows deleted — leaving a solo seat with an empty window space beside it. |
| `b777_300er` | Boeing 777-300ER | 354 | 2 | 4 | Twin aisle, 3-4-3, Emirates three-class. Two lavatory/galley complexes physically break the economy cabin: real metres of aisle to walk, declared as monuments rather than as skipped row numbers. Where Steffen's advantage disappears. |
| `b787_9` | Boeing 787-9 | 257 | 2 | 4 | Twin aisle, 3-3-3, United four-cabin. Defaults to boarding 2L only — what most widebodies actually do — with business forward of the door and economy aft, so one lane carries traffic in both directions. |

A skipped row *number* and a galley bank are different things and the geometry
treats them differently: the first costs nothing, the second costs metres.
Conflating them is the classic way to get a widebody's walking distances wrong.

---

## How the model works

Passengers hold a real-valued position along a one-dimensional aisle lane and
the world advances in fixed 0.1 s ticks. Walking speed is
density-dependent — `speed × min(1, gapAhead / 0.85 m)`, floored at 15% — so a
crowd slows smoothly instead of stopping dead, and blocked time is measured
against free flow rather than against a standstill. Arrival at the aircraft
door is a Poisson process with a 3.7 s mean, and its clock runs **in parallel**
with aisle congestion: people keep piling up on the jetbridge while the aisle
is jammed, and the backlog then walks on back-to-back. Serialising that instead
roughly doubles the modelled boarding time, and it was the largest single
calibration error in the first cut of the engine.

Stowing is per piece of luggage: one `Weibull(1.7, 16 s)` draw per bag, summed,
which is Schultz's field fit (mean 14.3 s against a measured 13.9 s) and gives
the right super-linear variance for a two-bag passenger without an exponent
hack. Bin capacity is a property of the airframe; when the run above your row
is full you search outward, and past the search radius the bag is gate-checked.

Seat shuffles are decomposed into elementary movements — stand, step out, step
back, sit — each `Triangular(1.8, 2.4, 3.0)` s: one movement to sit in a clear
row, four when the aisle seat is occupied, five when the middle is (standing up
from a middle seat is worse), nine when both are, two when the people in your
way are your own family. The penalty depends on *which* seat blocks, not merely
how many, and sitting down is never free.

The two aisle-occupancy rules are deliberately asymmetric. A **stowing**
passenger narrows the aisle rather than closing it: exactly one follower at a
time may squeeze past at 40% of walking pace, and only if their own seat is
further on. A **shuffling** passenger blocks completely, always — when the
aisle and middle occupants stand up to let a window passenger in, they are
physically in the aisle. That asymmetry is the point: it makes seat
interference strictly more expensive than bag stowing, which is exactly the
effect outside-in methods exist to exploit.

---

## Calibration, and what it cost

The acceptance test is Schultz's regression over **282 measured single-aisle
boardings**: `T ≈ 4.5N + 138 s`, so 948 s for 180 passengers, with a ±15% band.
The model lands inside it — 1054 s for random boarding on a single-door A320neo
at 180 passengers, against a 806–1090 s band — and the strategy ordering
assertion (`front-to-back > back-to-front > random > {WilMA, reverse pyramid} >
Steffen`) holds as a hard test, not an aspiration.

**The trade-off is real and it is recorded, not hidden.** Hitting that absolute
number required partial aisle blocking (`stowPassSpeedFactor = 0.40`). Strict
blocking — the pure cellular model, where a stowing passenger closes the
aisle — overshoots the field regression by about 50% on single-door boarding.
But partial blocking **compresses the differences between strategies**: a
shorter queue behind a stower makes avoiding a stow-block worth less, and
avoiding stow-blocks is most of what outside-in and Steffen buy you. Our
Steffen advantage reads 16% where Schultz's realistic figure is 20–25%, and
WilMA and reverse pyramid both sit a few points above their published bands and
can no longer be told apart from each other.

If you care more about relative magnitudes than absolute times, that is one
config key: set `stowPassSpeedFactor` to 0 (it is a labelled control in the
panel, *Squeeze past a stower*, and `--set stowPassSpeedFactor=0` on the CLI).
Steffen returns to 0.78 and reverse pyramid to 0.90, at the cost of every
absolute time being about half an hour wrong on a twenty-minute process. The
full sweep, both candidate models, and the reasoning for shipping 0.40 are in
`docs/RESEARCH_PARAMETERS.md` §12.3, including the one ordering relation that
is lost and should not be (`wilma > wilma_zoned`) and a testable hypothesis for
why.

**Do not read more into the absolute numbers than that.** This is a
one-dimensional aisle with no galley queues, no wheelchair logistics, no
gate-agent behaviour and no boarding-pass scan queue upstream of the door. The
bin walk-back and gate-check penalties are extrapolation rather than
literature — no boarding paper publishes them — and they are flagged as such
where they are defined. What the model is for is *comparisons under identical
passengers*, and it reports every one of those with an interval.

---

## Two engines, one answer

`python/plane_boarding/` is the reference implementation: batch runs, sweeps,
the CLI, the calibration gates. `web/src/sim/` is a port of it that runs in the
browser and in a Web Worker. They are required to agree **bit for bit**, and
any difference is a bug rather than a tolerance.

That is enforced, not asserted. Both engines read the same
`parity/defaults.json` and `parity/aircraft.json` — the constants are never
transcribed — and both implement PCG32 with the same draw order, the same
Box–Muller without variate caching, the same descending-index Fisher–Yates, and
the same percentile interpolation, because a language built-in would disagree.
Service times are converted to whole ticks rather than compared against a
floating clock, which is what stops the two drifting over a 10,000-step run.

```
make parity
```

runs 17 RNG conformance vectors and 15 fixture scenarios through both engines
and diffs a canonical digest of each: total seconds, passenger and seat counts,
doors used, the walk/stow/shuffle/blocked breakdown, the interference
histogram, gate checks, bin searches, aisle-block episodes, the seated curve
resampled onto a fixed 10 s grid, and the first twenty sit times. Floats are
compared to 1e-6. The fixtures cover every airframe, both door topologies, an
empty cabin, a full one, open seating, and Schultz's own configuration pinned
explicitly so it cannot drift when a shipped default moves.

```
==============================================================
 Cross-language parity: Python engine  vs  JavaScript engine
==============================================================
PASS  rng  (17 entries identical)
PASS  engine  (15 entries identical)
==============================================================
All parity checks passed. Both engines are behaviourally identical.
```

---

## The web app

Three modes over one control panel, all in the browser with no server.

- **Cabin** — the whole boarding is simulated up front (~30 ms) and replayed
  from a compact frame buffer, so scrubbing is instant and playback never
  stutters. A top-down canvas seat map: dots are red waiting, amber stowing or
  shuffling, blue walking, green seated, encoded by ring shape as well as
  colour. Jetbridge queues outside each active door, a red wash on rows where
  the aisle is blocked, per-passenger tooltips. Play/pause, step, scrub, and
  speeds from 1× real time to 100×.
- **Analytics** — Monte Carlo in a Web Worker, streaming results back so the
  charts fill while it runs. Twelve hand-rolled SVG charts, no chart library:
  boarding time with confidence intervals, time distribution, the seated
  S-curve, a row × time congestion heatmap, where the time went, seat
  interference counts, the parameter sweep, passenger wait boxes, time-to-seat
  by seat position, convergence, risk/reward, and aisle throughput. Every one
  has a hover read-out, a data table and a real empty state.
- **Compare** — every selected strategy head to head, with the ranking table
  and paired intervals the CLI prints.

The control panel exposes every simulation parameter in seven sections, each
control showing its live value and one line of plain English about what it
physically means. A control that cannot affect the current scenario is disabled
and says why. Eight presets — including Southwest before and after January
2026, on the same aircraft, as a built-in A/B. Config copies to JSON or to a
shareable URL. Dark by default with a light theme; keyboard shortcuts for
play/pause, step, reset and mode; responsive down to 400 px.

The sweep in Analytics and Compare is worth finding. It re-runs every strategy
across a range of *one* scenario parameter and plots the curve. Load factor
answers "does this ranking survive a two-thirds-full Tuesday". The more
interesting axis is **forward concentration of status**, which turns "does
selling priority boarding cost time?" from an assertion into a measurement:

```
$ make sweep
 Airbus A320neo  —  boarding time vs forward concentration of status (20 replications per point)

  5-tier priority (revenue)
    eliteForw   pax    mean  s/pax
        0.000   171   16:38   5.83  █████████████████████████████░
        0.250   171   16:24   5.75  ████████████████████████████░░
        0.500   171   16:38   5.83  █████████████████████████████░
        0.750   171   17:11   6.03  ██████████████████████████████
        1.000   171   17:22   6.09  ██████████████████████████████

  Random / free-for-all
    eliteForw   pax    mean  s/pax
        0.000   171   16:12   5.68  ████████████████████████████░░
        0.250   171   16:12   5.68  ████████████████████████████░░
        0.500   171   16:12   5.68  ████████████████████████████░░
        0.750   171   16:12   5.68  ████████████████████████████░░
        1.000   171   16:12   5.68  ████████████████████████████░░
```

Priority boarding costs 44 seconds as status concentrates forward; the
free-for-all does not move at all, which is the control that says the parameter
is doing what it claims. Preboarding rate is the other axis worth a look —
above roughly 15% of the cabin the preboard block, not the boarding order, sets
the time, and that is a regime change rather than a shift in a number.

---

## Layout

```
docs/ENGINE_SPEC.md          Normative spec. Both engines implement this.
docs/STRATEGIES.md           The sixteen algorithms, and who really flies them.
docs/UI_SPEC.md              The app: modes, charts, controls, presets.
docs/RESEARCH_PARAMETERS.md  Every constant, its source, and its confidence.
docs/RESEARCH_AIRCRAFT.md    Every seat map, its source, and its confidence.
docs/RESEARCH_AIRLINES.md    What real carriers board like, in 2025-26.

python/plane_boarding/       Reference engine + CLI (no dependencies).
python/tests/                298 tests, including the calibration gates.

web/src/sim/                 The JavaScript port. Bit-identical.
web/src/cabin/               Canvas seat-map renderer and playback.
web/src/charts/              Twelve charts, hand-rolled SVG.
web/src/app/                 Shell: modes, control panel, presets.
web/src/state/               Config reducer, batch driver, aggregation.
web/test/                    978 tests.

parity/                      Shared constants + the cross-language harness.
  defaults.json                Every default parameter. Both engines read it.
  aircraft.json                The six seat maps. Both engines read it.
  fixtures.json                The scenarios parity is checked over.
```

## Tests

```
make test        # pytest, vitest and the parity harness
make test-py     # 298 tests
make test-js     # 978 tests
make parity      # both engines, same digest
make lint        # eslint
```

The Python suite includes the calibration gates as hard assertions:
`test_calibration.py` fails if random boarding leaves the ±15% band around
Schultz's regression, and `test_strategy_ordering_matches_the_literature` fails
if the published ranking stops holding. Conservation tests assert every
passenger boards exactly once into a seat that exists, for every strategy on
every airframe through every boardable door combination. Determinism tests
assert that `(config, seed)` reproduces the event log exactly.

## Provenance

Every constant in `parity/defaults.json` is traceable to
`docs/RESEARCH_PARAMETERS.md`, which cites its source and grades its
confidence: **[C]** corroborated across independent sources, **[S]** single
source, **[A]** assumption. Every seat map in `parity/aircraft.json` is
traceable the same way through `docs/RESEARCH_AIRCRAFT.md`, down to which
individual seats do not exist and why. Where a number is an extrapolation
rather than a measurement — the bin search penalty and the gate-check
penalty, principally — it is labelled as one in both the research document and
the engine spec. Where the model knowingly departs from the literature, §12 of
the parameters document says so, says what it costs, and shows the sweep behind
the decision.
