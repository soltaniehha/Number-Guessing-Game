# Boarding Lab

Board a 171-passenger A320 through one door, 40 times per strategy, and the
airline industry's boarding schemes come out like this:

| | strategy | mean | vs free-for-all |
|---|---|---|---|
| 1 | Steffen (perfect) | 13:53 | **−15.2%** |
| 8= | Southwest 2026 (the real one) | 16:10 | −1.3%, *not significant* |
| 8= | **Random free-for-all** | **16:23** | — |
| 11 | 5-tier priority (Delta/American/Air France) | 17:16 | **+5.4%** |
| 12= | Back-to-front zones | 18:52 | +15.2% |
| 15= | Front-to-back zones | 24:03 | +46.8% |

**The finding, in one line: what the spatial ordering earns, the commercial
ladder gives back.**

Boarding order is two different products sold as one, and the cleanest place to
see them come apart is the same aeroplane with its second door open — the
configuration a flow rule is actually designed for, and the one the section
*Open the second door* below works through in full. Every number in this
paragraph is from there, not from the single-door table above.

As a flow rule, boarding order works. `wilma_zoned` — window → middle → aisle,
crossed with rear-to-front — boards in **0.942×** a free-for-all, 39 seconds
faster on a paired test whose interval is nowhere near zero. As a commercial
instrument it undoes itself. Merge a fare and status ladder into that same
spatial rule, which is what selling boarding position requires, and the
advantage is gone: `southwest_2026`, the scheme a real airline actually shipped
on 27 January 2026, comes out at **1.053** — 36 seconds *slower* than a
free-for-all, interval clear of zero. Our own `common_sense_5tier`, which merges
the ladder more carefully and beats Southwest's design on 8 of 8 independent
seed bases, still only reaches **1.027**, an interval spanning zero: a tie with
boarding at random. The 39 seconds the ordering earns come back as a 75-second
swing in one case and a 57-second swing in the other.

The reason is the same in both, and it is not a flaw in either design. Status
concentrates passengers in the forward rows — premium cabins are forward by
definition, and Comfort+ / Economy Plus / Main Cabin Extra sit immediately
behind them — so a commercial ladder is a **near-door-first rule wearing a
loyalty programme**. Door-awareness cannot repair that, because it is not a
spatial rule to begin with: it orders by who paid, and where they sit is a
correlation, not the criterion. So the conclusion is not that airlines are doing
it wrong. It is narrower and more awkward than that — **an airline that wants
the flow benefit has to stop selling the thing that cancels it.** Nothing in the
model says that trade is a bad one; priority boarding is revenue, and this
measures only the time.

Read all of it as a result about one model with a documented calibration
trade-off (below, and `docs/RESEARCH_PARAMETERS.md` §12.3), not as a measurement
of real aircraft.

Four more things in that table are worth the trouble of a simulator:

- **Random boarding beats most zone schemes.** Not a quirk of this model — it
  is the literature's oldest inconvenient result, and it reproduces here.
  A free-for-all spreads people along the aisle; calling one band of rows at a
  time concentrates them.
- **The revenue-driven scheme airlines actually use is slower than a
  free-for-all**, by 53 seconds through one door on a paired test that is
  comfortably significant. The simulator models the forward concentration of
  status explicitly (`eliteForwardBias`); with status spread evenly down the
  cabin the same scheme is only a hair slower than random, which flattered it
  considerably. Open the second door and `priority_5tier` recovers to a tie
  (0.992, interval spanning zero): two doors work the front and the back of the
  cabin in parallel, so concentrating the early callers at the nose costs much
  less. That is the only remedy here that does not require changing what is
  sold — and it is an airframe and gate decision, not a boarding-order one.
- **Southwest's real January 2026 scheme is a statistical tie with random
  through one door**, and measurably slower than random through two. Given a
  blank sheet after 53 years of open seating, Southwest chose window → middle →
  aisle boarded rear-to-front, then merged their fare and status ladder into it.
  That is not a criticism of Southwest. It is the price of the commercial
  constraint, measured.
