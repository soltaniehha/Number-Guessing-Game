# Boarding Lab — UI Specification

The web app is a single-page "lab" with three modes sharing one config panel.

```
┌──────────────────────────────────────────────────────────────────────┐
│  HEADER: Boarding Lab   [ Cabin ] [ Analytics ] [ Compare ]   ▸Run   │
├───────────────┬──────────────────────────────────────────────────────┤
│               │                                                       │
│  CONTROL      │   MODE VIEWPORT                                       │
│  PANEL        │   • Cabin    → live seat-map animation + playback     │
│  (scrolling,  │   • Analytics→ headless Monte Carlo, 12 live charts   │
│   collapsible │   • Compare  → all strategies head-to-head            │
│   sections)   │                                                       │
│               │                                                       │
├───────────────┴──────────────────────────────────────────────────────┤
│  STATUS BAR: t=03:42  seated 121/180  aisle 14  ×8 speed  [progress] │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 1. Modes

### 1.1 Cabin mode (the showpiece)

A top-down cabin rendered on `<canvas>` (SVG does not survive 400 animated dots).

- **Seat rectangles**: grey when empty, tinted by cabin class. A seat lights up
  the moment its passenger sits.
- **Passenger dots**, per the brief:
  - 🔴 **red** — waiting: still in the jet-bridge queue, or standing blocked in
    the aisle
  - 🟠 **amber** — actively stowing a bag or doing a seat shuffle
  - 🔵 **blue** — walking freely down the aisle
  - 🟢 **green** — seated
  - Colour is also encoded by *shape ring* so the view is colour-blind safe.
- **Jet-bridge queue** drawn as a compressed lane of red dots outside each
  active door, with a live count.
- **Aisle heat**: a faint red wash on rows where the aisle is currently blocked.
- Hovering a dot shows a tooltip: seat, group, bags, party, time waiting.
- Doors are drawn as green arrows on the fuselage; disabled doors are hollow.

**Playback controls**: Play/Pause, Step, Reset, a scrub bar over the full
timeline, and a speed control with stops at
`1× (real time), 2, 5, 10, 25, 50, 100×`. At 1× one wall-clock second is one
simulated second. Above ~25× the renderer drops to rendering every N-th frame
rather than trying to draw every tick.

The simulation is computed **up front** (it takes ~30 ms) and replayed from a
compact frame buffer, so scrubbing is instant and playback never stutters.

### 1.2 Analytics mode

No seat map. Runs `N` replications (default 200) of the selected strategy — or
of every selected strategy — in a **Web Worker**, streaming results back so the
charts fill progressively while the run proceeds. A visible progress bar,
run counter, and a Stop button.

### 1.3 Compare mode

Runs every enabled strategy × `N` replications and produces the head-to-head
ranking table plus the comparison charts. This is the "which strategy actually
wins" answer, with confidence intervals so the answer is honest.

---

## 2. The charts

All charts are hand-rolled SVG/canvas React components — no chart library, so
they stay consistent, themed, and fast. They must read correctly in light and
dark. Follow the `dataviz` skill for palette and form.

| # | Chart | Type | Answers |
|---|---|---|---|
| 1 | **Boarding time by strategy** | Horizontal bar + 95% CI whiskers | Which strategy is fastest, and is the gap real? |
| 2 | **Time distribution** | Overlaid histograms / ridgeline per strategy | How consistent is each strategy? |
| 3 | **Seated S-curve** | Multi-line, time vs % seated, with IQR band | Where does each strategy lose time? |
| 4 | **Aisle congestion heatmap** | Row × time matrix | Where do jams form, and when? |
| 5 | **Time breakdown** | Stacked bar: walking / stowing / shuffling / blocked | *Why* is a strategy slow? |
| 6 | **Seat interference counts** | Grouped bar by type (0 / 1 / 2 blockers) | Does outside-in really kill shuffles? |
| 7 | **Load-factor sweep** | Line: boarding time vs the swept parameter, per strategy | Does the ranking hold on a half-empty flight — or as status concentrates forward, or preboarding grows? |
| 8 | **Passenger wait time** | Box plot / violin of individual time-to-seat | Is the fast strategy also the pleasant one? |
| 9 | **Time-to-seat by seat position** | Seat-map heatmap | Who suffers — window? rear? |
| 10 | **Convergence** | Running mean ± CI vs replication count | Have we run enough replications to trust this? |
| 11 | **Risk/reward scatter** | Mean vs std dev, one point per strategy | Fast-but-volatile vs slow-but-predictable. |
| 12 | **Aisle throughput** | Area: bodies in aisle over time | Is the aisle saturated or starved? |

Every chart supports hover read-out and degrades to a clear empty state before
the first result arrives.

---

## 3. Control panel

Collapsible sections, every control showing its live value and a one-line
explanation of what it does physically.

1. **Scenario** — aircraft, strategy, load factor, seed (+ randomise),
   replications, and the parameter sweep that feeds chart 7: on/off, which
   parameter it varies, which points, how many replications per point
2. **Doors** — per-door toggles, door-assignment rule
3. **Passengers** — bag mix, party-size mix, walk speed mean/sd, % preboards,
   % reduced mobility, % travelling with children, elite mix, and how far
   forward status sits (`eliteForwardBias`)
4. **Timing** — stow time and its spread, per-person dexterity, elementary
   shuffle movements and their duration, same-party shuffle, door-arrival
   interval, and the squeeze-past speed factor (0 = strict aisle blocking)
5. **Overhead bins** — bags per row-side, search radius, search penalty,
   gate-check penalty, congestion weight
6. **Behaviour** — zone count, keep parties together, preboard first,
   non-compliance rate + jitter, late-arrival rate, open-seating policy
7. **Presets** — one-click realistic scenarios (see below), Reset to defaults,
   Copy/paste config as JSON, share-by-URL

### 3.1 Presets

Named, realistic, one click each. The airframe ids are the roster's own
(`parity/aircraft.json`); a preset may not name one that is not in it.

- **US legacy hub, full flight** — `a320neo`, 5-tier priority, 98% load, 1 door
- **European LCC turnaround** — `b737_max8` (the 197-seat MAX 8-200),
  front+rear airstairs, 96% load, high non-compliance, small bins
- **Regional commuter** — `e175`, back-to-front, 88% load, heavy gate-checking
- **Long-haul widebody** — `b777_300er`, twin aisle, 2 doors, 92% load,
  heavy bags
- **Southwest, pre-2026 (open seating)** — `b737_max8`, open seating, 95% load,
  1 door. Historical: retired 27 January 2026.
- **Southwest, today (assigned + WilMA)** — `b737_max8`, `southwest_2026`,
  95% load, 1 door. Deliberately identical to the preset above in every respect
  but the scheme, so running one after the other measures what Southwest's
  change to assigned seating actually bought. There is no 175-seat Southwest
  737 in the roster (see RESEARCH_AIRCRAFT B3b); both presets use the roster's
  only 737, which is denser than Southwest's.
- **Steffen's laboratory ideal** — `a320neo`, perfect Steffen, no parties,
  no preboards
- **The nightmare** — `a320neo`, front-to-back, 100% load, 2 bags each,
  tiny bins, high non-compliance

---

## 4. Design language

- Dark aviation-instrument aesthetic by default with a light theme toggle;
  both are first-class and defined with CSS custom properties on `:root`.
- Monospaced numerals for all live figures so they do not jitter.
- Motion is meaningful only: dots move, panels do not.
- Fully responsive to ~400 px: the control panel becomes a drawer and the cabin
  view rotates to vertical on narrow screens.
- Keyboard: `Space` play/pause, `←/→` step, `R` reset, `1-3` switch mode.
- Every interactive element is reachable by tab and has an accessible name.
