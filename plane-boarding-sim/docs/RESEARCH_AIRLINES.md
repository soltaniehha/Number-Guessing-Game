# Airline Boarding Practice — Realism Reference

**This document is the realism reference for the boarding-tier strategies in `STRATEGIES.md`,
specifically `priority_5tier` (§12) and `common_sense_5tier` (§13).**

Those two strategies are the only ones in the simulator that claim to model *what airlines actually
do* rather than *what the literature says is fast*. Everything else in `STRATEGIES.md` is a
laboratory method and is justified by `RESEARCH_PARAMETERS.md`. This file is where the claim "this
is realistic" has to be defended. If a boarding tier in `strategies.ts` does not match a structure
recorded below, either fix the strategy or record here why the deviation is deliberate.

## Research constraints (read this before trusting anything)

`WebFetch` and `curl` were blocked at the session's egress proxy for essentially every domain
attempted, including airline investor-relations PDFs (`s202.q4cdn.com` returned `EGRESS_BLOCKED`).
**Everything below was assembled from web-search full-text extracts, not from reading airline
policy pages, press releases or papers directly.** This matters more here than in the other two
research documents, because airline boarding policy is (a) frequently changed and (b) heavily
paraphrased by aggregator/SEO sites which propagate each other's errors. Where two sources
disagree on a date or a group number, I have said so rather than picking one silently.

The single most conspicuous instance: aggregator pages written in 2026 routinely date United's
WilMA rollout to **October 2025**. Contemporaneous reporting from CBS, CBC, NPR, Axios, ABC News
and Fortune, all filed 18–19 October 2023 and all describing an internal memo naming **26 October
2023**, is unambiguous. The 2025 date is error propagation. See §2.

## Confidence notation

Matching `RESEARCH_PARAMETERS.md`:

| Marker | Meaning |
|---|---|
| **[C]** | **Corroborated** — recovered from at least two independent sources that agree. |
| **[S]** | **Single-source** — recovered once, uncorroborated. Usable; verify before it drives a headline claim. |
| **[D]** | **Derived** — my arithmetic from **[C]**/**[S]** inputs. Inputs cited; arithmetic mine. |

Anecdote is marked as anecdote and is never promoted to **[S]**.

---

# 1. Real boarding group structures, 2025–2026

## 1.1 Delta — 8 zones plus preboarding

Delta moved from *branded* boarding calls ("Now boarding Comfort+") to *numbered zone* calls in
**May 2024** **[C]**, then in **May 2025** announced the fare/product rebrand — Main Cabin →
**Delta Main**, Comfort+ → **Delta Comfort**, First Class → **Delta First**, plus **Delta Premium
Select** and **Delta One** — with Basic Economy folded into Delta Main as one of three
"experiences": **Main Basic / Main Classic / Main Extra**. Booking opened for the new structure on
**1 October 2025** **[C]**.

The zone count did **not** change: it is still **eight numbered zones plus preboarding** **[C]**.

| Order | Zone | Contents | Lane |
|---|---|---|---|
| 0 | Preboard | Passengers needing extra time / ACAA assistance; unaccompanied minors; customers with strollers and car seats; active-duty military | — |
| 1 | Zone 1 | **Delta One**, **Delta First** | Sky Priority |
| 2 | Zone 2 | **Delta 360°** members, **Diamond Medallion**, **Delta Premium Select** | Sky Priority |
| 3 | Zone 3 | **Delta Comfort** | Sky Priority |
| 4 | Zone 4 | **Platinum** and **Gold Medallion**, **SkyTeam Elite Plus** — i.e. the remaining Sky Priority population | Sky Priority |
| 5 | Zone 5 | **Silver Medallion**; **Delta Main Extra**; Delta co-brand cardholders (Gold / Platinum / Reserve, personal and business) | General |
| 6 | Zone 6 | **Delta Main Classic**, SkyMiles members | General |
| 7 | Zone 7 | **Delta Main Classic**, non-members | General |
| 8 | Zone 8 | **Delta Main Basic** (basic economy) | General |

**Where SkyPriority sits:** SkyPriority is not a zone. It is a *lane* and an eligibility set
(Delta One / Premium Select / First, plus Diamond / Platinum / Gold Medallion, plus SkyTeam Elite
Plus). Operationally, **Zones 1–4 board through the Sky Priority lane and Zones 5–8 through the
General lane** **[C]**. A SkyTeam Elite Plus member with no Delta status and a Main Basic ticket is
the awkward edge case that generates FlyerTalk threads: the fare drives the zone, so the zone can
be 8 while the lane entitlement says SkyPriority **[S]**.

Delta also **cut Delta 360° from preboarding** and pushed it into Zone 2 in the May 2025 revision
— i.e. Delta's response to preboard bloat was to *shrink* the preboard list **[S]**.

Sources: [One Mile at a Time — zone-based boarding](https://onemileatatime.com/news/delta-boarding-process/) ·
[Delta — Boarding Priority](https://www.delta.com/us/en/check-in-security/boarding-priority) ·
[Delta News Hub — new product names](https://news.delta.com/now-booking-delta-new-product-names-and-travel-experiences-flying-fall) ·
[UpgradedPoints — Delta boarding zones](https://upgradedpoints.com/travel/airlines/delta-air-lines-boarding-zones/) ·
[AwardWallet — Delta boarding order](https://awardwallet.com/airlines/delta-skymiles/delta-boarding-order/) ·
[Eye of the Flyer — Delta 360 boarding zone](https://eyeoftheflyer.com/2025/05/15/delta-360-boarding-zone/) ·
[Delta — Sky Priority](https://www.delta.com/us/en/check-in-security/sky-priority)

**Note for the simulator: Delta has no seat-letter or row logic anywhere in its boarding order.**
It is a pure revenue/status ladder from top to bottom. Delta is the cleanest real-world instance of
`priority_5tier`.

## 1.2 United — Groups 1–6 plus preboarding, with WilMA in Groups 3/4/5

United reintroduced **WilMA (window–middle–aisle)** on **26 October 2023** **[C]**. It had used
outside-in previously and abandoned it around **2017** when Basic Economy and its carry-on
restrictions were introduced **[S]**.

| Order | Group | Contents |
|---|---|---|
| 0 | Preboard | Customers needing assistance; unaccompanied minors; active-duty uniformed military; families travelling with children **age 2 and under**; Global Services |
| 1 | Group 1 | Polaris / First / Business; **Premier 1K** |
| 2 | Group 2 | **Premier Platinum, Gold, Silver**; Star Alliance Gold and Silver; **Premier Access** purchasers; co-brand cardholders |
| 3 | Group 3 | **Economy WINDOW seats**, plus **exit-row** seats |
| 4 | Group 4 | **Economy MIDDLE seats** |
| 5 | Group 5 | **Economy AISLE seats** |
| 6 | Group 6 | **Basic Economy** (this group was *created* by the WilMA change; Basic Economy was previously Group 5) |

**[C]** on the W/M/A assignment to Groups 3/4/5 and on Group 6 being new for Basic Economy.
**Caveat:** launch-day 2023 coverage repeatedly wrote that "the change begins with passengers in
boarding Group 4". That phrasing is inconsistent with the same articles' statement that a *new*
Group 6 was added for Basic Economy which had been Group 5 — which forces window/middle/aisle into
3/4/5. Later structural guides list 3/4/5 = W/M/A explicitly. I treat 3/4/5 as correct and the
"Group 4" phrasing as loose reporting, but this is the one structural detail in this document I
would re-verify against united.com before hard-coding **[S]** on the resolution.

### How United handles parties split by seat letter

This is the mechanism the simulator most needs to get right, and United states it plainly:

> **Multiple customers on the same economy reservation receive the same — and highest applicable —
> boarding group**, excluding Basic Economy customers in Group 6.

So a family holding 12A/12B/12C all board in **Group 3**, because one of them has the window
**[C]**. Party cohesion is **not** an optional refinement bolted onto WilMA; it is written into the
group-assignment rule at check-in, upstream of the gate. The whole PNR gets one group number
printed on all its boarding passes.

**Has it been kept?** Yes. It is still the live scheme as of this research pass, and United paired
it with a fleet-wide **larger overhead bin retrofit** explicitly because Group 5 (aisle) boards
last and is therefore most exposed to bin exhaustion and gate-check **[C]**. That retrofit
commitment is the strongest evidence that United considers WilMA permanent rather than a trial.

Sources: [CBS News](https://www.cbsnews.com/news/united-air-window-seats-economy-class-board-first-wilma-plan/) ·
[CBC](https://www.cbc.ca/news/business/united-airlines-boarding-system-1.7006032) ·
[NPR](https://www.npr.org/2023/10/19/1207255409/united-airlines-new-boarding-policy) ·
[Axios](https://www.axios.com/2023/10/18/united-airlines-new-boarding-window-seats-wilma) ·
[ABC News](https://abcnews.go.com/GMA/Travel/united-airlines-prioritize-window-seat-boarding-speed-things/story?id=104069073) ·
[Forbes — the math behind it](https://www.forbes.com/sites/marisagarcia/2023/10/23/united-airlines-window-to-aisle-boarding-how-much-does-it-save/) ·
[UpgradedPoints — United boarding groups](https://upgradedpoints.com/travel/airlines/united-airlines-boarding-groups/) ·
[Simple Flying — WilMA guide](https://simpleflying.com/united-airlines-wilma-boarding-method-guide/) ·
[CNBC Select](https://www.cnbc.com/select/united-boarding-process-prioritize-window-seats/)

## 1.3 American — Groups 1–9 plus preboarding

American revised its structure effective **1 May 2025** **[C]**. The headline change: **First and
Business Class moved out of Group 1 and into preboarding**, alongside ConciergeKey.

| Order | Group | Contents |
|---|---|---|
| 0 | Preboard | **ConciergeKey**; **First and Business Class**; families with children **under 2**; customers needing assistance |
| 1 | Group 1 | **AAdvantage Executive Platinum**; active-duty US military with ID |
| 2 | Group 2 | **Platinum Pro**; oneworld Emerald |
| 3 | Group 3 | **Platinum**; oneworld Sapphire |
| 4 | Group 4 | **Gold**; oneworld Ruby; **Premium Economy**; Citi/AAdvantage Executive cardmembers |
| 5 | Group 5 | **Main Cabin Extra** (excluding Basic Economy); AAdvantage members with 15,000 Loyalty Points; eligible AAdvantage co-brand cardmembers ("Preferred boarding") |
| 6 | Group 6 | AAdvantage members (no status) |
| 7 | Group 7 | Main Cabin |
| 8 | Group 8 | Main Cabin |
| 9 | Group 9 | **Basic Economy** |

Groups 1–4 use the priority lane; 5–9 use the main lane **[C]**.

American is the *purest* revenue ladder in the industry — nine numbered groups, none of which has
any spatial content whatsoever. It is also the carrier that has invested most in **enforcing** the
ladder rather than optimising it: from **November 2024** it deployed gate software at **100+
airports** that emits a two-note error tone when a boarding pass is scanned before its group is
called, and turns the passenger away **[C]**. American's stated result was that response "exceeded
our expectations". Note what this tells you: American's identified boarding problem is
*non-compliance with the revenue ladder*, not *flow*.

Former AA CEO Doug Parker, on why the airline does not chase flow-optimal methods: *"We've studied
this with operations engineers who go look and watch and we don't see any material change."*
**[S]**

Sources: [One Mile at a Time — American boarding priority/groups](https://onemileatatime.com/news/american-boarding-process-priority-groups/) ·
[NerdWallet](https://www.nerdwallet.com/travel/learn/understanding-american-airlines-boarding-groups-and-how-you-can-upgrade) ·
[UpgradedPoints](https://upgradedpoints.com/travel/airlines/american-airlines-boarding-groups/) ·
[PointsCrowd — May 2025 changes](https://www.pointscrowd.com/blog/american-airlines-boarding-changes/) ·
[CNBC — boarding line tech](https://www.cnbc.com/2024/11/20/american-airlines-boarding-line-shaming-technology.html) ·
[UPI](https://www.upi.com/Top_News/US/2024/11/21/american-airines-boarding-technology/6951732232909/) ·
[View from the Wing — Parker quote](https://viewfromthewing.com/airlines-arent-ignoring-a-faster-way-to-board-planes-theyve-tested-it-and-it-fails/)

## 1.4 Southwest — open seating abandoned 27 January 2026, replaced by assigned seats + WilMA

This is the most important development for this simulator since the strategy list was written, and
`STRATEGIES.md` §11 is now describing a historical method.

**What happened.** Southwest ended open seating on **27 January 2026** — the first assigned seating
in the airline's 53-year history **[C]**. It did **not** keep the numbered-position queue. The
A/B/C group + numbered position system (A12, C22) and the **numbered metal stanchions** are gone,
replaced by **eight numbered boarding groups (1–8)** and an **alternating two-lane gate with
digital screens** showing the group being called **[C]**.

**What replaced it — and this is the surprise: Southwest adopted WilMA.**

> Customers with **window seats** board first, then **middle**, then **aisle**, with boarding
> occurring **from the back of the plane to the front**. **[C]**

That is a **WilMA × back-to-front hybrid** — structurally the closest thing in current commercial
service to the simulator's `wilma_zoned` (§5), and arguably to `reverse_pyramid` (§8).

Group assignment is a joint function of **fare type, seat type and location, Rapid Rewards tier
status, and Rapid Rewards credit card benefits** **[C]**:

| Order | Group | Contents |
|---|---|---|
| 0 | Preboard / Priority area | Customers needing to preboard; active-duty military; purchasers of the new **Priority Boarding** product. **Preboards now go directly to their assigned seats.** |
| — | before Group 1 | **A-List Preferred** |
| 1 | Group 1 | **A-List Preferred / A-List VIP** and **Choice Extra** fares, and Extra Legroom purchasers/upgraders — reportedly the **window** subset first |
| 2 | Group 2 | Remaining **Choice Extra** (middle/aisle) and **A-List** members |
| 3–5 | Groups 3–5 | **A-List**, **Choice Preferred** and **Choice** fares, following the WilMA sequence; **Rapid Rewards cardmembers** who did not earn an earlier group land in **Group 5** |
| 6–8 | Groups 6–8 | **Choice** and **Basic** fares, and late check-ins |

The window/middle/aisle split *within* the fare/status bands is **[S]** on the exact
group-by-group mapping (the detail comes from secondary coverage, and Southwest's own material
describes the inputs rather than publishing the matrix), but **[C]** on the principle that seat
location is one of the assignment inputs and that the order is window → middle → aisle,
rear → front.

**Fares:** Basic (seat assigned at check-in) / Choice (Standard seat at booking) / Choice Preferred
(Preferred seat, forward cabin) / Choice Extra (Extra Legroom, front and exit rows) **[C]**.
Priority Boarding is purchasable by anyone from 24 hours before departure **[C]**.

**The preboarding angle is the real motive, per several commentators.** Southwest's open seating
made a wheelchair preboard worth a free front-row seat. Assigned seating destroys that incentive at
a stroke, and Southwest **ended its wheelchair-first boarding advantage on 26 January 2026** — the
day before assigned seating went live **[C]**. Legally mandated ACAA accommodation is unchanged;
what changed is that preboarding no longer buys a better seat, only earlier access. See §3.

Sources: [Southwest — Assigned Seating](https://www.southwest.com/customer-enhancements/assigned-seating/) ·
[SWA Newsroom — new gate experience](https://www.swamedia.com/news-and-stories/news-release/a-closer-look-at-our-new-gate-experience-and-boarding-process-MCOCUOE2IZIVG25HXBXUYZB6URQI) ·
[TravelPulse](https://www.travelpulse.com/news/airlines-airports/southwest-airlines-shares-new-gate-experience-boarding-process-for-2026) ·
[Men's Journal — Southwest WilMA](https://www.mensjournal.com/travel/southwest-unveils-new-wilma-boarding-process) ·
[Fox Business](https://www.foxbusiness.com/fox-news-travel/southwest-airlines-roll-sweeping-overhaul-boarding-process-here-details) ·
[UpgradedPoints — Southwest 2026](https://upgradedpoints.com/travel/airlines/southwest-airlines-boarding-process-groups/) ·
[View from the Wing — wheelchair boarding advantage ends](https://viewfromthewing.com/southwest-ends-its-wheelchair-boarding-advantage-january-26-but-the-airport-vip-line-skipping-hack-isnt-going-away/) ·
[AFAR](https://www.afar.com/magazine/why-southwest-now-uses-assigned-seating-and-how-it-works)

## 1.5 Ryanair / easyJet / Wizz Air — priority vs. non-priority, and two-door boarding

The European ULCCs are structurally different from everything above in one way that matters
enormously for a boarding simulator: **they board through two doors simultaneously.**

**Ryanair.** Two tiers only: **Priority (purchased)** and everyone else. Priority cannot be earned
— there is no status programme; it is bought, and it bundles a second 10 kg / 55×40×20 cm cabin bag
**[C]**. Seats are randomly allocated free at online check-in (24 h to 2 h out) unless purchased
**[C]**. **Door assignment is printed on the boarding pass** — front airstairs or rear airstairs —
and the split is by row, typically **rows ~16 and higher use the rear stairs** **[C]**. Families
who want to sit together must reserve seats; adults with children must select adjacent seats
**[C]**.

**easyJet.** Boards most aircraft through **both front and rear doors**, with the door printed on
the boarding pass: front-half rows through the front, rear rows via the rear stairs **[C]**.
**Speedy Boarding** is no longer sold standalone — as of 2026 it comes bundled with easyJet Plus
membership, Standard Plus / FLEXI fares, or as an automatic inclusion when you buy a Large Cabin
Bag **[S]**. Doors close 30 minutes before departure **[C]**.

**Wizz Air.** **WIZZ Priority** = priority lane + a second trolley bag **[C]**. At **remote/bus
stands** the priority benefit largely evaporates: priority passengers board the *bus* first, then
everyone waits for the last bus, and the aircraft is boarded by everyone more or less at once
**[S]**. No corroborated source found for Wizz's front/rear door split policy.

**Modelling note:** none of the three has any seat-letter or (aside from door assignment)
row-sequencing logic in the *order*; the flow benefit comes from the second door, which is a cabin
topology feature, not a strategy. This is worth keeping separate in the simulator: two-door
boarding is a much larger effect than any ordering strategy, and the ULCC "strategy" is essentially
`random` split across two entry points.

Sources: [UpgradedPoints — Ryanair boarding](https://upgradedpoints.com/travel/airlines/ryanair-boarding-process/) ·
[TravelUpdate — Ryanair boarding](https://travelupdate.com/time-saving-ryanair-boarding/) ·
[UpgradedPoints — easyJet boarding](https://upgradedpoints.com/travel/airlines/easyjet-boarding-groups/) ·
[Wizz Air — boarding process](https://www.wizzair.com/en-gb/help-centre/check-in-and-boarding/boarding/boarding-process) ·
[Wizz Air — WIZZ Priority](https://www.wizzair.com/en-gb/information-and-services/wizz-services/wizz-priority)

## 1.6 British Airways — cut from 9 groups to 7 in April 2025, and added back-to-front

BA is the counter-example to the "groups only ever multiply" narrative. It ran **nine** boarding
groups, trialled a simplification, and made it permanent from **April 2025** **[C]**.

| Order | Group | Contents |
|---|---|---|
| 0 | Preboard | Passengers with children; reduced mobility |
| 0 | **Group 0** | **BA Premier**; Gold Guest List |
| 1 | Group 1 | First; **Gold**; oneworld Emerald |
| 2 | Group 2 | Club/Business; **Silver**; oneworld Sapphire |
| 3 | Group 3 | World Traveller Plus / Premium Economy; **Bronze**; oneworld Ruby; AerClub status |
| 4 | Group 4 | **Economy — REAR of the cabin** |
| 5 | Group 5 | **Economy — FRONT of the cabin** (short haul stops here) |
| 6 | Group 6 | **Economy — front, long haul only** |

Groups 0–3 are the "Priority Group". Groups 7–9 were deleted on long haul; 6–9 on short haul
**[C]**. BA's stated rationale for the 4/5(/6) split is explicitly a flow argument: *Group 4
passengers can reach the back of the aircraft without being blocked by people seated further
forward* **[C]**.

So BA is a **status ladder followed by a two- or three-band back-to-front economy split**. It has
no seat-letter logic.

Sources: [Head for Points — BA cuts boarding groups](https://www.headforpoints.com/2025/03/31/british-airways-boarding-process/) ·
[Head for Points — how BA boarding groups work](https://www.headforpoints.com/2026/09/07/how-do-british-airways-boarding-groups-work-2/) ·
[Paddle Your Own Kanoo](https://www.paddleyourownkanoo.com/2025/03/26/british-airways-is-changing-its-boarding-groups-once-again-but-this-time-they-are-actually-making-it-more-simple/) ·
[British Airways — Boarding](https://www.britishairways.com/content/information/checking-in-and-boarding/boarding)

## 1.7 Lufthansa — a full WilMA implementation with an explicit companion rule

Lufthansa is the European carrier running the closest thing to a textbook outside-in scheme:
**five groups + preboarding on continental, six + preboarding on intercontinental** **[C]**.

| Order | Group (continental) | Contents |
|---|---|---|
| 0 | Preboard | Unaccompanied minors; reduced-mobility passengers; families with infants and **children under 5** |
| 1 | Group 1 | **HON Circle**; First Class |
| 2 | Group 2 | Business Class; **Senator**; Star Alliance Gold; Economy Flex |
| 3 | Group 3 | **Economy WINDOW seats — and their companions** |
| 4 | Group 4 | **Economy MIDDLE seats — and their companions** |
| 5 | Group 5 | **Economy AISLE seats** (this group is where intercontinental adds its extra band) |

The **"and companions"** wording is doing real work: Lufthansa, like United, resolves the
party-splitting problem by promoting the whole booking to the earliest member's group. **[C]** on
the W/M/A structure; **[S]** on the exact continental/intercontinental group-count difference.

Sources: [Lufthansa — Boarding](https://www.lufthansa.com/us/en/boarding) ·
[UpgradedPoints — Lufthansa boarding](https://upgradedpoints.com/travel/airlines/lufthansa-boarding-process/)

## 1.8 Air France — 5 zones plus preboarding

Air France uses **Zones 1–5 on all flights**, plus a preboarding call for reduced mobility,
unaccompanied minors, and **families with children aged 6 and under** **[C]**. Zone 1 is Business
plus **Flying Blue Ultimate** and the invitation-only **Club 2000** and **Skipper** tiers **[C]**.
Zones 2–5 are the status/cabin ladder down through Economy; no seat-letter or row logic was found
in any source **[S]** on the absence.

Source: [Air France — Boarding by zone](https://wwws.airfrance.us/information/aeroport/zones-embarquement) ·
[UpgradedPoints — Air France boarding](https://upgradedpoints.com/travel/airlines/air-france-boarding-groups/)

## 1.9 Asian and Middle Eastern carriers doing something structurally different

This is where the most interesting deviations live, and where the "airlines never optimise flow"
story falls apart.

### ANA — full WilMA in economy

ANA divides economy into **three groups — window, middle, aisle — and boards them in that order**,
after preboarding and Groups 1–2 (status holders and Premium Class) **[C]**. Order varies by
aircraft type **[S]**.

### JAL — window + rear, derived from an actual simulation study

JAL is the only carrier found in this research pass whose boarding order is publicly attributed to
a named research collaboration. Effective **11 September 2024**, JAL revised domestic boarding on
its widebodies (A350-900, 767-300ER, 777-300ER, 787-8) based on **joint research with Tokyo
Institute of Technology** **[C]**:

| Order | Group | Contents (revised) |
|---|---|---|
| 0 | Preboard | Passengers requiring assistance; travellers with small children |
| 1–2 | Groups 1–2 | First Class; frequent-flyer status holders |
| 3 | **Group 3** | **Rows 40 and above**, **+ window seats (A and K)**, **+ emergency exit rows** |
| 4 | Group 4 | Everyone else |
| 5 | — | **Group 5 eliminated** |

The previous Group 3 was rows 40+ and exit rows only; the revision **added window seats** to it,
and collapsed the old Group 4 (rows 20+) and Group 5 into a single final group **[C]**.

Methodology, per JAL: a **360-degree camera installed in an A350-900 cabin** captured passenger
movement, and the data drove **~1,000 simulated full-aircraft boardings** to pick the ordering
**[C]**. JAL boards its A350s **15 minutes before departure** on domestic services **[S]** —
against the US norm of 30–40 minutes for ~140 passengers (§2.4).

**Structurally, JAL Group 3 is a coarse two-clause reverse pyramid quantised into a single
announceable group** — the rear of the aircraft *plus* the outermost seat column, boarding
together. This is the closest published relative of `common_sense_5tier`, and it is proof that a
compound seat-and-row rule is gate-announceable and boarding-pass-printable. It is also *simpler*
than ours: JAL went from five groups to four, we propose five.

### Emirates

Premium cabins and status board first; **the economy cabin is then boarded back to front by seat
row** **[S]**.

### Qatar Airways

Preboarding (infants, special assistance) → **Zone 1**: First, plus Silver/Gold/Platinum Privilege
Club → **Zone 2**: Business, Burgundy → **Zones 3–6: Economy, by seat row** **[S]**.

### Singapore Airlines

No corroborated boarding-zone structure was recoverable. Recorded as a gap (§6).

Sources: [ANA — Boarding Order (International)](https://www.ana.co.jp/en/jp/guide/boarding/int_info/) ·
[JAL — Boarding Sequence](https://www.jal.co.jp/jp/en/dom/boarding/yuusen/) ·
[Japan Aviation Hub — JAL boarding order revision](https://japanaviationhub.com/news/jal-boarding-order-revision/) ·
[Travel Voice — JAL / Tokyo Tech](https://www.travelvoice.jp/english/jal-changes-boarding-orders-for-its-domestic-flights-to-more-smooth-way-based-on-a-joint-research-with-tokyo-institute-of-technology) ·
[TRAICY Global](https://en.traicy.com/posts/2024091113045/) ·
[One Mile at a Time — JAL 15-minute boarding](https://onemileatatime.com/insights/japan-airlines-15-minute-boarding/) ·
[UpgradedPoints — Emirates boarding](https://upgradedpoints.com/travel/airlines/emirates-boarding-process-and-groups/) ·
[Qatar boarding zones](https://groupbooking.odoo.com/blog/our-blog-12/how-does-qatar-airways-boarding-zones-work-100)

## 1.10 Summary table — what each carrier's economy ordering is *actually* driven by

| Carrier | Groups | Economy ordering logic | Simulator analogue |
|---|---|---|---|
| Delta | 8 + preboard | Fare brand + status only | `priority_5tier` |
| American | 9 + preboard | Fare + status + loyalty points only | `priority_5tier` |
| Air France | 5 + preboard | Cabin + status only | `priority_5tier` |
| British Airways | 7 (G0–G6) | Status, then **rear→front bands** | `priority_5tier` → `back_to_front` |
| Emirates / Qatar | ~4–6 | Cabin + status, then **row zones rear→front** | `block_boarding` |
| United | 6 + preboard | Status, then **W/M/A** | `priority_5tier` → `wilma` |
| Lufthansa | 5–6 + preboard | Status, then **W/M/A (+companions)** | `priority_5tier` → `wilma` |
| ANA | ~5 | Status, then **W/M/A** | `priority_5tier` → `wilma` |
| JAL | 4 + preboard | Status, then **rear rows + windows together** | coarse `reverse_pyramid` |
| **Southwest (2026)** | 8 + preboard | Fare + status + **seat location: W/M/A, rear→front** | `wilma_zoned` / `reverse_pyramid` |
| Ryanair / easyJet | 2 | Purchased priority only; **two-door** by row | `random`, two doors |

**Five of the eleven now have spatial logic in economy, and three of those five are outside-in.**

---

# 2. Has anyone actually deployed a flow-optimised method?

## 2.1 America West / US Airways reverse pyramid (2003)

The canonical case. Developed jointly by **Arizona State University** and America West staff — van
den Briel, Villalobos, Hogg, Lindemann and Mulé — and published as *America West Airlines Develops
Efficient Boarding Strategies*, **Interfaces 35(3):191–201 (2005)** **[C]**.

Deployed **September 2003**. Published results:

| Metric | Result |
|---|---|
| Average boarding time, full / near-full flights | **−2 minutes, ≈ −20%** **[C]** |
| Departure delays, first three months post-launch | **−21%** **[S]** |

The method: a hybrid of back-to-front and outside-in, boarding window and middle passengers near
the rear first and front aisle seats last — i.e. a diagonal wave, exactly the construction in
`STRATEGIES.md` §8.

**What happened to it.** I could not establish this to a **[C]** standard, and I want to be explicit
about that rather than repeat the internet's guesses. What is recoverable:

- The method was designed for **single-aisle** aircraft; the US Airways merger brought widebody
  Airbus types into the fleet, and this fleet mismatch is cited as a contributing factor **[S]** —
  a weak source, and note it is a *partial* explanation at best, since the narrowbody fleet
  remained the majority.
- Boarding procedures were **unified during post-merger integration** and, later, again during the
  US Airways/American integration **[S]**. Procedure harmonisation across merged carriers is the
  ordinary mechanism by which a local optimisation dies; the surviving carrier's system wins on
  IT and training grounds, not on merit.
- No source was found in which any airline stated a *performance* reason for abandoning reverse
  pyramid.

**Honest conclusion: reverse pyramid was not killed by evidence that it failed. It was killed by
two mergers.** It vanished into the American Airlines nine-group revenue ladder, which is what
happens to any process that is not owned by the acquiring carrier's operations organisation. This
is worth stating in the simulator's own commentary, because the usual framing — "airlines tried it
and it didn't work" — is not supported by anything I could find.

Sources: [Interfaces 35(3):191–201](https://pubsonline.informs.org/doi/10.1287/inte.1050.0135) ·
[ASU research listing](https://asu.elsevierpure.com/en/publications/america-west-airlines-develops-efficient-boarding-strategies/) ·
[IDEAS/RePEc listing](https://ideas.repec.org/a/inm/orinte/v35y2005i3p191-201.html) ·
[van den Briel — group/zone boarding project page](https://leeds-faculty.colorado.edu/vandenbr/projects/boarding/html/boarding.htm) ·
[Simple Flying — America West history](https://simpleflying.com/why-america-west-arlines-stopped-flying/)

## 2.2 Has anyone deployed Steffen?

**No commercial airline has ever deployed the Steffen method, in either its perfect or its
modified form.** **[C]** — this is asserted consistently across every source found and contradicted
by none.

The nearest live relatives are:

- **JAL Group 3** (rear rows + windows in one call) — a two-clause partial ordering, not Steffen.
- **Southwest 2026** (W/M/A × rear→front) — this is `wilma_zoned`, which shares Steffen's
  *aisle-spreading* intuition but not its row-parity sequencing.
- **`steffen_modified`'s four-group construction** (parity × side) is announceable in principle,
  and no airline has tried it.

The reason is not that airlines are unaware of it. Steffen's method has had mainstream press
coverage since 2011 and a televised physical test. The binding constraints are in §2.4.

Sources: [Steffen Boarding Method (overview)](https://en.wikipedia.org/wiki/Steffen_Boarding_Method) ·
[Steffen & Hotchkiss, *Experimental test of airplane boarding methods*](https://arxiv.org/pdf/1108.5211) ·
[The Conversation](https://theconversation.com/passengers-boarding-airplanes-were-doing-it-wrong-33615)

## 2.3 United's WilMA — what is actually published

This is the only large-scale live outside-in deployment with any public numbers attached, and the
numbers are thinner than the coverage suggests.

| Claim | Value | Confidence |
|---|---|---|
| United's own claim, pre-launch | **"up to 2 minutes"** saved per departure | **[C]** — repeated in the internal memo and by United's chief customer officer |
| Test scope before rollout | **one hub + four line stations**; "overall boarding time was reduced" | **[S]** |
| Aircraft ground cost used in the arithmetic | **≈ $100 per minute** | **[C]** (see §2.5) |
| Implied saving | 2 min × $100/min × **4,900 daily flights ≈ $1M/day**, ≈ **$200/flight** | **[D]** from the above |
| Post-deployment measurement published by United | **none found** | — |
| Third-party time-and-motion claim | outside-in "can reduce overall boarding time by **up to 10%**" | **[S]** — attributed to a 2024 airline-operations-firm study I could not identify or verify |
| IATA-attributed claim | smoother early flow can cut embarkation by **2–3 minutes** | **[S]** — attribution unverified |
| Cirium on-time performance | United OTP has improved since 2023 | **[S]** — and *uncontrolled*: United changed many things at once, so this is not attributable to WilMA |

**Bottom line: there is no published controlled measurement of what WilMA achieved in service.**
The "2 minutes" figure that circulates is a pre-launch projection, not a result. Do not treat it as
a validation target for the simulator. It is, however, in close agreement with the America West
reverse-pyramid *measured* 2-minute/20% figure, which is mildly reassuring for the model.

Sources: as §1.2, plus [AeroTime](https://www.aerotime.aero/articles/united-airlines-to-start-wilma-boarding-method-by-october-2023) ·
[Forbes — the math](https://www.forbes.com/sites/marisagarcia/2023/10/23/united-airlines-window-to-aisle-boarding-how-much-does-it-save/)

## 2.4 Why don't airlines use the fast methods? The concrete reasons

Ranked by how load-bearing each one actually is, with numbers where they exist.

### (a) Ancillary revenue — large, but priority boarding specifically is *not* separately disclosed

| Figure | Value | Confidence |
|---|---|---|
| Worldwide airline ancillary revenue, 2024 | **$148.4 billion** | **[C]** (IdeaWorks/CarTrawler) |
| Worldwide, 2025 projection | **$157 billion** | **[S]** |
| Worldwide, 2016 (for scale) | $67.4 billion | **[S]** |
| Ancillary as share of global airline revenue | **14.9%** | **[S]** |
| Airlines earning ≥ $1bn ancillary, 2025 | **30** (up from 27) | **[S]** |
| **United** total ancillary, 2024 | **$10.6bn — 18.6% of revenue** | **[S]** |
| **Delta** total ancillary, 2024 | **$10.2bn — 16.8%** | **[S]** |
| **American** total ancillary, 2024 | **$9.2bn — 17%** | **[S]** |
| Share of US legacy ancillary that is **loyalty programme** revenue | **40–50%** | **[S]** |
| **Seat fees**, AA+DL+UA+Spirit+Frontier, 2018–2023 cumulative | **$12.4 billion** | **[C]** (US Senate PSI report, Dec 2024) |
| Seat-fee revenue, 2023 alone, same five | **> $3 billion**, ≈ **+50% vs 2018** | **[C]** |
| **United seat selection revenue, 2023** | **$1.3bn — larger than its $1.2bn bag-fee revenue** | **[S]** |
| Per-passenger ancillary spend, US, 2024 | **$25**, up $11 in ten years, against an average one-way fare that *fell* from $270 (2015) to $158 (2024) | **[S]** |

**The important caveat, and it cuts against the simple story:** **no US major separately discloses
priority-boarding revenue.** What is disclosed is *seat selection* and *loyalty*. Priority boarding
at the US majors is overwhelmingly a **bundled** benefit — of a fare brand (Main Extra, Choice
Extra), a status tier, or a co-brand credit card — not a standalone SKU. So the honest formulation
is not "airlines earn $X billion selling early boarding"; it is:

> **Boarding order is the visible, physical, in-public delivery mechanism for status and co-brand
> value.** Its revenue significance is as the *demonstration* of a $10bn/year loyalty franchise,
> not as a line item. That is a stronger reason to protect it, not a weaker one — a
> flow-optimised order that seated a Diamond behind a Basic Economy passenger would devalue the
> franchise in the one place every passenger can see it. **[D]**

At the European ULCCs the calculus is more direct: priority is a genuine standalone/bundled SKU
tied to cabin-bag allowance (Ryanair, Wizz, easyJet-with-Large-Cabin-Bag) **[C]**.

### (b) Elite status obligations

Structural, not merely commercial. American, Delta and United each maintain **four or five**
published elite tiers whose *first named benefit* is priority boarding, plus oneworld/SkyTeam/Star
Alliance reciprocity obligations that require honouring **partner** elites (oneworld Emerald →
Group 2, SkyTeam Elite Plus → Zone 4, Star Gold → Group 2) **[C]**. An outside-in scheme that
overrode status would breach alliance reciprocity commitments, not just annoy customers.

Note the direction of travel: **American, Delta and BA all revised boarding in 2025, and every one
of those revisions was about the status ladder** (AA moved premium cabins to preboard; Delta
renumbered zones and demoted 360°; BA cut group count). Only BA's change had any flow content.

### (c) Family seating — real, but the *regulation* is not what people think

**Status check, and this is a correction worth making:** the US DOT family-seating rule is **a
proposed rule, not a final rule**. DOT issued an **NPRM on 9 August 2024** (*Family Seating in Air
Transportation*) that would require carriers to seat children **13 and under** adjacent to an
accompanying adult at no extra charge. **As of this research pass it has not been finalised, and
the current administration has not advanced it** **[C]**.

What *does* bind:

- **Voluntary commitments.** Seven US carriers — American, Delta, United, JetBlue, Frontier,
  Allegiant, Alaska — appear on DOT's **Family Seating Dashboard** as guaranteeing fee-free
  adjacent family seating **[C]**.
- **The NPRM's definition of "adjacent"** is *next to each other in the same row, not separated by
  the aisle* **[C]**. This is the clause that interacts badly with seat-letter boarding: a compliant
  family group is by construction **a set of different seat letters in one row**, i.e. exactly the
  set that WilMA splits.
- **Every deployed WilMA carrier has already solved this**, and all solved it the same way — by
  promoting the whole booking to the earliest-boarding member's group: United ("same and highest
  applicable boarding group" for the reservation), Lufthansa ("and companions") **[C]**.

So the correct statement is: **family seating does not prohibit outside-in boarding; it forces a
party-cohesion override that measurably degrades it.** Gary Leff's framing — you cannot send a
two-year-old down the jetbridge alone in the window wave — is the operational version of the same
point **[S]**.

### (d) Gate staffing, compliance and passenger confusion

- Steffen-grade methods require **individually sequencing passengers**, which means either a
  physical queue-ordering apparatus or per-passenger gate scanning against a sequence — neither of
  which US gates are staffed for **[S]**.
- Compliance is already the binding constraint on the *simple* schemes: American had to deploy
  audible line-jump enforcement at **100+ airports from November 2024** to make a nine-group
  ladder work **[C]**. If enforcing "wait for Group 6" needs a hardware rollout, enforcing "you are
  passenger 87, board between 86 and 88" is not a near-term product.
- `RESEARCH_PARAMETERS.md` records Schultz's field-calibrated **conformance rate of 85%** — i.e.
  ~1 passenger in 7 does not follow the called strategy even today. Steffen's advantage collapses
  under that; WilMA's largely does not, because WilMA is robust to local reordering. **[D]**

### (e) The counter-evidence airlines themselves cite

Doug Parker (then AA CEO), internal meeting: *"We've studied this with operations engineers who go
look and watch and we don't see any material change."* **[S]**

Take this with appropriate scepticism — it is an unrecorded internal remark relayed second-hand,
and it conflicts with America West's published 20% and BA's own stated rationale for its rear/front
split. But it is the clearest statement on record of a US major's *stated* reason.

### (f) The elephant: carry-on bags, not ordering

Two data points suggest the ordering strategy is second-order compared to bin contention:

- Boarding has slowed from **~15 minutes in the 1970s** to **30–40 minutes for ~140 passengers**
  today; the boarding *rate* has fallen by **more than 50%**, to as low as **9 passengers per
  minute** **[S]**.
- **Spirit found that charging $20–40 per carry-on bag cut boarding time by ~6 minutes** **[S]** —
  three times the best claimed ordering benefit, from a pricing change with no gate process change
  at all.

This is directly relevant to `by_bags` (§14) and to the bin-exhaustion modelling: if the sim shows
carry-on policy dominating boarding order, that is consistent with the field evidence, not a bug.

Sources: [IdeaWorks — 2024 worldwide estimate](https://ideaworkscompany.com/wp-content/uploads/2024/10/Press-Release-188-Worldwide-Estimate-2024.pdf) ·
[NBC News — Senate seat-fee report](https://www.nbcnews.com/business/travel/senate-report-slams-airlines-raking-billions-seat-fees-rcna181848) ·
[Forbes — US airlines' bag and seat revenue](https://www.forbes.com/sites/marisagarcia/2026/03/22/these-us-airlines-make-the-most-on-bags-and-seats/) ·
[Federal Register — Family Seating in Air Transportation (NPRM, 9 Aug 2024)](https://www.federalregister.gov/documents/2024/08/09/2024-17323/family-seating-in-air-transportation) ·
[PIRG — DOT family seating](https://pirg.org/edfund/updates/free-family-seating-on-airplanes-to-be-required-under-new-dot-rule/) ·
[NPR — DOT family seating](https://www.npr.org/2024/08/01/g-s1-14662/airline-junk-fees-family-seating-dot) ·
[View from the Wing — "they've tested it, and it fails"](https://viewfromthewing.com/airlines-arent-ignoring-a-faster-way-to-board-planes-theyve-tested-it-and-it-fails/) ·
[Cranky Flier — charge for carry-ons](https://crankyflier.com/2017/03/07/the-airlines-will-never-get-boarding-right-but-they-could-if-they-charged-carry-ons/) ·
[NBC News — the cattle call at Gate 15](https://www.nbcnews.com/id/wbna45113287) ·
[A4A — US passenger carrier delay costs](https://www.airlines.org/dataset/u-s-passenger-carrier-delay-costs/)

## 2.5 Cost of a boarding minute — for the simulator's cost model

| Source | Value | Confidence |
|---|---|---|
| A4A, 2024 — direct operating cost of aircraft **block time** | **$100.76 per minute** | **[S]** |
| United's own planning figure | **≈ $100 per minute** of ground time | **[C]** (consistent with A4A) |
| Academic range for **turn-around** time cost | **$77 – $250 per minute** | **[S]** |
| Marginal saving per turn from 1 minute less turn time (one study) | **$30** | **[S]** |

**Use $100/min as the headline and carry the $30–$250 range as the uncertainty band.** The gap
between "$100/min block cost" and "$30/min marginal turn saving" is not a contradiction — the
former is fully-allocated cost, the latter is what an airline actually banks from a minute it
cannot resell. **[D]** Quoting the $100 figure as a *saving* (as United's $1M/day arithmetic does)
overstates it substantially.

---

# 3. Preboarding

## 3.1 What preboards

The floor is set by the **Air Carrier Access Act**: carriers **must** offer preboarding to
passengers with a disability who self-identify at the gate as needing additional time or
assistance, and preboarding means **before all other passengers, including first class, elite-level
passengers and military** **[C]**. This is why every scheme in §1 has a preboard bucket ahead of
its Tier 1, and it validates the simulator's `preboardFirst` post-processing step.

Above the legal floor, carrier-elected categories vary:

| Category | Delta | United | American | Southwest (2026) | Lufthansa | Air France |
|---|---|---|---|---|---|---|
| Disability / extra time (ACAA) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Unaccompanied minors | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| Families with young children | strollers/car seats | **under 2** | **under 2** | — | **under 5** | **6 and under** |
| Active-duty military | ✓ | ✓ | Group 1, not preboard | ✓ | — | — |
| Top-tier elite | **removed** (360° → Zone 2) | Global Services | ConciergeKey | A-List Preferred (before G1) | — | — |
| Premium cabin | Zone 1 | Group 1 | **✓ — First/Business preboard since May 2025** | — | Group 1 | Zone 1 |
| Purchased priority | — | — | — | ✓ (new product) | — | — |

Note the divergence: **American moved premium cabins *into* preboard in 2025; Delta moved its top
tier *out* of preboard in the same year.** There is no industry consensus on what preboard is for.

## 3.2 What fraction of a flight preboards

No airline publishes this. The best available anchor:

- **American received "more than 8 million" wheelchair-assistance requests in 2023** **[C]**.
- American carried on the order of **200 million passengers** in 2023 → **≈ 4% of all passengers
  request wheelchair assistance somewhere in the journey** **[D]**.
- On a 180-seat narrowbody at the simulator's 85% load factor (153 pax), 4% ≈ **6 passengers**
  **[D]**. Add unaccompanied minors, families with under-2s, and military and a **typical preboard
  bucket of 5–10% of the cabin (≈ 8–15 passengers on a 737/A320)** is a defensible default
  **[D]**.
- IATA reports wheelchair-assistance requests growing by **as much as 30% per year at some major
  airports** **[C]**; UK airports reported **+21%** year on year against a 3.68 million baseline
  **[S]**; Dubai International alone handled **>1.4 million** requests in 2024 **[S]**. Whatever the
  right number is today, it is rising fast.

**Leisure-market flights are dramatically worse than the average, and this is where the simulator's
preboard fraction should be sweepable rather than fixed.** See below.

## 3.3 "Jetbridge Jesus" / "miracle flights" — what is actually measured

The phenomenon: passengers request wheelchair assistance to preboard (and skip security and gate
queues), then walk off unaided on arrival.

**There is no peer-reviewed or airline-published measurement of the rate.** Everything below is
crew or passenger observation, reported in trade/consumer media. It is recorded here as *anecdote*,
and the simulator should not calibrate against it — but the magnitudes are large enough that
ignoring them entirely is also wrong.

| Observation | Boarded in wheelchairs | Deplaned in wheelchairs | Load |
|---|---|---|---|
| Southwest flight (widely reported) | **28** | 2–3 | **85 pax → ~33% of the cabin** |
| Southwest, Florida market | **30** | 2 | not stated |
| Southwest, San Juan outbound | 25 wheelchairs (55 total "special assistance") | — | not stated |
| Same routing, return | 15 | **1** | not stated |
| LaGuardia → Palm Beach (former FA) | ~40 | "nearly all walked off" | not stated |
| Fort Lauderdale (2023, X post) | 20 | — | not stated |
| Crew estimate, high-volume Southwest flights | >100 requests reported on some flights; **>80% claimed not to need assistance** | — | — |

**[S]** at best on each individual figure, and self-selecting: the flights that get reported are
the extreme ones. But the structural argument is sound and is corroborated by the industry's own
behaviour:

> **Southwest ended wheelchair-first boarding on 26 January 2026 — one day before assigned seating
> began** — and multiple commentators identify preboard abuse as a genuine motive for the assigned
> seating change itself. Under open seating a wheelchair preboard was worth a **free front-row
> seat**; under assigned seating a preboard gets you to the *same* seat, earlier. **[C]**

That is the cleanest natural experiment available. If preboard volumes at Southwest fall sharply
through 2026, the incentive explanation is confirmed; if they do not, it was demand, not gaming.
**Worth revisiting this document in 2027.**

**Boarding-time impact: no measured figure exists.** Not in the academic literature, not from any
carrier. **[D]** reasoning for the simulator: an aisle-chair transfer occupies the entire aisle and
both cabin doors' worth of crew attention for a multiple of a normal stow, so preboards are best
modelled as a *service-time multiplier on a small population that boards into an empty aircraft* —
i.e. mostly additive to the front of the boarding window rather than interfering with the main
flow, **unless** the preboard fraction is large enough (>15–20%) that preboarding itself becomes a
queue. The Florida/Nevada leisure cases are exactly that regime, and they are the case where
preboarding, not boarding order, is the whole story.

Sources: [Fox News — "Jetway Jesus"](https://www.foxnews.com/travel/airline-passengers-jetway-jesus-miracle-flights-accused-faking-disabilities-better-boarding) ·
[View from the Wing — 30 wheelchairs, 28 walk off](https://viewfromthewing.com/only-in-florida-30-wheelchair-passengers-preboard-southwest-airlines-flight-28-walk-off-freely-after-landing/) ·
[Newsweek — is this the real reason Southwest changed](https://www.newsweek.com/southwest-airlines-wheelchair-preboarding-policy-jetway-jesus-2084053) ·
[WheelchairTravel.org — the imposters lie](https://wheelchairtravel.org/jetway-jesus-airport-wheelchair-imposters-lie/) ·
[American Airlines newsroom — DOT settlement, 8M requests](https://news.aa.com/news/news-details/2024/In-settlement-with-DOT-American-Airlines-reiterates-commitment-to-customers-traveling-with-wheelchairs-and-mobility-devices-OPS-OTH-10/default.aspx) ·
[IATA accessibility fact sheet](https://www.iata.org/en/iata-repository/pressroom/fact-sheets/fact-sheet-accessibility/) ·
[DOT — preboarding notice](https://www.transportation.gov/sites/dot.gov/files/docs/Preboarding%20Notice%20Final.pdf) ·
[DOT — passengers with disabilities bill of rights](https://www.transportation.gov/airconsumer/disabilitybillofrights)

**A note on framing.** WheelchairTravel.org and disability advocates push back hard on the
"imposter" narrative, and the 8-million-requests figure is dominated by genuine need in an ageing
travelling population. For the simulator's purposes the *motive* is irrelevant — only the count and
the service time matter. The documentation should avoid the tabloid framing.

---

# 4. Sanity-check of the simulator's two schemes

## 4.1 `priority_5tier` — is it a fair representation of a US legacy carrier?

**Directionally yes; in four specific respects, no.**

**What it gets right [C]:**
- Preboard ahead of the premium cabin — legally required, universal.
- Premium cabin and top elites ahead of everything else.
- A mid-tier of "mid elites + premium economy + co-brand cardholders" — this is exactly Delta
  Zone 5 and American Group 4/5.
- **Basic economy last, by design** — Delta Zone 8, American Group 9, United Group 6, Southwest
  Groups 6–8. Universal at US carriers.
- No spatial logic at Delta, American or Air France. For those three carriers the strategy is
  accurate.

**What is wrong or missing:**

1. **Five tiers is fewer than any US legacy carrier actually uses.** American runs **9 + preboard**,
   Delta **8 + preboard**, United **6 + preboard**, Southwest **8 + preboard**. Only Air France (5)
   and Lufthansa (5–6) are at our granularity. Coarser groups mean more within-group randomisation,
   which in the simulator makes `priority_5tier` **look better than the real thing**, because
   random-within-group is a decent aisle-spreader. A 9-group ladder is measurably more serialised
   than a 5-group one.
2. **The premium cabin is no longer reliably Tier 1.** American moved First/Business into
   **preboarding** in May 2025. Our Tier 1 mislabels the largest US carrier's current practice.
3. **Tiers 1–2 are not spatially random — they are front-loaded, and the simulator treats them as
   uniform.** Elites and cardholders disproportionately occupy Comfort+ / Main Cabin Extra /
   Economy Plus, which are the **forward rows** of the economy cabin, and premium cabins are
   forward by definition. A real priority ladder therefore has a strong implicit **front-to-back**
   bias in its first two tiers — approximately the worst possible ordering — before it hits the
   random main-cabin bulk. **This is the single biggest realism defect in the strategy**, and it is
   why real priority boarding is worse than the simulator's version of it. **[D]**
4. **The preboard composition is understated.** "wheelchair/assistance, unaccompanied minors,
   families w/ infants" reads as a handful of people. The realistic bucket is **5–10% of the cabin
   as a baseline and up to a third on leisure routes**, and it includes **active-duty military**
   and (at American) **the entire premium cabin**. `preboardFraction` should be a swept parameter,
   not a rounding error.
5. **The comment "this scheme has no spatial logic at all" is no longer true of the industry.**
   It is true of Delta, American and Air France. It is false of United, Lufthansa, ANA, JAL, BA,
   Emirates, Qatar and — as of January 2026 — Southwest. The framing "revenue vs. flow" should
   become "revenue-only vs. revenue-then-flow", because the second is now the majority position.

## 4.2 `common_sense_5tier` — is it implementable?

**Yes to all three implementability questions. But it is less novel, and less correct in one
detail, than the doc claims.**

**Could a gate agent announce it?** Yes, and the proof is in service. JAL's Group 3 is *"rows 40
and above, plus window seats A and K, plus emergency exit rows"* — a **three**-clause compound
rule, announced on domestic widebody flights since September 2024, on an airline that boards its
A350s in 15 minutes. Our Group 3 ("window seats rows 1–19, and middle seats rows 20–33") is a
two-clause rule. If JAL can call three clauses, we can call two. **[C]**

**Could it be printed on a boarding pass?** Trivially. The group number is a pure function of the
seat, computable at seat assignment. **United, Lufthansa, ANA, JAL and Southwest already print
seat-derived group numbers today** **[C]**. There is no new IT primitive required — the DCS
already writes a group number to the pass; only the function that computes it changes.

**Does it conflict with regulation?**

- **No binding US regulation is violated.** The DOT family-seating rule is an **NPRM from August
  2024 that has not been finalised** and is not being advanced. It is a *proposal*, and the doc
  should not describe it as a rule. **[C]**
- **It does collide with the seven US carriers' voluntary Family Seating Dashboard commitments** —
  or more precisely, with what those commitments imply operationally. The NPRM's "adjacent" is
  *same row, not separated by the aisle*, so a compliant family is by construction a set of
  different seat letters in one row: **exactly the set our scheme splits across three groups.**
- **This is a solved problem and every deployed WilMA carrier solves it identically:** promote the
  whole booking to the earliest-boarding member's group. United: *"the same and highest applicable
  boarding group"* for the reservation. Lufthansa: *"and companions"*. **[C]**
- **Therefore party cohesion is mandatory for this strategy, not optional.** `STRATEGIES.md`
  currently lists `keepPartiesTogether` as one of four universal post-processing steps applied "if"
  enabled, and notes that turning it off shows what optimal methods cost. That is the right
  experiment for `steffen_perfect`. It is the **wrong default** for `common_sense_5tier`, which
  cannot be described as implementable unless cohesion is on — and the cohesion rule must be
  *promote-to-earliest*, matching United and Lufthansa, not any other tie-break.

**Is anyone already doing something like it?** Yes — more than the doc implies:

| Scheme | Relationship to `common_sense_5tier` |
|---|---|
| **Southwest, Jan 2026** | **W/M/A × rear→front.** This is our scheme's core idea, in service, on ~4,000 daily flights. |
| **JAL, Sep 2024** | Rear rows + windows called together — a two-clause reverse-pyramid quantisation, exactly our construction, in one group instead of five. |
| **United, ANA, Lufthansa** | Pure W/M/A, no row banding. Our scheme adds the rear→front axis they omit. |
| **BA, Apr 2025** | Rear→front economy banding, no seat-letter axis. The other half of our scheme. |
| **America West, 2003** | The full diagonal. Our scheme *is* a five-group quantisation of it. |

So `common_sense_5tier` is best described not as a novel proposal but as **the reverse pyramid,
re-derived, and now independently converged upon by Southwest** — which is a much stronger claim
than "our proposal", and should be stated that way.

**The one substantive thing it gets wrong: the elite treatment.**

> *"Elite status is honoured by letting elites board at the front of their assigned group rather
> than ahead of everyone, so status still buys something without wrecking the flow."*

No airline does this, and there is a concrete reason it will not be adopted rather than merely a
cultural one. **Elites disproportionately select aisle seats.** Under our scheme, aisle seats board
**last** (Group 5). A scheme in which the airline's most valuable customers are systematically
called last is not a scheme any revenue-management organisation will approve, and "front of Group
5" is not a consolation — it is still behind every Basic Economy window passenger on the aircraft.

Every carrier that deployed WilMA solved this by keeping the status ladder **entirely ahead of** the
seat-letter groups (United Groups 1–2 before 3/4/5; Lufthansa 1–2 before 3/4/5; ANA the same;
Southwest by making status an *input to* group assignment alongside seat location rather than
subordinate to it). Southwest's construction is the interesting one and the one worth copying: it
combines both axes into a single 8-group ordering, so a high-status passenger with an aisle seat
lands in Group 2 while a Basic-fare aisle passenger lands in Group 8.

Two other smaller issues:

- **Bin exhaustion.** Aisle-last is the known cost of WilMA, and United paid for it in *aluminium*
  — a fleet-wide larger-bin retrofit tied explicitly to the WilMA rollout **[C]**. If the simulator
  claims `common_sense_5tier` is deployable, it needs a bin-capacity/gate-check penalty, or it is
  giving the strategy a free pass on the one real-world objection its closest live analogue
  actually incurred.
- **Group 1 = "premium cabin (rows fore of the economy section)"** is fine for Delta/United/
  Lufthansa but wrong for American, where the premium cabin now **preboards**.

---

# 5. What the simulator should conclude about realism

Two framings in `STRATEGIES.md` deserve revision on the evidence above:

1. **"No airline runs Steffen because it requires perfect compliance" is right, but incomplete.**
   The binding constraints, in order of how load-bearing they actually are:
   (i) **party cohesion** — mandatory, and it locally destroys any fine-grained ordering;
   (ii) **status/alliance obligations** — contractual, not preference;
   (iii) **compliance** — 85% conformance measured (`RESEARCH_PARAMETERS.md`), and American needed a
   100-airport hardware rollout to enforce a *nine-group* ladder;
   (iv) **gate sequencing infrastructure** that does not exist;
   (v) revenue — real, but bundled and indirect, and less of a hard blocker than the first four.

2. **"Airlines sell position rather than optimising flow" is now only half true.** Since 2023 the
   industry has moved *toward* flow logic, not away: United (2023), JAL (2024), BA (2025),
   Southwest (2026), with ANA and Lufthansa already there. The live consensus design is
   **status ladder first, then seat-derived ordering for the residual economy cabin, with
   promote-to-earliest party cohesion** — which is, structurally, `priority_5tier` on top and
   `common_sense_5tier` underneath. That hybrid, not either strategy alone, is the thing the
   simulator should be presenting as "what a real airline does in 2026".

---

# 6. Gaps I could not close

1. **Egress block.** `WebFetch` and `curl` were blocked for every domain attempted, including
   airline IR/press PDFs. Nothing below §1 was read from a primary airline policy page. The
   highest-value fetches to retry if the allowlist is widened: `united.com` boarding page,
   `delta.com/boarding-priority`, `aa.com`, `southwest.com/customer-enhancements/assigned-seating`,
   `lufthansa.com/boarding`, `jal.co.jp/dom/boarding/yuusen`, and the AA May 2025 press release at
   `s202.q4cdn.com`.
2. **United's Group 3 vs Group 4 discrepancy** (§1.2). 2023 launch coverage says the change "begins
   with Group 4"; structural guides say Groups 3/4/5 = W/M/A. Resolved in favour of 3/4/5 on
   internal consistency, but not verified against united.com.
3. **Southwest's exact group-by-group W/M/A matrix.** The principle is **[C]**; the mapping of which
   seat letters land in which of Groups 1–8 is **[S]** from secondary coverage. Southwest publishes
   the *inputs*, not the matrix.
4. **Why reverse pyramid actually ended.** No source states a reason. The merger-harmonisation
   explanation is inference, and the "widebody fleet" explanation is a single weak source that does
   not survive scrutiny (the narrowbody fleet remained the majority). **Do not assert a cause.**
5. **No post-deployment measurement of United's WilMA exists in public.** The "2 minutes" figure is
   a pre-launch projection. Do not use it as a validation target.
6. **No measured boarding-time impact of preboarding**, at any preboard fraction, anywhere in the
   literature or in carrier disclosure. The simulator's treatment is extrapolation.
7. **No published rate for wheelchair-preboard non-return.** Only crew and passenger anecdote,
   self-selected for extremity. Southwest's January 2026 change is a natural experiment worth
   revisiting in 2027.
8. **Priority-boarding revenue is not separately disclosed by any US major.** All figures in §2.4(a)
   are total ancillary, loyalty, or seat-selection revenue. Anyone quoting a specific
   "priority boarding is worth $X" number for a US legacy carrier is estimating.
9. **Singapore Airlines' boarding structure** could not be recovered at all. **Qatar** and
   **Emirates** are **[S]** only.
10. **The "2024 time-and-motion study" claiming 10% for outside-in, and the IATA "2–3 minutes"
    claim**, are both quoted by secondary sources without attribution I could trace. Treat as
    rumour until a primary citation is found.

---

# 7. Recommended changes to STRATEGIES.md

Listed in descending order of how wrong the current text is. Nothing here has been applied — this
document does not modify `STRATEGIES.md`.

### High — factually wrong as written

1. **§11 `open_seating` — "Southwest, pre-2026" is now historical, and the label undersells it.**
   Southwest ended open seating on **27 January 2026**. Relabel as *"Open seating (Southwest,
   1971–2026)"* and mark it as a retired real-world method. No airline of consequence now uses it.

2. **§13 `common_sense_5tier` — the elite rule is wrong and will not survive contact with a revenue
   department.** "Elites board at the front of their assigned group" is done by nobody. Because
   elites disproportionately hold **aisle** seats, our scheme calls them **last**. Replace with the
   construction Southwest actually shipped: make **status an input to group assignment alongside
   seat location**, producing one merged ordering, rather than subordinating status to seat letter.
   At minimum, relabel the current behaviour as an explicit *departure from practice* rather than
   presenting it as the commercially-acceptable compromise.

3. **§13 — the DOT family seating "rule" is a proposed rule, not law.** If the strategy text or the
   UI copy anywhere describes it as a requirement, correct it: **NPRM, 9 August 2024, not
   finalised**. What binds is seven carriers' **voluntary** Dashboard commitments. The operational
   constraint is real; the legal one is not (yet).

4. **§13 — party cohesion must be mandatory for this strategy, not an optional post-processing
   step.** Every deployed WilMA carrier promotes the entire booking to the earliest-boarding
   member's group (United: *"same and highest applicable"*; Lufthansa: *"and companions"*). A
   `common_sense_5tier` run with `keepPartiesTogether = false` is not a model of anything real and
   should not be presented as one. Also verify that the engine's cohesion tie-break is
   **promote-to-earliest** and not, say, mean-position.

5. **§12 `priority_5tier` — "this scheme has no spatial logic at all … which is precisely the
   point" is now a minority position.** True for Delta, American, Air France. False for United,
   Lufthansa, ANA, JAL, BA, Emirates, Qatar and Southwest. Reframe the comparison as
   *revenue-only* vs *revenue-then-flow*, and say which carriers each represents.

### Medium — realism defects that change the numbers

6. **§12 — Tiers 1–2 should be spatially front-biased, not uniformly shuffled.** Elites and
   cardholders concentrate in Comfort+/Main Cabin Extra/Economy Plus, i.e. the forward economy
   rows; the premium cabin is forward by definition. Modelling the first two tiers as uniform
   random over the whole cabin makes `priority_5tier` **too fast**. Add a forward-row weighting to
   tiers 1–2. This is probably the largest single realism improvement available.

7. **§12 — five tiers understates real granularity.** American 9, Delta 8, Southwest 8, United 6.
   Either add a `tierCount` parameter, or add a 9-tier `priority_9tier` variant modelled on
   American and keep the 5-tier one as the Air France/Lufthansa case. As written the strategy is
   flattering to the real thing.

8. **§12 — the premium cabin is not reliably Tier 1.** American has preboarded First and Business
   since **1 May 2025**. Either move it or note the carrier-dependence.

9. **Preboard sizing.** The §12 preboard description reads as a handful of people. Realistic
   baseline is **5–10% of the cabin**, with leisure-market flights credibly reaching **20–33%**.
   Make the preboard fraction a first-class swept parameter and document the leisure-route regime,
   because above ~15–20% preboarding stops being a prologue and becomes the bottleneck.

10. **§13 needs a bin-exhaustion / gate-check penalty to make its "implementable" claim honest.**
    Aisle-last is WilMA's known real-world cost; United paid for it with a **fleet-wide larger-bin
    retrofit** tied to the rollout. A simulator that scores aisle-last strategies with unlimited bin
    space is scoring the easy half of the problem.

### Low — framing and attribution

11. **§4 `wilma` — "United's current scheme" is imprecise.** United applies WilMA only to the
    economy residual **below** Groups 1–2, and Basic Economy sits **after** the aisle group.
    Real-world WilMA is always a hybrid. Also add **Lufthansa** and **ANA** as adopters, and note
    **Southwest from January 2026**.

12. **§5 `wilma_zoned` — this now has a live deployment.** Southwest's 2026 scheme is W/M/A ×
    rear→front. Say so; it is the strongest realism claim any strategy in the file can make.

13. **§8 `reverse_pyramid` — add the published result and stop implying it failed.** Measured
    **−2 minutes / ≈−20%** on full flights, plus **−21% departure delays** in the first three
    months (van den Briel et al., *Interfaces* 35(3):191–201, 2005). It disappeared through two
    merger integrations, and **no source states a performance reason for abandoning it**. Also add
    **JAL (2024)** as a coarse two-group descendant of the same idea.

14. **§6 `steffen_perfect` — "requires perfect passenger compliance, which is exactly why no
    airline runs it" is only the fourth-most-important reason.** Ahead of it: mandatory party
    cohesion, alliance/status contractual obligations, and the absence of any gate infrastructure
    for per-passenger sequencing. Compliance is the *modellable* reason, not the binding one.

15. **§14 `by_bags` deserves promotion in the commentary.** Spirit reportedly cut boarding by
    **~6 minutes** by charging for carry-ons — roughly three times the best claimed ordering
    benefit, from a pricing change with no gate process change. And boarding has slowed from ~15
    min (1970s) to 30–40 min for ~140 pax today, with the rate down >50%. If the sim shows bag
    policy dominating boarding order, that matches the field evidence.

16. **Consider a `two_door` topology flag rather than a strategy.** Ryanair and easyJet print the
    door on the boarding pass and board front and rear simultaneously; that is a much larger effect
    than any ordering choice, and it is currently unmodelled and unmentioned.

17. **Consider adding `southwest_2026` as a 16th strategy.** It is `wilma_zoned` with a status
    ladder merged into the same 8-group ordering, and it is the single best available answer to
    "what does a real airline that cares about flow actually ship". Having it in the list would let
    the headline comparison be *our proposal vs. the real converged design* rather than *our
    proposal vs. a strawman*.