- **On a twin-aisle 777, Steffen's famous advantage collapses to nothing** —
  +0:08 against random over 20 replications, an interval spanning zero, sharing
  a rank with the free-for-all itself while `slowest_first`, `wilma_zoned`,
  `reverse_pyramid`, `southwest_2026`, `wilma` and `common_sense_5tier` all
  finish ahead of it. With enough aisles, congestion stops being the binding
  constraint, and clever sequencing was only ever fixing congestion; what is
  left to win is variance, which is why the strategy that boards the slowest
  passengers first comes out on top.

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
   1  steffen_perfect        13:53    21.0  16:07   0.848  -2:30 [-2:54,-2:05]         +0.02  ██████████░░░░░░░░
  =2  steffen_modified       15:03    20.8  17:13   0.918  -1:20 [-1:41,-1:00]         -0.00  ███████████░░░░░░░
  =2  slowest_first          15:06    24.7  17:05   0.922  -1:17 [-1:38,-0:57]         +0.01  ███████████░░░░░░░
  =2  wilma                  15:12    26.9  17:12   0.928  -1:11 [-1:37,-0:45]         -0.00  ███████████░░░░░░░
  =2  wilma_zoned            15:19    23.8  17:20   0.935  -1:04 [-1:25,-0:43]         +0.17  ███████████░░░░░░░
  =2  reverse_pyramid        15:21    23.1  17:06   0.937  -1:02 [-1:26,-0:37]         +0.18  ███████████░░░░░░░
   7  common_sense_5tier     15:34    25.7  17:48   0.950  -0:49 [-1:16,-0:23]         +0.09  ████████████░░░░░░
  =8  southwest_2026         16:10    33.9  18:54   0.987  -0:13 [-0:50,+0:23]  ns     +0.15  ████████████░░░░░░
  =8  random                 16:23    23.8  18:23   1.000  (baseline)                  +0.00  ████████████░░░░░░
  10  by_bags                16:50    22.8  18:52   1.027  +0:27 [+0:03,+0:51]         -0.01  █████████████░░░░░
  11  priority_5tier         17:16    27.3  19:52   1.054  +0:53 [+0:30,+1:15]         -0.17  █████████████░░░░░
 =12  rotating_zone          18:48    25.8  21:32   1.148  +2:25 [+2:01,+2:50]         +0.15  ██████████████░░░░
 =12  back_to_front          18:52    36.4  21:31   1.152  +2:29 [+2:01,+2:58]         +0.34  ██████████████░░░░
 =12  block_boarding         18:52    36.4  21:31   1.152  +2:29 [+2:01,+2:58]         +0.34  ██████████████░░░░
 =15  open_seating           23:37    43.1  28:01   1.441  +7:14 [+6:30,+7:57]         +0.21  ██████████████████
 =15  front_to_back          24:03    38.8  26:35   1.468  +7:40 [+7:00,+8:19]         -0.35  ██████████████████
----------------------------------------------------------------------------------------------------------------------
 'mean +/-95%' is the MARGINAL interval: how long this strategy actually takes, on its own.
 'paired vs random' is the per-replication difference on matched seeds. Every strategy
   sees the identical passenger manifest, so the difference cancels it out. That makes this
   the correct test -- the samples are correlated, so overlapping marginal bars prove nothing
   either way -- and usually the tighter one. 'ns' = interval contains zero. RANKS USE THIS.
 '=' marks a SHARED rank: the paired test cannot separate those strategies at this many
   replications. Treat them as equal, not as ordered.
 NOTE: the marginal view would call 2 more of these a tie. The two disagreeing is
   the point, not a fault: pairing is the more powerful test, so differences can be real
   even where the absolute-time intervals overlap.
 best: Steffen (perfect)  —  2:30 faster than free-for-all (15.2%)
 seat interference (mean events/run):  steffen_perfect=21   steffen_modified=22   slowest_first=34   wilma=20
