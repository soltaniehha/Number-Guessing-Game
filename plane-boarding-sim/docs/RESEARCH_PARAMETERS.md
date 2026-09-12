# Research Parameters — Citation Trail for `parity/defaults.json`

**Purpose.** This document is the provenance record for every magic number in the boarding
simulator. Each default in `parity/defaults.json` should be traceable to a row in one of the
tables below. **Any change to a default must be justified against this document** — either by
citing a source here, by adding a new source, or by explicitly recording the change as a
deliberate deviation (see §11, *Known deviations from the literature*).

**Research constraint (important for future readers).** The research pass that produced this
document was run in a session where outbound HTTP was blocked at the organisation's egress
proxy for **every** scholarly domain attempted — `arxiv.org`, `mdpi.com`,
`sciencedirect.com`, `pmc.ncbi.nlm.nih.gov`, `semanticscholar.org`, `elib.dlr.de`,
`informs-sim.org`, `lss.fnal.gov`, and others all returned `EGRESS_BLOCKED` / proxy `403`.
Every value below was therefore extracted from **full-text search indexing** of those papers,
not from reading the PDFs. This is a session-wide constraint and is not something to work
around; it is recorded here so that a reader knows the confidence level attached to each
number. See §12, *Gaps I could not close*.

## Confidence notation

Every value carries one of three markers:

| Marker | Meaning |
|---|---|
| **[C]** | **Corroborated** — the value was recovered from at least two independent queries/sources that agree. Treat as reliable. |
| **[S]** | **Single-source** — recovered once, from one source, without independent corroboration. Usable, but verify before relying on it for anything load-bearing. |
| **[D]** | **Derived** — my own arithmetic from a **[C]**/**[S]** value (e.g. the mean of a stated Weibull, or a ratio computed from stated times). The inputs are cited; the arithmetic is mine. |

Anything with no marker, or explicitly labelled as inference, is **not** a literature value.

---

## 0. The canonical parameter set (Schultz / DLR stochastic CA model)

This is the most thoroughly field-calibrated model in the literature and the one the simulator
is built against. It is an **ASEP (asymmetric simple exclusion process) / stochastic cellular
automaton**, calibrated against **>400 manually recorded flights**, of which **282 boarding
events** on A320/B737 (29–190 pax) form the validation set. Reported validation deviation vs.
field trials: **< 5%**. **[C]**

| Parameter | Value | Distribution | Source |
|---|---|---|---|
| Cell size (grid) | **0.4 m × 0.4 m**, one passenger per cell | deterministic lattice | Schultz 2018a/b **[C]** |
| Max (free-flow) aisle speed | **0.8 m/s** — same for all agents | deterministic | Schultz 2017c/2018b **[C]** |
| Time step | **0.5 s** (= 0.4 m / 0.8 m/s, one cell per step) | deterministic | **[S]** + **[D]** |
| Reference cabin | A320, **29 seat rows × 6 seats = 174 seats** (some papers use 30 rows / 180) | — | **[C]** |
| Inter-arrival time at aircraft door | mean **3.7 s** | **exponential** (Poisson arrivals) | Schultz **[C]** |
| Baseline seat load factor | **85%** | — | Schultz **[C]** |
| Conformance rate (passengers actually following the called strategy) | **85%** default | Bernoulli per pax | Schultz **[C]** |
| Hand-luggage stowing time (per event) | **Weibull**, shape α = **1.7**, scale β = **16.0 s** | Weibull | Schultz 2018a **[C]** |
| → implied mean / median / σ | **14.3 s** / 12.9 s / **8.6 s** | — | **[D]** from Weibull(1.7, 16.0) |
| → measured field mean | **13.9 s** (vs **17.5 s** for the older triangular assumption) | empirical | Schultz 2018 field trial **[C]** |
| Seat-shuffle: one elementary movement | Triangular **(t_min=1.8, t_mode=2.4, t_max=3.0) s** | triangular | Schultz **[C]** |
| → mean / σ per movement | **2.4 s** / **0.245 s** | — | **[D]** |
| Monte Carlo replications | **150,000** boarding events simulated (Schultz, TR-C 2018) | — | **[S]** |
| Boarding-progress metric scale factor B | **0.4** (≈33% influence decay per queue position) | — | Schultz TR-C 2018 **[S]** |

**Empirical validation regression (the basis of our hard test assertion).** Over 282 measured
single-aisle boardings:

> **T_board ≈ 4.5 s × N_pax + 138 s** (offset ≈ 2.3 min) **[S]**

→ 180 pax ⇒ **948 s ≈ 15.8 min**; 174 pax ⇒ **921 s ≈ 15.3 min**. **[D]**

---

## 1. Aisle walking speed

### 1a. Free-flow speed

| Model / source | Free-flow aisle speed | Distribution | Notes |
|---|---|---|---|
| Schultz (DLR), all papers 2013–2022 | **0.8 m/s** | **deterministic** (identical for all agents; stochasticity enters via arrival, luggage, shuffle instead) | Single most-cited value **[C]** |
| Weidmann free walking speed (generic pedestrian, used as the *unconstrained* reference in cabin models) | **1.34 m/s** | normal, σ ≈ 0.26 m/s in the general pedestrian literature | Weidmann 1993 **[C]** |
| Engelmann, Kleinheinz & Hornung, *Aerospace* **7**(12):182 (2020) | speed made a **function of local cabin geometry** (proximity of seats, monuments, other pax) rather than a constant | — | Validated on A320 + AVACON baseline **[S]** |
| Generic ABM practice | multiplicative speed factor ~ **N(μ=1.0, σ=0.2)** applied to a nominal aisle transit time | Gaussian | **[S]** |
| Delcea/Cotfas NetLogo family | **0–1 patch/tick**, patch = 0.4 m, tick = **1.2 s** → max **0.33 m/s**; luggage-carrying pax reduced to **0.6–0.9 patch/tick** (0.20–0.30 m/s) | uniform-ish per agent | **[C]** on the 0.4 m patch and 1.2 s tick; note this effective speed is **2.4× slower** than Schultz's 0.8 m/s — these models absorb stop-and-go into the nominal speed |

**Value adopted:** **0.80 m/s** (Schultz, aisle-specific, field-calibrated) for the unobstructed
in-aisle walk. **1.2–1.4 m/s** applies only to the jetbridge/terminal approach, which we do not
model. Do **not** use 1.34 m/s inside the aisle — the aisle is ~0.48 m wide and passengers carry
bags.

### 1b. Speed–density (fundamental diagram)

The Weidmann relation is the one used when cabin models degrade speed with density:

> **j = ρ · v_free · [1 − exp(−γ (1/ρ − 1/ρ_max))]**,
> and therefore **v(ρ) = v_free · [1 − exp(−γ (1/ρ − 1/ρ_max))]**

| Symbol | Value | Unit |
|---|---|---|
| v_free | **1.34** | m/s |
| ρ_max (jam / standstill density) | **5.4** | pers/m² |
| γ (gauge constant) | **1.913** | 1/m² |
| Free-speed plateau holds up to | **≈ 0.4** | pers/m² |

**[C]** (Weidmann 1993; used e.g. in Bosina & Weidmann 2018 generic FD, and adopted in
cabin-movement work.)

Practical note: a single-file aisle is effectively 1-D. With 0.4 m cells at 1 person/cell, the
CA jam density is **2.5 pers/m of aisle**; over a 0.48 m aisle width that is ≈ **5.2 pers/m²**,
i.e. almost exactly Weidmann's ρ_max = 5.4 — the 0.4 m cell is *chosen* to reproduce jam
density. **[D]**

### 1c. Minimum inter-person spacing

| Quantity | Value | Source |
|---|---|---|
| CA exclusion spacing (1 pax per 0.4 m cell) | **0.4 m** centre-to-centre | Schultz, Delcea **[C]** |
| Implied jam density | **2.5 pers/m** of aisle | **[D]** |
| COVID-era "social distance" variants | **1.0 m** baseline, swept to **1.5 m and 2.0 m** | Delcea/Cotfas, Milne et al. **[C]** |
| Weidmann standstill density | 5.4 pers/m² ⇒ ≈ 0.43 m spacing in 1-D | **[D]** |

---

## 2. Luggage stowing time

### 2a. Distributions

| Source | Form | Parameters | Mean |
|---|---|---|---|
| **Schultz 2018, "Field Trial Measurements…" (Aerospace 5(1):27)** | **Weibull** | shape **1.7**, scale **16.0 s** | **14.3 s** (model) / **13.9 s** (measured field data) **[C]** |
| Schultz's *earlier* (pre-2018) assumption | **Triangular** per luggage piece, combined with a per-pax luggage-count distribution | (t_min, t_mode, t_max) per piece | **17.5 s** expected — the old triangular **over-estimated by ~26%** **[C]** |
| Milne & Kelly / Milne & Salari family (following Van Landeghem & Beuselinck 2002, Audenaert et al. 2009) | **Triangular**, inverse-CDF sampled from one U(0,1) draw per passenger | "time to sit without interference" = **3.33 × row-to-row time**; ≈ **10 s** max, row-to-row ≈ **3 s** max | **[C]** on the 3.33 factor; **[S]** on the 3 s / 10 s maxima |
| Delcea/Cotfas NetLogo | luggage-count-dependent formula; sliders for `passengers-with-small-luggage-percent`, `-large-`, `-small-and-large-` | speed penalty 0.6–0.9 patch/tick while carrying | **[C]** |
| Ren & Xu (2018), *JATM* 71:55–63, prototype 48-seat cabin | measured, interference-classified | — | experimental, values behind paywall **[S]** |

**Value adopted:** **Weibull(k = 1.7, λ = 16.0 s)** per stowing event. It is the only
field-fitted distribution found, it is right-skewed (correct — a long tail of struggling
passengers), and its mean matches the measured 13.9 s. Lognormal is *not* what Schultz fits;
the literature default is Weibull (Schultz) or triangular (the OR/Milne lineage).

### 2b. Scaling with number of bags

Schultz's construction is explicitly **per-piece × number of pieces**: "the hand-luggage storage
process is parameterised by the time to store *one* piece and the individual amount of luggage
pieces." **[C]**

Baseline luggage-count distribution (Schultz et al. 2013, used as the default in later papers):
assume ≥1 piece per passenger, with **P(1 piece) = 60%, P(2) = 30%, P(3) = 10%** **[S]** (also
quoted elsewhere as "60% one piece, 30% two pieces"). Expected pieces/pax = **1.5**, expected
stow time/pax ≈ **21.5 s** at 14.3 s/piece. **[D]**

> ⚠️ 1.5 pieces/pax is high for a European LCC and produces long boardings; many later papers
> sweep this. Milne & Salari treat bag count as the *decision variable* for seat assignment.

### 2c. Dependence on row / bin fullness

- Schultz: positioning passengers with **>1 carry-on item in the rear** of the cabin **reduces
  boarding time by up to 10%**. **[C]**
- Schultz, Soolaki, Salari & Bakhshian (JATM 106, 2023; arXiv 2207.09263): explicit
  **capacity-limited overhead compartment** per row; seat assignment + boarding sequence jointly
  optimised against bin capacity. **[C]**
- Milne & Salari (2016, JATM 54:104–110): assign passengers with **few bags near the entry**,
  many bags further back. **[C]**
- Steffen & Hotchkiss and the EJOR 2024 paper "*Let the fast passengers wait*" (EJOR
  317(3):748–761) find **most-bin-luggage-first** shortens boarding. **[C]**

---

## 3. Seat interference / shuffle

### 3a. The taxonomy

Standard 3-seat-row (ABC / DEF) taxonomy, **4 types** for a narrow-body:

| Type | Occupancy already seated | Target seat | Common notation |
|---|---|---|---|
| Type 1 | **aisle** occupied | middle | (0,0,1) blocking → 1 person stands |
| Type 2 | **aisle** occupied | window | 1 person stands |
| Type 3 | **middle** occupied | window | 1 person stands |
| Type 4 | **aisle + middle** occupied | window | 2 people stand — worst case |

Different papers permute the numbering; Delcea et al. report per-type counts separately, and
note **reverse pyramid always yields zero Type-3 interferences**. **[S]**

### 3b. Schultz's measured/derived penalties — the values we encode

Schultz decomposes each shuffle into **elementary movements**, each
**Triangular(1.8, 2.4, 3.0) s** (mean 2.4 s):

| Case | Movements | Mean penalty **[D]** | σ **[D]** | Source |
|---|---|---|---|---|
| No interference (walk in and sit) | **1** | **2.4 s** | 0.24 s | **[C]** |
| **Aisle seat blocked** (aisle occupant stands, target = middle or window) | **4** | **9.6 s** | 0.49 s | Schultz, ATM Seminar 2017 **[C]** |
| **Middle seat blocked, window is the target** | **5** | **12.0 s** | 0.55 s | **[C]** |
| **Aisle + middle both occupied, window is the target** (step out, re-enter, unblock aisle) | **9** | **21.6 s** | 0.74 s | **[C]** |

Cross-check: Schultz's directly *measured* average seat-interference time is
**≈ 10 s, range [9, 13] s** **[S]** — consistent with the 4-movement (9.6 s) and 5-movement
(12.0 s) cases dominating a random-boarding mix.

### 3c. Other sources' assumptions

| Source | Assumption |
|---|---|
| **Steffen (2008, JATM 14:146–150)** | Does **not** model seat shuffle as a separate timed event; the central assumption is that **luggage-stowing time dominates total boarding time**, and the optimisation target is maximising the number of passengers stowing luggage *simultaneously*. The Steffen order places adjacent queue neighbours **two rows apart on the same side**, which **eliminates both seat and aisle interference by construction**. **[C]** |
| **Steffen & Hotchkiss (2011)** | Empirical — no assumed penalty; interference emerges from real people. |
| Milne & Kelly / Milne & Salari lineage | Seat-interference delay computed **explicitly** from the number of blocking occupants, using the minimum of the "time to sit" triangular as its floor. Row-to-row triangular parameters taken from Van Landeghem & Beuselinck (2002) and Audenaert et al. (2009). **[C]** |
| Assorted ABM papers | "getting up from a seat so another passenger may settle: **3–5 s**" per standing occupant **[S]** |
| Bazargan (2007, EJOR 183:394–411) | MILP minimising the **count** of interferences (not their duration) on a 132-seat A320-class cabin; a *weight* per interference type rather than seconds. **[S]** |

**Range across sources for the worst case (Type 4):** roughly **~15 s** (2 × "3–5 s stand" plus
re-seating) **to 21.6 s** (Schultz's 9-movement). We use Schultz's movement-count model — it is
the only one with field backing and it naturally produces the right variance.

---

## 4. Aircraft geometry

| Aircraft | Economy seat pitch (in) | Seat pitch (m) | Notes |
|---|---|---|---|
| **A320 / A320neo** | **29–32** (typ. 30–31) | **0.74–0.81** (typ. 0.76–0.79) | 3-3; 174 seats @ 29 rows, 180 @ 30 rows **[C]** |
| **B737 / 737 MAX** | **29–32** (typ. 30–31) | 0.74–0.81 | 3-3; 189 seats on 737-800 high-density **[C]** |
| **E175** | **31–32** (up to 38 in some layouts) | **0.79–0.81** | 2-2, 76–88 seats **[S]** |
| **B777** | **31–32** (10-abreast 3-4-3 common) | 0.79–0.81 | twin-aisle **[C]** |
| **B787** | **31–32** (some carriers 33–34) | 0.79–0.86 | 3-3-3 typical **[C]** |

| Aircraft | Aisle width |
|---|---|
| **A320** | **19–20 in ≈ 0.48–0.51 m** (standard 3-3); "wide-aisle" alternative layout gives 25 in ≈ 0.64 m **[C]** |
| **B737** | **18–19 in ≈ 0.46–0.48 m** **[C]** |
| Cabin width, A320 vs 737 | 146 in vs 139 in (A320 is 7 in wider) **[S]** |
| Regulatory floor (14 CFR 25.815 / CS-25.815) | for >19 pax: **15 in** below 25 in height, **20 in** above **[C]** |

**Cell size for CA models: 0.4 m is the near-universal choice** (Schultz; Delcea/Cotfas NetLogo
patches are explicitly **0.4 m × 0.4 m**). **[C]** With a 0.76–0.81 m seat pitch, **one seat row
= 2 aisle cells**. No boarding paper found uses 0.6 m cells; 0.4 m derives from
pedestrian-dynamics jam density (§1b).

---

## 5. Model validation & strategy comparison

### 5a. Steffen & Hotchkiss (2011) — the mock-fuselage experiment

Setup: mock **Boeing 757** fuselage on a Southern California soundstage, **12 rows × 6 seats =
72 seats**, single aisle, **72 volunteers** (ages 5+), **each given a roller bag**, five takes
with the same people and the same bags — only the order changed. **[C]**

| Method | Measured boarding time | Seconds **[D]** | × Steffen | × Block |
|---|---|---|---|---|
| **Block boarding** (traditional zones) | **6 min 54 s** | 414 | 1.92 | 1.00 |
| **Back-to-front** (row-by-row) | **6 min 11 s** | 371 | 1.72 | 0.90 |
| **Random** (free-for-all) | **4 min 44 s** | 284 | 1.31 | 0.69 |
| **WilMA** (window–middle–aisle) | **4 min 13 s** | 253 | 1.17 | 0.61 |
| **Steffen (perfect)** | **3 min 36 s** | 216 | 1.00 | **0.52** |

The paper's own headline ratios: **WilMA ≈ 1.7× faster than block; Steffen ≈ 2× faster than
block**; and up to **38.6% reduction vs random for a partially occupied cabin**. **[C]**
The per-trial ± uncertainties could not be retrieved (PDF behind the egress block).

### 5b. Simulation predictions, 180-seat single-aisle

| Source | Finding |
|---|---|
| **Schultz** (150,000 MC runs, A320 174 seats) | Optimised strategies give **20–25% reduction vs the calibrated random-boarding A320 reference** **[C]** |
| **Field regression** (282 boardings) | **T ≈ 4.5 s·N + 138 s** → 180 pax ⇒ **≈ 948 s (15.8 min)** for real-world (mostly random/block) boarding **[S]/[D]** |
| **van den Briel et al. (2005), Interfaces 35(3):191–201** — America West **reverse pyramid**, implemented Sept 2003 | **> 2 minutes saved, ≈ 20% reduction** on full/nearly-full flights, measured in revenue service **[C]** |
| **Moreira et al. (2023), Mathematics 11:4288** (DES, A320) | **Reverse pyramid ≈ 15% faster than random**; **Steffen best**, **blocks worst** **[C]** |
| **Ferreira/Fernandes et al. (2023), Sustainability 15:16476** (DES, A320, 7 strategies) | **Outside-in and reverse pyramid up to 15% better than random**; Steffen fastest overall **[C]** |
| **Ren & Xu (2018), JATM 71:55–63** (48-seat prototype cabin, 6 strategies, real people) | **Reverse-pyramid and outside-in efficient; back-to-front inefficient**; background music measurably reduced both perceived and actual boarding time **[C]** |
| **Steffen (2008)** theoretical | optimal ordering can be **up to 4× faster** than worst-case, depending on aircraft dimensions **[C]** |
| **seatNow** (Schultz, dynamic seat allocation) | **20–30% faster in simulation, 22% measured in live trials with Eurowings at Cologne/Bonn** **[C]** |

### 5c. Relative-speedup calibration table (index: random = 1.00)

Blend of the Steffen & Hotchkiss experiment and the simulation studies. **These are the
calibration targets for the simulator.**

| Strategy | Experiment (Steffen & Hotchkiss) | Simulation consensus |
|---|---|---|
| Block / zones | 1.46 | 1.15–1.30 (slowest) |
| Back-to-front (rows) | 1.31 | 1.05–1.20 |
| **Random** | **1.00** | **1.00** |
| Outside-in / WilMA | 0.89 | 0.85–0.90 |
| Reverse pyramid | not tested | **0.85** (15% gain) |
| Steffen (perfect) | **0.76** | 0.55–0.75 |

Note the experiment-vs-simulation gap: **real-world conformance (85%) and group behaviour erode
the theoretical Steffen advantage substantially** — Schultz's realistic figure is 20–25%, not
50%.

---

## 6. Groups / families

| Item | Value | Source |
|---|---|---|
| Travel-alone fraction by segment | **Business: 73% travel alone**; **Tourists: only 19% travel alone** (⇒ ~81% of leisure pax are in groups) | Schultz **[C]** |
| Effect on strategy performance | Groups make **simple strategies (random, block) ≈ 5% faster**; **seat-based strategies (WilMA/outside-in) get slower**, because groups refuse to be split by seat letter | Schultz **[C]** |
| Group behaviour magnitude | "Positive impact on boarding efficiency, more pronounced as the number of groups increases" | Tang et al., *JATM* (2018); Tang et al., *TR-C* 96 (2018) **[C]** |
| Extended model | Tang et al., *J. Adv. Transp.* 2019:8908935 **[C]** |
| Earlier group-aware optimisation | Qiang et al. (2016) **[C]** |
| Modelling rule used | Group members board **contiguously**, are seated in **adjacent seats in the same row**, and by construction **generate no seat interference among themselves** (a 3-member group filling A/B/C incurs zero shuffle) | **[C]** |
| Middle-seat-only-by-family variant | Used in Moreira et al. (2023) as a COVID/capacity policy **[S]** |

**No paper reachable in this session gives an explicit group-size PMF.** A defensible
construction from the 73%/19%-alone figures is:

- business mix → group sizes `{1: 0.73, 2: 0.20, 3: 0.05, 4: 0.02}`
- leisure mix → group sizes `{1: 0.19, 2: 0.45, 3: 0.18, 4: 0.18}`

> **This is inference, not a citation.** If the simulator ships a group-size distribution, it
> must be labelled as an assumption in `parity/defaults.json`, not as a sourced value.

---

## 7. Overhead-bin capacity

This is the **thinnest-covered** area quantitatively.

| Item | Value / finding | Source |
|---|---|---|
| Explicit bin-capacity model | Schultz, Soolaki, Salari & Bakhshian, *JATM* **106** (2023) / arXiv 2207.09263: "A combined optimization–simulation approach for modified outside-in boarding … **including limited baggage compartment capacities**". Joint seat-assignment + boarding-sequence optimisation with a **per-row capacity-limited overhead compartment**. Cabin: **29 rows × 6 seats**. | **[C]** |
| Physical bin capacity, narrow-body | **≈ 120–150 standard carry-ons** total (industry figure, not peer-reviewed) — i.e. saturated at ~0.7–0.85 bags/pax on a 180-seat aircraft | **[S]** |
| Bin-distribution effect | Placing multi-bag passengers **in the rear** cuts boarding time **up to 10%**; even luggage distribution (Milne & Kelly 2014) is itself an objective | **[C]** |
| Bag-order effect | "*Let the fast passengers wait*" (EJOR 317(3):748–761, 2024): passengers with the **most bin luggage should enter first** | **[C]** |
| Walk-back / gate-check penalty | **No peer-reviewed paper found that publishes a numeric walk-back or gate-check time penalty.** The mechanism is described qualitatively (bin-full announcements, gate-check to hold, aisle congestion) and appears in bin-fill-sensor patent/industry literature, not in the simulation literature. | — |

**Suggested modelling approach — uncited extrapolation, not a literature value.** Model bins as
a per-row capacity `C_row` (≈ 4–5 standard bags for a 3-3 row bin pair); on overflow, the
passenger searches forward/backward `k` rows, adding `2 × k × (row_pitch / 0.8 m/s)` plus one
extra Weibull stow event; on total saturation, apply a gate-check event. If the simulator
implements this, the constants must be flagged as assumptions.

---

## 8. Two-door and twin-aisle

| Item | Result | Source |
|---|---|---|
| Two-door + apron bus, new methods (Milne, Delcea, Cotfas et al.) | **5.6% – 36.6% faster** than the best previously published two-door/two-bus method | **[C]** |
| Greedy two-door method for partially occupied aircraft | up to **8.33%** better than best-known literature method; up to **43.72%** better than the method commonly used at airports | **[C]** |
| Schultz, two-door infrastructural change | **20–25% reduction** vs calibrated A320 random reference | **[C]** |
| Schultz et al. (2008) | **Linear relationship between seat load factor and boarding time** holds for **both one-door and two-door** aircraft, across strategies | **[C]** |
| Two-door gate throughput assumption | ≥3 parallel boarding counters, **5 s average boarding-pass check** per passenger | **[S]** |
| Twin-aisle: B777 and A380 | Six strategies compared (WilMA, Steffen, reverse pyramid, random, blocks, by-letter): **reverse pyramid is best for the B777**; **Steffen is best for the A380** | **[C]** (Schmidt et al., *Efficiency of Aircraft Boarding Procedures*) |
| Multi-aisle parallel boarding | Ryd, Khandelwal, So & Steffen, arXiv **2410.17870** (2024): with **4 aisles**, the Steffen advantage over WMA/back-to-front **collapses from 1.6–2.1× down to ≈ 1.0×**. Back-to-front / WMA are **~2× faster on a 4-aisle flying wing** than on a single-aisle with the same passenger count. Practical (non-optimal) parallel schemes are only **≤ 1.06×** slower than optimal. | **[C]** |

**Structural insight:** aisle count is the dominant lever. Once there are enough parallel aisles,
boarding-order optimisation stops mattering — congestion, not sequencing, is what the clever
orders were fixing.

---

## 9. Stochastic vs deterministic modelling, and replication counts

| Aspect | Practice |
|---|---|
| Dominant paradigm | **Stochastic**. Schultz's is explicitly "a stochastic, forward-directed, one-dimensional, discrete (time and space) process" (ASEP). Deterministic models exist only as analytic idealisations (Bachmat's Lorentzian-geometry asymptotics; Bazargan's MILP interference-count objective). **[C]** |
| Where the randomness lives (Schultz) | **Three** stochastic inputs only: (i) arrival time at the door (exponential, mean 3.7 s), (ii) hand-luggage stow time (Weibull 1.7 / 16.0 s), (iii) seat interference (triangular per movement). Walking speed is **deterministic at 0.8 m/s**. Plus Bernoulli non-conformance (15%). **[C]** |
| Replications | Schultz, *TR-C* 2018: **150,000 boarding events** simulated. **[S]** Typical smaller studies (Delcea/Cotfas NetLogo, DES studies): **hundreds to a few thousand** runs, reported with **90% or 95% confidence intervals**. **[C]** |
| Reported precision | Schultz reports validation deviation **< 5%** vs field trials. **[C]** |
| Analytic alternative | Bachmat et al.: boarding time is the **maximal proper time among curves in a 1+1-dimensional flat Lorentzian space-time**; efficiency governed by a **congestion parameter k** = (initial queue length)/(aisle length), determined by cabin interior design. Predicts random boarding scales as **~√N**. **[C]** Related: Erland/Steffen et al., *Phys. Rev. E* **100**:062313 (2019) and **103**:062310 (2021) — "**slow passengers first**" beats random, mainly by **reducing variance**. **[C]** |

**Recommendation:** ≥10,000 replications per configuration for stable tail statistics (95th
percentile boarding time, which is what airlines actually care about); 1,000 is enough for the
mean alone.

---

## 10. Adopted default parameter block

This is the set encoded in `parity/defaults.json`.

```
GEOMETRY
  cell_size            = 0.40 m              # aisle lattice
  seat_pitch           = 0.79 m  (31 in)     # A320/737 economy → 2 cells/row
  aisle_width          = 0.48 m  (19 in)
  rows                 = 30, seats_per_row = 6   # 180 seats

KINEMATICS
  v_free_aisle         = 0.80 m/s            # see §11: we sample per-passenger, Schultz does not
  dt                   = 0.5 s   (1 cell/step)
  min_spacing          = 0.40 m  (1 pax/cell exclusion)
  v(rho)               = 1.34*(1-exp(-1.913*(1/rho - 1/5.4)))   # only if continuous-space

ARRIVALS
  inter_arrival        ~ Exponential(mean = 3.7 s)
  conformance          = 0.85
  seat_load_factor     = 0.85 (sweep to 1.00)

LUGGAGE
  n_bags               ~ {1:0.60, 2:0.30, 3:0.10}
  t_stow_per_bag       ~ Weibull(shape=1.7, scale=16.0 s)   # mean 14.3 s, sd 8.6 s

SEAT SHUFFLE
  t_move               ~ Triangular(1.8, 2.4, 3.0) s
  n_moves: none=1 | aisle_blocked=4 | middle_blocked(window target)=5 | both_blocked=9
  → mean penalty:  2.4 s | 9.6 s | 12.0 s | 21.6 s

GROUPS
  group members board contiguously; zero intra-group seat interference
  leisure: ~81% in groups;  business: ~27% in groups

REPLICATIONS
  >= 10,000 Monte Carlo runs per configuration
```

---

## 11. Calibration acceptance tests

These are the concrete pass criteria adopted for the simulator. They are hard test assertions,
not advisory targets.

### 11.1 Absolute boarding time (regression check)

**Random boarding on a 180-passenger single-aisle cabin at full load must produce a mean total
boarding time within ±15% of 948 s.**

- Target: **948 s** (= 4.5 s × 180 + 138 s), from Schultz's regression over 282 measured
  single-aisle boardings **[S]/[D]** (§0).
- Accepted band: **806 s ≤ T̄ ≤ 1090 s**.
- The ±15% band is wider than Schultz's own <5% model-vs-field deviation because (a) the
  regression itself is a linear fit across a 29–190 pax range rather than a point measurement,
  and (b) we introduce per-passenger walk-speed variance that Schultz does not (§11.3).
- Should be evaluated over ≥10,000 replications so the mean is stable to well under the band
  width.

### 11.2 Strategy ordering (monotonicity check)

**The mean boarding times of the implemented strategies must satisfy, strictly:**

```
block / front-to-back  >  back-to-front  >  random  >  WilMA  >  reverse pyramid  >  Steffen
```

- Sourced from the Steffen & Hotchkiss (2011) experiment (§5a) for block > back-to-front >
  random > WilMA > Steffen **[C]**, and from van den Briel et al. (2005), Moreira et al. (2023)
  and Ferreira et al. (2023) for the placement of reverse pyramid between WilMA and Steffen
  **[C]**.
- This is an **ordering** assertion, not a magnitude assertion. Magnitudes should be
  cross-checked against the relative-speedup table in §5c but are not part of the pass/fail
  gate, because the experiment and simulation columns there disagree by a wide margin (Steffen
  at 0.76 experimentally vs 0.55–0.75 in simulation).
- Note that reverse pyramid was **not** tested in the Steffen & Hotchkiss experiment; its
  position in the ordering rests on the simulation and revenue-service literature only.
- The ordering must hold at the default 85% conformance. It is expected to *tighten* (the spread
  between strategies narrows) as conformance falls, and to widen as conformance rises toward
  100% — that behaviour is itself worth a regression test but is not part of this gate.

---

## 12. Known deviations from the literature

### 12.1 Per-passenger walking speed is sampled, not deterministic

**What Schultz does.** Schultz sets the maximum aisle walking speed to **0.8 m/s for every
agent, deterministically**, and confines all stochasticity to three inputs: door arrival time
(exponential), luggage stow time (Weibull), and seat-shuffle movement time (triangular), plus
Bernoulli non-conformance. Walking speed carries no variance in his model. **[C]** (§0, §9.)

**What we do.** We sample each passenger's free-flow walking speed from a **truncated normal
centred on 0.80 m/s**, with the mean and standard deviation both exposed as user-facing
controls.

**Why.** This is a product requirement, not a modelling improvement. The simulator exposes
walk-speed mean and standard deviation as controls the user can move, so speed heterogeneity has
to be a first-class modelled quantity rather than a constant folded into the lattice step. A
deterministic-speed model cannot answer "what happens if passengers are slower / more variable",
which is one of the questions the product is built to answer. Truncation keeps sampled speeds
physically sensible (no zero or negative speeds, no sprinting).

**Consequence — flag this when comparing to published figures.** Adding per-passenger speed
variance will **increase the variance of total boarding time relative to Schultz's published
figures**, and may shift the mean slightly (a heterogeneous-speed queue is generally a little
slower than a homogeneous one at the same mean speed, because the slowest passenger in each
platoon sets the pace). Specifically:

- Distribution-shape comparisons against Schultz's published boarding-time distributions are
  **not apples-to-apples**; ours will be wider.
- The ±15% band in §11.1 is deliberately wide partly to absorb this.
- When the user sets the walk-speed standard deviation to **0**, the model should reduce exactly
  to Schultz's deterministic-speed configuration. **That degenerate case is the one to use for
  any strict comparison against his published numbers**, and it is worth keeping as a test
  fixture.

### 12.2 Other assumption-not-citation values

The following ship as defaults but are **inference or extrapolation**, not literature values.
They are collected here so they are not mistaken for sourced numbers:

- **Group-size PMF** (§6) — constructed by me from Schultz's 73%/19%-travel-alone split. No
  paper reachable in this session publishes a group-size distribution.
- **Overhead-bin per-row capacity and the walk-back penalty formula** (§7) — no peer-reviewed
  numeric source exists for the walk-back/gate-check penalty. Both the per-row capacity constant
  and the search-and-stow penalty are my extrapolation.

### 12.3 Partial aisle blocking while stowing (`stowPassSpeedFactor`) — implemented, default off

**What Schultz does.** In an ASEP/cellular model a passenger occupies a cell or
they do not. There is no way to express "the aisle narrows"; a stowing passenger
holds their cell outright and nobody passes. He therefore has no
partial-blocking term at all. **[C]** (§0, §9.)

**What we implemented.** A passenger stowing a bag physically steps into the
seat-row gap and reaches up — the aisle narrows rather than closing, and people
do edge past someone loading a bin. `stowPassSpeedFactor` (0–1, a fraction of
walking speed) lets exactly one follower at a time squeeze past a STOWING
passenger. A SHUFFLING passenger still blocks completely and always will: when
seated occupants stand up to let a window passenger in, they are in the aisle.
See ENGINE_SPEC §6.3 for the mechanism.

**Why it was investigated.** Our strict-blocking model overshoots the field
regression (§11.1) by ~50% on single-door boarding, and the diagnosed cause was
exactly this: full blocking yields ~3 simultaneous stowers where the regression
implies ~7. The mechanism is a genuine correction to a simplification, not a
tuning knob invented to hit a number.

**What the calibration found.** a320neo, `random`, 180 pax, 1L only, 100
replications for the absolute figure; ratios over 70 replications per strategy;
B777 over 20. Every row satisfies the ordering assertion except 0.60.

| `stowPassSpeedFactor` | single-door T | f2b | b2f | wilma | rev.pyr | steffen | ordering | B777 best | B777 steffen |
|---|---|---|---|---|---|---|---|---|---|
| **0 (strict, shipped)** | **1419 s** ✗ | 1.48 ✓ | 1.10 ✗ | 0.94 ✗ | **0.90 ✓** | **0.78 ✓** | OK | **rev. pyramid ✓** | **1.01 ✓** |
| 0.20 | 1144 s ✗ | 1.46 ✓ | 1.11 ✗ | 0.94 ✗ | 0.92 ✗ | 0.86 ✗ | OK | **wilma_zoned ✗** | 1.04 ✓ |
| 0.30 | **1080 s ✓** | 1.47 ✓ | 1.12 ✗ | 0.92 ✗ | 0.92 ✗ | 0.84 ✗ | OK (by 0.001) | rev. pyramid ✓ | 1.03 ✓ |
| 0.40 | **1038 s ✓** | 1.49 ✓ | 1.14 ✗ | 0.93 ✗ | 0.93 ✗ | 0.84 ✗ | OK | rev. pyramid ✓ | 1.01 ✓ |
| 0.60 | **993 s ✓** | 1.52 ✗ | 1.19 ✗ | 0.93 ✗ | 0.95 ✗ | 0.84 ✗ | **FAIL** | rev. pyramid ✓ | 1.00 ✓ |

Literature bands for reference: f2b 1.30–1.50, b2f 1.20–1.35, wilma 0.85–0.92,
reverse pyramid 0.82–0.90, Steffen 0.70–0.80 (§5c).

**Decision: default 0, mechanism kept and exposed.** No value in the physically
plausible 0.2-0.6 range satisfies both the absolute band and the strategy
ratios. Strict blocking scores **3 of 5** ratio bands and reproduces the
published ordering and both twin-aisle findings; the best partial-blocking
setting scores **1 of 5**, at 0.20 loses the B777 reverse-pyramid result, at
0.30 holds the ordering by 0.001 (a coin flip), and at 0.60 loses it outright.

The compression is arithmetic rather than a bug. Partial blocking shortens the
queue behind a stower, so avoiding a stow-block is worth less -- and avoiding
stow-blocks is most of what outside-in and Steffen buy you. Steffen's advantage
falls from 22% to 16%, below Schultz's own realistic 20-25% figure for optimised
strategies.

The product's comparative claims ("outside-in saves you 7%") rest on the ratios;
its absolute claims ("your flight boarded in N minutes") carry a documented and
measurable level offset a reader can correct for. Shipping the ratios is the
honest trade. Anyone who wants the absolute number instead can set
`stowPassSpeedFactor` to 0.30-0.40 and accept the compression -- the mechanism
is implemented, tested and deadlock-free, and this table says what it costs.

**Still open.** The remaining ~50% single-door offset is unexplained by any
mechanism we have tested (density law 3%, same-row serialisation 0.2%, slow
passengers 2%, bin congestion 6%, door arrival process 0% once corrected to run
in parallel). Either the strict single-file exclusion process is too pessimistic
in some way we have not identified, or `T = 4.5N + 138` — a linear fit across a
29–190 pax range, `[S]` single-source, and not reproducible from Schultz's own
3.7 s arrivals plus ~26 s of per-passenger aisle service — is optimistic at the
top of its range. Resolving it needs the Schultz PDFs that were unreachable in
the research session (§14.1).

---

## 13. Sources

**Core (Schultz / DLR):**
- Schultz, M. (2018). *Field Trial Measurements to Validate a Stochastic Aircraft Boarding Model.* Aerospace 5(1):27 — https://doi.org/10.3390/aerospace5010027 · https://www.mdpi.com/2226-4310/5/1/27 · https://elib.dlr.de/119255/
- Schultz, M. (2018). *Implementation and application of a stochastic aircraft boarding model.* Transportation Research Part C 90:334–349 — https://www.sciencedirect.com/science/article/abs/pii/S0968090X18303735
- Schultz, M. (2018). *A metric for the real-time evaluation of the aircraft boarding progress.* TR-C 86:467–487 — https://www.sciencedirect.com/science/article/abs/pii/S0968090X17303066
- Schultz, M. (2018). *Fast Aircraft Turnaround Enabled by Reliable Passenger Boarding.* Aerospace 5(1):8 — https://www.mdpi.com/2226-4310/5/1/8
- Schultz, M. (2018). *Consideration of Passenger Interactions for the Prediction of Aircraft Boarding Time.* Aerospace 5(4):101 — https://doi.org/10.3390/aerospace5040101
- Schultz, M. (2017). *Aircraft Boarding — Data, Validation, Analysis.* 12th USA/Europe ATM R&D Seminar — https://www.researchgate.net/publication/321427724
- Schultz, M. *Faster Aircraft Boarding Enabled by Infrastructural Changes.* WSC 2017 — https://www.informs-sim.org/wsc17papers/includes/files/208.pdf
- Schultz & Soolaki (2021). *Analytical approach … coronavirus pandemic.* TR-C — https://arxiv.org/abs/2007.16021
- Schultz, Soolaki, Salari, Bakhshian (2023). *Combined optimization–simulation … limited baggage compartment capacities.* JATM 106 — https://arxiv.org/abs/2207.09263 · https://www.unibw.de/lvk/publications/pdf/2022_jatm_boarding_bag.pdf
- seatNow model page — https://seatnow.net/model

**Steffen:**
- Steffen, J.H. (2008). *Optimal boarding method for airline passengers.* JATM 14(3):146–150 — https://arxiv.org/abs/0802.0733
- Steffen & Hotchkiss (2011). *Experimental test of airplane boarding methods.* JATM 18(1):64–67 — https://arxiv.org/abs/1108.5211 · https://lss.fnal.gov/archive/2011/pub/fermilab-pub-11-402-ae.pdf
- Steffen (2008). *A statistical mechanics model for free-for-all airplane passenger boarding.* AJP 76(12):1114 — https://arxiv.org/pdf/0803.3199
- Ryd, Khandelwal, So & Steffen (2024). *Analysis of Parallel Boarding Methods in a Multi-Aisle Flying Wing Aircraft* — https://arxiv.org/abs/2410.17870

**OR / classical:**
- Van Landeghem & Beuselinck (2002). *Reducing passenger boarding time in airplanes: a simulation based approach.* EJOR 142(2):294–308 — https://www.sciencedirect.com/science/article/abs/pii/S0377221701002946
- van den Briel, Villalobos, Hogg et al. (2005). *America West Airlines Develops Efficient Boarding Strategies.* Interfaces 35(3):191–201 — https://pubsonline.informs.org/doi/10.1287/inte.1050.0135 · https://www.iem.yuntech.edu.tw/lab/Orlab/2007/05America%20West%20Airlines%20Develops%20Efficient%20Boarding%20Strategies.pdf
- Bazargan, M. (2007). *A linear programming approach for aircraft boarding strategy.* EJOR 183:394–411 — https://www.sciencedirect.com/science/article/abs/pii/S0377221706010137
- Audenaert, Verbeeck & Vanden Berghe (2009). *Multi-Agent Based Simulation for Boarding* — https://www.researchgate.net/publication/268056015
- Ferrari & Nagel (2005). *Robustness of Efficient Passenger Boarding Strategies for Airplanes.* TRR 1915 — https://depositonce.tu-berlin.de/bitstreams/b1649929-2840-4511-8014-dd44aab7eb3a/download
- *Let the fast passengers wait: Boarding an airplane takes shorter time when passengers with the most bin luggage enter first.* EJOR 317(3):748–761 (2024) — https://www.sciencedirect.com/science/article/pii/S0377221722009754

**Interference / agent-based modelling:**
- Ren & Xu (2018). *Experimental analyses of airplane boarding based on interference classification.* JATM 71:55–63 — https://www.sciencedirect.com/science/article/abs/pii/S0969699718300280
- Delcea, Cotfas et al. (2018). *Are Seat and Aisle Interferences Affecting the Overall Airplane Boarding Time? An Agent-Based Approach.* Sustainability 10(11):4217 — https://www.mdpi.com/2071-1050/10/11/4217
- Delcea, Cotfas, Paun (2018). *Agent-Based Evaluation of the Airplane Boarding Strategies' Efficiency and Sustainability.* Sustainability 10(6):1879 — https://www.mdpi.com/2071-1050/10/6/1879
- Cotfas & Delcea (2020). *Evaluating Classical Airplane Boarding Methods Considering COVID-19 Flying Restrictions.* Symmetry 12(7):1087 — https://doi.org/10.3390/sym12071087
- Milne & Salari, and the Milne/Delcea/Cotfas two-door apron-bus series — e.g. https://doi.org/10.3390/sym11101221

**Groups / luggage:**
- Tang et al. *An aircraft boarding model accounting for group behavior.* JATM — https://www.sciencedirect.com/science/article/abs/pii/S0969699717304933
- Tang et al. *An aircraft boarding model with the group behavior and the quantity of luggage.* TR-C 96 — https://www.sciencedirect.com/science/article/abs/pii/S0968090X1830768X
- Tang et al. (2019). *An Extended Boarding Strategy Accounting for the Luggage Quantity and Group Behavior.* J. Adv. Transp. 2019:8908935 — https://onlinelibrary.wiley.com/doi/10.1155/2019/8908935
- *A new model of luggage storage time while boarding an airplane: An experimental test.* JATM 84 — https://www.sciencedirect.com/science/article/abs/pii/S0969699718303405

**Pedestrian dynamics / movement:**
- Weidmann (1993) fundamental diagram, as summarised in Bosina & Weidmann (2018) — https://www.strc.ch/2018/Bosina_Weidmann.pdf
- Engelmann, Kleinheinz & Hornung (2020). *Advanced Passenger Movement Model Depending On the Aircraft Cabin Geometry.* Aerospace 7(12):182 — https://www.mdpi.com/2226-4310/7/12/182
- Lahijani et al. (2020). *Constrained Linear Movement Model (CALM): Simulation of passenger movement in airplanes.* PLOS ONE 15(3):e0229690 — https://arxiv.org/abs/1910.05749
- Bachmat et al. *Analysis of airplane boarding via space-time geometry and random matrix theory* — https://arxiv.org/abs/physics/0512020
- Erland/Steffen et al., *Phys. Rev. E* 100:062313 (2019) and 103:062310 (2021)

**Simulation comparison studies:**
- Moreira et al. (2023). *A Simulation Study of Aircraft Boarding Strategies.* Mathematics 11(20):4288 — https://www.mdpi.com/2227-7390/11/20/4288
- (2023). *Analysis of Boarding Strategies on an Airbus A320 Using Discrete Event Simulation.* Sustainability 15(23):16476 — https://doi.org/10.3390/su152316476
- Schmidt et al. *Efficiency of Aircraft Boarding Procedures* (B777/A380 twin-aisle) — https://www.researchgate.net/publication/263038949
- *Improving airplane boarding time: a review, a field study and an experiment with a new way of hand luggage stowing.* IJAAA 5(2) — https://commons.erau.edu/ijaaa/vol5/iss2/7/
- 14 CFR 25.815, *Width of aisle* — https://www.ecfr.gov/current/title-14/chapter-I/subchapter-C/part-25/subpart-D/subject-group-ECFR88992669bab3b52/section-25.815

---

## 14. Gaps I could not close

Recorded verbatim in spirit from the original research pass. A future reader should know which
values are inferred rather than cited, and that the primary PDFs were unreachable.

1. **Egress block.** Every paper PDF/HTML was unreachable from the research session (proxy 403
   on arxiv, mdpi, sciencedirect, PMC, semanticscholar, DLR, informs-sim, and even Wikipedia).
   If the allowlist can be extended to `arxiv.org`, `mdpi.com`, `pmc.ncbi.nlm.nih.gov` and
   `depositonce.tu-berlin.de`, the exact tables can be pulled — in particular **Steffen &
   Hotchkiss's per-trial uncertainties**, **Delcea's 24-method time table**, and **Schultz's
   per-strategy boarding times in seconds**. Until then, every number above is search-index
   provenance, not PDF provenance.
2. **No published walk-back / gate-check time penalty** exists in the peer-reviewed boarding
   literature as far as could be determined — only qualitative treatment, plus the
   capacity-constrained optimisation in Schultz et al. 2023. Our penalty model (§7) is
   extrapolation.
3. **No explicit group-size PMF** is published; only the 73%-alone (business) / 19%-alone
   (leisure) split. Our PMF (§6) is inference.
4. **Conflicting effective aisle speeds** between the Schultz family (0.8 m/s) and the Delcea
   NetLogo family (0.33 m/s max, at 0.4 m per 1.2 s tick). These are not reconcilable as the
   same quantity — the NetLogo value folds stop-and-go and processing into the step. We use
   Schultz's.
5. One search result reported per-passenger boarding rates ("Steffen 0.73 ± 0.020 minutes per
   passenger") from the A320 DES study that are **internally inconsistent** with the reported
   totals. These were excluded rather than propagate a likely mis-parse. If anyone later finds
   that figure quoted elsewhere, treat it as suspect until the source table is read directly.