======================================================================================================================
```

Every strategy sees the same passengers with the same bags, walking speeds and
seat assignments, replication for replication — common random numbers, right
down to a per-passenger sub-stream for each service draw. That is why the
paired intervals are narrow enough to separate strategies whose absolute times
overlap heavily, and why `=` ties are reported as ties rather than ordered by
noise.

### Open the second door

Everything above is a single-door boarding, which is the configuration
Schultz's field regression describes and the one the model is calibrated
against. It is also the configuration in which the difference between a good
flow rule and a commercial ladder is smallest, because with one door every
sensible spatial rule reduces to "far end first" and there is nothing for it to
disagree with.

```
$ cd python && python3 -m plane_boarding.cli compare --aircraft a320neo \
      --doors 1L 2L --runs 40
======================================================================================================================
 Airbus A320neo  —  40 replications per strategy, 171 passengers, doors 1L,2L
 ranked fastest first by the PAIRED comparison against free-for-all
======================================================================================================================
   #  strategy                mean  +/-95%    p95  vs rnd  paired vs random (95% CI) far-1st  relative time
----------------------------------------------------------------------------------------------------------------------
   1  steffen_perfect         9:26    16.9  10:49   0.831  -1:55 [-2:10,-1:39]         -0.01  ██████████░░░░░░░░
  =2  steffen_modified       10:16    16.7  11:54   0.905  -1:04 [-1:19,-0:49]         -0.03  ███████████░░░░░░░
  =2  wilma                  10:22    18.8  11:43   0.914  -0:58 [-1:15,-0:42]         -0.02  ███████████░░░░░░░
  =4  slowest_first          10:33    18.7  12:04   0.931  -0:47 [-1:04,-0:30]         -0.03  ███████████░░░░░░░
  =4  wilma_zoned            10:41    22.8  12:47   0.942  -0:39 [-0:58,-0:21]         +0.06  ███████████░░░░░░░
  =6  reverse_pyramid        11:05    27.7  12:50   0.977  -0:15 [-0:37,+0:06]  ns     +0.07  ████████████░░░░░░
  =6  priority_5tier         11:15    21.0  12:57   0.992  -0:06 [-0:21,+0:10]  ns     -0.03  ████████████░░░░░░
  =6  random                 11:21    17.8  12:44   1.000  (baseline)                  -0.02  ████████████░░░░░░
  =9  by_bags                11:29    20.6  13:18   1.012  +0:08 [-0:04,+0:21]  ns     -0.03  ████████████░░░░░░
  =9  common_sense_5tier     11:39    28.5  14:50   1.027  +0:18 [-0:03,+0:39]  ns     +0.08  ████████████░░░░░░
  11  southwest_2026         11:56    24.7  14:04   1.053  +0:36 [+0:12,+1:00]         +0.07  █████████████░░░░░
 =12  rotating_zone          13:15    26.3  15:16   1.168  +1:54 [+1:32,+2:17]         +0.06  ██████████████░░░░
 =12  back_to_front          13:29    29.5  15:53   1.188  +2:08 [+1:41,+2:35]         +0.16  ██████████████░░░░
 =12  block_boarding         13:29    29.5  15:53   1.188  +2:08 [+1:41,+2:35]         +0.16  ██████████████░░░░
 =12  open_seating           13:30    30.5  16:33   1.190  +2:10 [+1:36,+2:43]         +0.06  ██████████████░░░░
  16  front_to_back          16:59    33.1  19:36   1.497  +5:38 [+5:12,+6:04]         -0.20  ██████████████████
----------------------------------------------------------------------------------------------------------------------
   [ same legend as above ]
 best: Steffen (perfect)  —  1:55 faster than free-for-all (16.9%)
 seat interference (mean events/run):  steffen_perfect=21   steffen_modified=22   wilma=20   slowest_first=34
 door sequencing: 'front_to_back' scores -0.20 -- it loads the rows NEAREST a door first, which is the front-to-back pathology in miniature.
   -> With two doors a single cabin-wide zone order cannot be right for both: calling the rear zone first is far-end-first at 1L and near-end-first at 2L. Zone order has to be set per door.
======================================================================================================================
```

The footnote at the bottom is the engine flagging its own worst door-sequencing
score, and it is worth following. Here it names `front_to_back`, which is
supposed to score badly — but the metric exists because of a problem in the
*other* direction. With two doors there is no single cabin-wide zone order that
is right for both of them: calling the rear zone first is far-end-first at 1L
and **near**-end-first at 2L, which is the front-to-back pathology in miniature.
So spatially ordered strategies sequence within each door's own region instead
(`doorAwareZones`, on by default; ENGINE_SPEC §4.1). Turn it off and you get the
cabin-wide order every published zone scheme actually describes — and the engine
starts flagging `rotating_zone`, a strategy that is trying to be sensible:

```
$ cd python && python3 -m plane_boarding.cli compare --aircraft a320neo \
      --doors 1L 2L --runs 40 --set doorAwareZones=false
======================================================================================================================
 Airbus A320neo  —  40 replications per strategy, 171 passengers, doors 1L,2L
 ranked fastest first by the PAIRED comparison against free-for-all
======================================================================================================================
   #  strategy                mean  +/-95%    p95  vs rnd  paired vs random (95% CI) far-1st  relative time
----------------------------------------------------------------------------------------------------------------------
  =1  steffen_modified       10:16    16.7  11:54   0.905  -1:04 [-1:19,-0:49]         -0.03  ██████████████░░░░
  =1  steffen_perfect        10:19    22.7  12:21   0.910  -1:01 [-1:19,-0:44]         -0.03  ██████████████░░░░
  =1  wilma                  10:22    18.8  11:43   0.914  -0:58 [-1:15,-0:42]         -0.02  ██████████████░░░░
   4  slowest_first          10:33    18.7  12:04   0.931  -0:47 [-1:04,-0:30]         -0.03  ██████████████░░░░
  =5  wilma_zoned            11:07    23.1  13:10   0.980  -0:14 [-0:34,+0:06]  ns     -0.06  ███████████████░░░
  =5  priority_5tier         11:15    21.0  12:57   0.992  -0:06 [-0:21,+0:10]  ns     -0.03  ███████████████░░░
  =5  reverse_pyramid        11:16    23.6  13:06   0.993  -0:05 [-0:23,+0:13]  ns     -0.06  ███████████████░░░
  =5  random                 11:21    17.8  12:44   1.000  (baseline)                  -0.02  ███████████████░░░
   9  by_bags                11:29    20.6  13:18   1.012  +0:08 [-0:04,+0:21]  ns     -0.03  ███████████████░░░
  10  southwest_2026         11:59    25.1  14:02   1.056  +0:38 [+0:17,+1:00]         -0.01  ████████████████░░
 =11  common_sense_5tier     12:20    26.1  14:29   1.088  +1:00 [+0:39,+1:20]         -0.04  ████████████████░░
 =11  front_to_back          12:45    23.9  14:51   1.124  +1:24 [+1:03,+1:45]         -0.19  █████████████████░
 =13  back_to_front          13:24    27.2  16:15   1.182  +2:04 [+1:44,+2:24]         -0.18  ██████████████████
 =13  block_boarding         13:24    27.2  16:15   1.182  +2:04 [+1:44,+2:24]         -0.18  ██████████████████
 =13  open_seating           13:30    30.5  16:33   1.190  +2:10 [+1:36,+2:43]         +0.06  ██████████████████
 =13  rotating_zone          13:30    27.2  16:47   1.191  +2:10 [+1:51,+2:28]         -0.19  ██████████████████
----------------------------------------------------------------------------------------------------------------------
   [ same legend as above ]
 best: 3 strategies tie for first (steffen_modified, steffen_perfect, wilma)  —  about 1:04 faster than free-for-all (9.5%)
 seat interference (mean events/run):  steffen_modified=22   steffen_perfect=21   wilma=20   slowest_first=34
 door sequencing: 'rotating_zone' scores -0.19 -- it loads the rows NEAREST a door first, which is the front-to-back pathology in miniature.
   -> With two doors a single cabin-wide zone order cannot be right for both: calling the rear zone first is far-end-first at 1L and near-end-first at 2L. Zone order has to be set per door.
======================================================================================================================
```

`far-1st` is the `doorSequencing` metric in the tables above, reported for the
*worst* door: positive means that door's queue starts at the far end of its
region, negative means it starts next to the door, which is the pathology.

| strategy | ratio, cabin-wide | ratio, per-door | far-1st, cabin-wide | far-1st, per-door |
|---|---|---|---|---|
| `steffen_perfect` | 0.910 | **0.831** | −0.03 | −0.01 |
| `wilma_zoned` | 0.980 | **0.942** | −0.06 | **+0.06** |
| `reverse_pyramid` | 0.993 | **0.977** | −0.06 | **+0.07** |
| `common_sense_5tier` | 1.088 | **1.027** | −0.04 | **+0.08** |
| `southwest_2026` | 1.056 | 1.053 | −0.01 | **+0.07** |
| `rotating_zone` | 1.191 | **1.168** | −0.19 | **+0.06** |
| `back_to_front` | 1.182 | 1.188 | −0.18 | **+0.16** |
| `block_boarding` | 1.182 | 1.188 | −0.18 | **+0.16** |
| `front_to_back` | **1.124** | 1.497 | −0.19 | −0.20 |

Every one of those sequencing scores crosses from negative to positive except
two. The control's is supposed to stay negative. `steffen_perfect`'s is a
measurement artefact: its waves each sweep far-to-near independently, so the
far-end-first property holds *per wave* rather than across the queue
(ENGINE_SPEC §4.1) and the queue-level metric cannot see it — the 0.910 → 0.831
in the time column is where it shows up instead. `front_to_back` getting
dramatically worse is therefore the mechanism working, not failing: the
cabin-wide version was accidentally half-right, because front-first is the
pathology at the forward door but the *correct* far-end-first order at the aft
one, so half the aeroplane was being boarded sensibly by mistake. Measure
position from each passenger's own door and the control is finally allowed to be
as bad as it is supposed to be.

A few of those rows are worth not glossing over. `back_to_front` and
`block_boarding` have their ordering repaired — the score goes from −0.18 to
+0.16 — and the clock does not notice, 1.182 against 1.188. Removing the
near-door-first pathology at the aft door is not, on its own, worth measurable
time for a scheme that was already concentrating everyone into one band of aisle
at once. And `southwest_2026`'s time moves by 0.003 even though its sequencing
is fully repaired, −0.01 to +0.07, while `priority_5tier` moves in neither
column: it never asks where anyone sits, so there is no region for it to be
measured in at all. That pair is the finding at the top of this file restated as
a null result — door-awareness is a spatial fix, and the thing cancelling the
flow benefit is not spatial.

In the app this is one switch, *Zones measured per door*, in the Behaviour
section: live whenever two doors are open and the strategy orders by position
along the cabin, and `aria-disabled` with the reason in place of its help line
when it cannot do anything.

---

## The sixteen strategies

Ratios are from the `make demo` run above: A320neo, **one** door, 171
passengers, 40 replications. `docs/STRATEGIES.md` is the normative definition of each, with
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
| `open_seating` | No assigned seats; pick one on entering. Southwest, 1971–2026. Retired, and the slowest thing here that anyone ever actually flew — see the caveat below, which is a limitation of the model rather than a finding. | 1.44 |
| `front_to_back` | Foremost band first. The pathological control: everyone walks past everyone. | 1.47 |

**The open-seating number is the one to distrust.** At 1.44 through one door it
is slower than every scheme in the table bar the pathological control, and on
the 777 it is slower than that too — which contradicts open seating's
reputation, and an earlier version of these docs called it "interestingly fast,
because people self-select to avoid each other". That claim had no citation
behind it and the model contradicts it, but the model is not evidence against
it either: the self-selection that would make open seating quick is
*interference* avoidance — declining a seat that means climbing over a stranger,
which produces window-first filling for free — and **none of the four
open-seating policies models that**. They choose on position or spacing alone.
Read 1.44 as "open seating with no interference avoidance", which is a property
of the policy set, not of open seating. `docs/STRATEGIES.md` §11 and
`docs/RESEARCH_PARAMETERS.md` §12.2 record it as a known gap; closing it needs a
source for how passengers trade spacing against interference, and none was
reachable.

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
The model lands inside it — 1052 s for random boarding on a single-door A320neo
at 180 passengers over 30 replications, against a 806–1090 s band — and the
strategy ordering assertion (`front-to-back > back-to-front > random > {WilMA, reverse pyramid} >
Steffen`) holds as a hard test, not an aspiration.

**The trade-off is real and it is recorded, not hidden.** Hitting that absolute
number required partial aisle blocking (`stowPassSpeedFactor = 0.40`). Strict
blocking — the pure cellular model, where a stowing passenger closes the
aisle — overshoots the field regression by about 50% on single-door boarding.
But partial blocking **compresses the differences between strategies**: a
shorter queue behind a stower makes avoiding a stow-block worth less, and
avoiding stow-blocks is most of what outside-in and Steffen buy you. Our
Steffen advantage reads 15.2% in the run above (16% at §12.3's 180 passengers)
where Schultz's realistic figure is 20–25%, and WilMA and reverse pyramid both
sit a few points above their published bands and can no longer be told apart
from each other.

If you care more about relative magnitudes than absolute times, that is one
config key: set `stowPassSpeedFactor` to 0 (it is a labelled control in the
panel, *Squeeze past a stower*, and `--set stowPassSpeedFactor=0` on the CLI).
Steffen returns to 0.78 and reverse pyramid to 0.90, at the cost of every
absolute time being about half an hour wrong on a twenty-minute process. The
full sweep, both candidate models, and the reasoning for shipping 0.40 are in
`docs/RESEARCH_PARAMETERS.md` §12.3, including the two ordering relations that
are lost (`wilma > reverse_pyramid`, which becomes a tie, and
`wilma > wilma_zoned`, which should not be lost at all) and a testable
hypothesis for the second.

**Do not read more into the absolute numbers than that.** This is a
one-dimensional aisle with no galley queues, no wheelchair logistics, no
gate-agent behaviour and no boarding-pass scan queue upstream of the door. The
bin walk-back and gate-check penalties are extrapolation rather than
literature — no boarding paper publishes them — and they are flagged as such
where they are defined, as is the missing interference-avoidance term that makes
the open-seating figure a statement about the policy set rather than about open
seating. What the model is for is *comparisons under identical passengers*, and
it reports every one of those with an interval.

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
doors used, a hash of the resolved cabin geometry, the walk/stow/shuffle/blocked
breakdown, the interference histogram, gate checks, bin searches, aisle-block
episodes, the seated curve resampled onto a fixed 10 s grid, and the first
twenty sit times. Floats are compared to 1e-6. The fixtures cover every airframe, both door topologies, an
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

**That gate is a hash of a summary, and it is worth being exact about what a
pass proves.** The digest covers totals, the breakdowns, the counts, a 10 s-grid
seated curve and the first twenty sit times — enough to catch gross divergence
in seconds, which is why it is the gate that runs on every change. It is not
enough to prove the engines agree. Two runs can produce the same total seconds,
the same interference histogram and the same first twenty sit times while
disagreeing about passenger 140's blocked time, and per-passenger differences
like that are exactly what later turns into a wrong chart.

```
make parity-full
```

is the check that actually proved the port. 16 strategies × 6 aircraft × 4
configurations = **384 scenarios**, comparing **complete `RunResult` documents
field by field with no tolerance at all**: every per-passenger record, both
curves, the congestion matrix, the door statistics. Not a digest of them, and
not a comparison to 1e-6 — the same value or a failure. Run it before a release
and after any change to the engine.

```
==============================================================
 Cross-language parity: Python engine  vs  JavaScript engine
==============================================================
PASS  rng  (17 entries identical)
PASS  engine  (15 entries identical)
      running the 384-scenario exact diff; this takes a few minutes
      32 scenarios identical so far...
      64 scenarios identical so far...
      96 scenarios identical so far...
      128 scenarios identical so far...
      160 scenarios identical so far...
      192 scenarios identical so far...
      224 scenarios identical so far...
      256 scenarios identical so far...
      288 scenarios identical so far...
      320 scenarios identical so far...
      352 scenarios identical so far...
      384 scenarios identical so far...
PASS  full  (384 scenarios, complete RunResults identical field for field)
==============================================================
All parity checks passed. Both engines are behaviourally identical.
```

It took 37 s here against 2.5 s for `make parity` — its own progress line says
"a few minutes", which is pessimistic on this machine and may not be on yours.
The fast one is the gate; the exact one is the proof; at well under a minute
there is not much reason to skip the proof.

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
physically means. A control that cannot affect the current scenario is
`aria-disabled` and its help line is replaced by the reason — still focusable,
so the explanation reaches the people who most need it, and the handler simply
refuses the change. *Zones measured per door* is the one to try first: switch to
a two-door aircraft and a strategy that orders by position along the cabin, flip
it, and watch `front_to_back` get much worse. Pick a single-door airframe and it
goes dead and tells you why. Eight presets — including Southwest before and after January
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
========================================================================================
 Airbus A320neo  —  boarding time vs forward concentration of status (20 replications per point)
========================================================================================

  5-tier priority (revenue)
    eliteForw   pax    mean  s/pax  
        0.000   171   16:38   5.83  █████████████████████████████░
        0.250   171   16:27   5.77  ████████████████████████████░░
        0.500   171   16:39   5.84  █████████████████████████████░
        0.750   171   17:14   6.05  ██████████████████████████████
        1.000   171   17:22   6.09  ██████████████████████████████

  Random / free-for-all
    eliteForw   pax    mean  s/pax  
        0.000   171   16:14   5.70  ████████████████████████████░░
        0.250   171   16:14   5.70  ████████████████████████████░░
        0.500   171   16:14   5.70  ████████████████████████████░░
        0.750   171   16:14   5.70  ████████████████████████████░░
        1.000   171   16:14   5.70  ████████████████████████████░░
========================================================================================
```

Priority boarding costs 44 seconds as status concentrates forward; the
free-for-all does not move at all, which is the control that says the parameter
is doing what it claims. That curve is the mechanism behind the finding at the
top of this file, isolated: nothing about the boarding *order* changes across
those five rows, only where in the cabin status sits. Preboarding rate is the
other axis worth a look —
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
python/tests/                363 tests, including the calibration gates.

web/src/sim/                 The JavaScript port. Bit-identical.
web/src/cabin/               Canvas seat-map renderer and playback.
web/src/charts/              Twelve charts, hand-rolled SVG.
web/src/app/                 Shell: modes, control panel, presets.
web/src/state/               Config reducer, batch driver, aggregation.
web/test/                    1105 tests.

parity/                      Shared constants + the cross-language harness.
  defaults.json                Every default parameter. Both engines read it.
  aircraft.json                The six seat maps. Both engines read it.
  fixtures.json                The scenarios parity is checked over.
```

## Tests

```
make test        # pytest, vitest and the parity harness
make test-py     # 363 tests, ~3 min (the calibration gates are batch runs)
make test-js     # 1105 tests, ~25 s
make parity      # both engines, same digest -- the gate, 2.5 s
make parity-full # both engines, 384 complete results, exact -- the proof, 37 s
make lint        # eslint
```

The Python suite includes the calibration gates as hard assertions:
`test_calibration.py` fails if random boarding leaves the ±15% band around
Schultz's regression, and `test_strategy_ordering_matches_the_literature` fails
if the published ranking stops holding. Conservation tests assert every
passenger boards exactly once into a seat that exists, for every strategy on
every airframe through every boardable door combination. Determinism tests
assert that `(config, seed)` reproduces the event log exactly. The two-door
contrast above is pinned there too: `test_calibration.py` asserts that
`doorAwareZones` is inert to the second through one door, and that through two
it turns the worst door's sequencing score from firmly negative — near-door
first, the pathology — to firmly positive.

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
