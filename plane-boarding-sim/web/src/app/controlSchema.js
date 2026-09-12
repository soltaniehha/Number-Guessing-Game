/**
 * Declarative description of every control in the panel.
 *
 * One entry per parameter in ENGINE_SPEC section 8, grouped into the seven
 * sections of UI_SPEC section 3. `explain` is the one-line, plain-English,
 * physical meaning shown under the control — it is the difference between a
 * lab instrument and a form.
 *
 * kind: 'slider' | 'nullable-slider' | 'toggle' | 'segmented' | 'weights' | 'seed'
 *     | 'aircraft' | 'strategy' | 'doors' | 'sweep-param' | 'sweep-points'
 *
 * Two optional properties gate a control:
 *   `shell`  — a shell parameter (replications, the sweep), not an engine one,
 *              so it is not looked for in the engine's DEFAULTS.
 *   `modes`  — the app modes it applies to. The load-factor sweep only exists
 *              to feed chart 7, so it is offered in Analytics and Compare and
 *              nowhere else.
 */
import { SWEEP_MODES, autoSweepRuns } from '../state/sweep.js'

export const SECTIONS = [
  { id: 'scenario', title: 'Scenario', hint: 'What is being boarded, and how' },
  { id: 'doors', title: 'Doors', hint: 'Where passengers get on' },
  { id: 'passengers', title: 'Passengers', hint: 'Who is on the flight' },
  { id: 'timing', title: 'Timing', hint: 'How long each action takes' },
  { id: 'bins', title: 'Overhead bins', hint: 'Where the bags go' },
  { id: 'behaviour', title: 'Behaviour', hint: 'How well the plan survives contact with people' },
  { id: 'presets', title: 'Presets & sharing', hint: 'Whole scenarios in one click' },
]

const pct = (v) => `${(v * 100).toFixed(v * 100 < 10 ? 1 : 0)}%`
const secs = (v) => `${v.toFixed(1)}s`
const mps = (v) => `${v.toFixed(2)} m/s`
const plain = (v) => `${v}`
const fixed2 = (v) => v.toFixed(2)

/* ----------------------------------------------------------- announcement */
/*
 * `format` is what the eye reads; `announce` is what a screen reader says, and
 * they are not the same string. "16.0s" is read out as the bare letter S, and
 * a `plain` or `fixed2` value is read as a naked number — "9" for "Movements:
 * both block" tells a listener nothing. Every slider therefore carries an
 * `announce` formatter, used for aria-valuetext (see controls/Slider.jsx).
 */

/** Trim a value to something worth saying out loud: 16, 2.4, 0.05. */
const sayNum = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  return String(Number(n.toFixed(2)))
}
/** "1 bag" / "4 bags" — a count with the thing it counts. */
const count = (one, many) => (v) => `${sayNum(v)} ${Number(v) === 1 ? one : many}`
const saySecs = (v) => `${sayNum(v)} ${Number(v) === 1 ? 'second' : 'seconds'}`
const sayPct = (v) => `${(v * 100).toFixed(v * 100 < 10 ? 1 : 0)} percent`
const sayMps = (v) => `${v.toFixed(2)} metres per second`
/** A dimensionless number that still needs saying what it is a number of. */
const sayOf = (what) => (v) => `${v.toFixed(2)} ${what}`

/** @type {Array<object>} */
export const CONTROLS = [
  // ---------------------------------------------------------------- scenario
  {
    key: 'aircraftId',
    kind: 'aircraft',
    section: 'scenario',
    label: 'Aircraft',
    explain: 'The airframe: its seat map, pitch, aisle count and door positions.',
  },
  {
    key: 'strategy',
    kind: 'strategy',
    section: 'scenario',
    label: 'Boarding strategy',
    explain: 'The rule the gate uses to decide who walks down the jet bridge next.',
  },
  {
    key: 'loadFactor',
    kind: 'slider',
    section: 'scenario',
    label: 'Load factor',
    min: 0.3,
    max: 1,
    step: 0.01,
    format: pct,
    announce: sayPct,
    explain: 'How full the aircraft is — the fraction of seats with a body in them.',
  },
  {
    key: 'seed',
    kind: 'seed',
    section: 'scenario',
    label: 'Random seed',
    explain: 'Fixes every random draw, so the same seed replays the exact same flight.',
  },
  {
    key: 'runs',
    kind: 'slider',
    section: 'scenario',
    shell: true,
    label: 'Replications',
    min: 10,
    max: 1000,
    step: 10,
    format: plain,
    announce: count('replication', 'replications'),
    explain: 'How many independent flights to simulate per strategy in Analytics and Compare.',
  },
  {
    key: 'sweepEnabled',
    kind: 'toggle',
    section: 'scenario',
    shell: true,
    modes: SWEEP_MODES,
    // Named for the chart it fills, which titles itself "Parameter sweep" and,
    // in its empty state, sends the reader to the Scenario section to switch
    // this on and pick an axis. Keep the two in step.
    label: 'Parameter sweep',
    explain: 'Also re-run every strategy across a range of one scenario parameter — load factor unless you change the axis below — to fill the parameter-sweep chart. It multiplies the work, so it is off by default.',
  },
  {
    key: 'sweepParam',
    kind: 'sweep-param',
    section: 'scenario',
    shell: true,
    modes: SWEEP_MODES,
    label: 'Sweep axis',
    explain: 'Which scenario parameter the sweep varies. Load factor asks whether a ranking survives a half-empty Tuesday; forward concentration of status turns “does selling priority boarding cost time?” into a curve.',
  },
  {
    // A virtual key: the points live in `sweepLoadFactors` for the load-factor
    // axis and in `sweepValues` for every other, so that switching axis and
    // switching back does not lose the load factors you picked. ControlPanel
    // resolves which one this control is writing to.
    key: 'sweepPoints',
    kind: 'sweep-points',
    section: 'scenario',
    shell: true,
    modes: SWEEP_MODES,
    label: 'Sweep points',
    explain: 'The values of the swept parameter to run. Each point is a fresh set of replications, so the cost is one batch per point.',
  },
  {
    key: 'sweepRuns',
    kind: 'nullable-slider',
    section: 'scenario',
    shell: true,
    modes: SWEEP_MODES,
    label: 'Replications per sweep point',
    min: 1,
    max: 50,
    step: 1,
    format: plain,
    announce: count('replication', 'replications'),
    autoLabel: 'Auto',
    autoSpoken: 'derived from the replication count',
    explain: 'A sweep point needs fewer flights than the main batch. Auto is a quarter of the replications, held between 3 and 12.',
  },

  // ------------------------------------------------------------------- doors
  {
    key: 'doors',
    kind: 'doors',
    section: 'doors',
    label: 'Active doors',
    explain: 'Which doors are actually open. Each open door runs its own queue, in parallel.',
  },
  {
    key: 'doorAssignment',
    kind: 'segmented',
    section: 'doors',
    label: 'Door assignment',
    options: [
      { value: 'single', label: 'Single' },
      { value: 'split_by_row', label: 'By row' },
      { value: 'split_by_aisle', label: 'By aisle' },
    ],
    explain: 'How a passenger is told which door to use: one door for all, nearest door by row, or the door feeding their aisle.',
  },

  // -------------------------------------------------------------- passengers
  {
    key: 'bagWeights',
    kind: 'weights',
    section: 'passengers',
    label: 'Carry-on mix',
    keys: ['0', '1', '2'],
    keyLabels: { 0: 'No bag', 1: '1 bag', 2: '2 bags' },
    explain: 'How many overhead bags people bring. Bags are the single biggest driver of aisle time.',
  },
  {
    key: 'partySizeWeights',
    kind: 'weights',
    section: 'passengers',
    label: 'Party-size mix',
    keys: ['1', '2', '3', '4', '5'],
    keyLabels: { 1: 'Solo', 2: 'Pair', 3: 'Three', 4: 'Four', 5: 'Five' },
    explain: 'How many people travel together. Groups sit together and insist on boarding together.',
  },
  {
    key: 'walkSpeedMean',
    kind: 'slider',
    section: 'passengers',
    label: 'Walk speed (mean)',
    min: 0.4,
    max: 1.6,
    step: 0.01,
    format: mps,
    announce: sayMps,
    explain: 'Free-flow walking pace down an empty aisle. About 0.9 m/s is a normal unhurried walk.',
  },
  {
    key: 'walkSpeedSd',
    kind: 'slider',
    section: 'passengers',
    label: 'Walk speed spread',
    min: 0,
    max: 0.5,
    step: 0.01,
    format: fixed2,
    announce: sayOf('metres per second of spread'),
    explain: 'Spread of walking pace across people. Bigger means more dawdlers behind whom everyone piles up.',
  },
  {
    key: 'preboardRate',
    kind: 'slider',
    section: 'passengers',
    label: 'Preboards',
    min: 0,
    max: 0.2,
    step: 0.005,
    format: pct,
    announce: sayPct,
    explain: 'Share needing wheelchair or assistance boarding, or unaccompanied minors — they board before everyone.',
  },
  {
    key: 'slowPaxRate',
    kind: 'slider',
    section: 'passengers',
    label: 'Reduced mobility',
    min: 0,
    max: 0.4,
    step: 0.005,
    format: pct,
    announce: sayPct,
    explain: 'Share who walk and stow noticeably slower without needing formal assistance.',
  },
  {
    key: 'slowSpeedFactor',
    kind: 'slider',
    section: 'passengers',
    label: 'Reduced-mobility pace',
    min: 0.2,
    max: 1,
    step: 0.01,
    format: fixed2,
    announce: sayOf('times normal walking pace'),
    explain: 'How much slower those passengers walk, as a multiple of normal pace.',
  },
  {
    key: 'slowStowFactor',
    kind: 'slider',
    section: 'passengers',
    label: 'Reduced-mobility stow',
    min: 1,
    max: 3,
    step: 0.05,
    format: fixed2,
    announce: sayOf('times the normal stow time'),
    explain: 'How much longer those passengers take to lift a bag into the bin.',
  },
  {
    key: 'childRate',
    kind: 'slider',
    section: 'passengers',
    label: 'Travelling with children',
    min: 0,
    max: 0.6,
    step: 0.01,
    format: pct,
    announce: sayPct,
    explain: 'Share of multi-person parties that include a child — they board as a unit and settle slowly.',
  },
  {
    key: 'eliteMix',
    kind: 'weights',
    section: 'passengers',
    label: 'Status mix',
    keys: ['elite_top', 'elite_mid', 'cardholder', 'standard', 'basic'],
    keyLabels: {
      elite_top: 'Top elite',
      elite_mid: 'Mid elite',
      cardholder: 'Cardholder',
      standard: 'Standard',
      basic: 'Basic',
    },
    explain: 'Frequent-flyer tiers in the main cabin. Revenue-driven strategies board these in order.',
  },
  {
    key: 'eliteForwardBias',
    kind: 'slider',
    section: 'passengers',
    label: 'Status sits forward',
    min: 0,
    max: 1,
    step: 0.05,
    format: fixed2,
    announce: sayOf('of forward tilt on the status mix'),
    // The physical claim, not the arithmetic: elites hold the extra-legroom
    // rows at the front of economy, so calling them first is calling the front
    // of the aircraft first. ENGINE_SPEC section 3.1 step 6.
    explain: 'How strongly frequent flyers cluster in the forward rows — Comfort+, Economy Plus, Main Cabin Extra. At 0 status is spread evenly down the cabin; at 1 the nose is roughly twice as elite as average and the tail has almost none, which is what makes boarding by status a front-to-back boarding in disguise.',
  },

  // ------------------------------------------------------------------ timing
  // Two parameterisations of the service-time model exist: the one written up
  // in ENGINE_SPEC section 8 and the Schultz calibration that parity/defaults.json
  // has since moved to. Both are described here and the panel shows whichever
  // the live engine actually exposes (see `presentControls` below).
  {
    key: 'stowWeibullScale',
    kind: 'slider',
    section: 'timing',
    label: 'Stow time per bag',
    min: 6,
    max: 34,
    step: 0.5,
    format: secs,
    announce: saySecs,
    explain: 'How long a typical passenger takes to heave one bag into the bin. Each extra piece is a fresh, independent struggle.',
  },
  {
    key: 'stowWeibullShape',
    kind: 'slider',
    section: 'timing',
    label: 'Stow time consistency',
    min: 1,
    max: 3.5,
    step: 0.05,
    format: fixed2,
    announce: sayOf('Weibull shape'),
    explain: 'Higher means stow times cluster tightly; lower means a long tail of people who really cannot get it up there.',
  },
  {
    key: 'stowBaseMean',
    kind: 'slider',
    section: 'timing',
    label: 'Stow time (1 bag)',
    min: 3,
    max: 30,
    step: 0.5,
    format: secs,
    announce: saySecs,
    explain: 'How long a typical passenger takes to heave one bag into the overhead bin.',
  },
  {
    key: 'stowCv',
    kind: 'slider',
    section: 'timing',
    label: 'Stow variability',
    min: 0,
    max: 1.2,
    step: 0.01,
    format: fixed2,
    announce: sayOf('of the mean'),
    explain: 'Run-to-run randomness in a single stow, as a fraction of its mean.',
  },
  {
    key: 'stowBagExponent',
    kind: 'slider',
    section: 'timing',
    label: 'Second-bag exponent',
    min: 0.5,
    max: 1.3,
    step: 0.01,
    format: fixed2,
    announce: sayOf('exponent'),
    explain: 'How much cheaper the second bag is than the first. Below 1.0, two bags take less than twice as long.',
  },
  {
    key: 'stowVariability',
    kind: 'slider',
    section: 'timing',
    label: 'Per-person dexterity spread',
    min: 0,
    max: 0.8,
    step: 0.01,
    format: fixed2,
    announce: sayOf('of the mean, per person'),
    explain: 'How much people differ from each other in handling luggage \u2014 some are simply quicker every time.',
  },
  {
    key: 'stowPassSpeedFactor',
    kind: 'slider',
    section: 'timing',
    label: 'Squeeze past a stower',
    min: 0,
    max: 1,
    step: 0.05,
    format: fixed2,
    announce: sayOf('times normal walking pace, or zero for a closed aisle'),
    // The single most consequential parameter in the model: it is what makes
    // the absolute boarding time land on the field regression, and it is what
    // compresses the gaps between strategies. RESEARCH_PARAMETERS 12.3.
    explain: 'How fast one person at a time may edge past someone loading a bin, as a fraction of walking pace. Set it to 0 for strict aisle blocking (Schultz-comparable): a stowing passenger then closes the aisle outright, which widens every strategy’s advantage but overshoots real single-door boarding times by about half.',
  },
  {
    key: 'shuffleMoveMode',
    kind: 'slider',
    section: 'timing',
    label: 'One movement (typical)',
    min: 1,
    max: 6,
    step: 0.1,
    format: secs,
    announce: saySecs,
    explain: 'One elementary movement: standing up, stepping into the aisle, stepping back, or sitting down.',
  },
  {
    key: 'shuffleMoveMin',
    kind: 'slider',
    section: 'timing',
    label: 'One movement (fastest)',
    min: 0.5,
    max: 4,
    step: 0.1,
    format: secs,
    announce: saySecs,
    advanced: true,
    explain: 'The quickest anyone manages a single movement.',
  },
  {
    key: 'shuffleMoveMax',
    kind: 'slider',
    section: 'timing',
    label: 'One movement (slowest)',
    min: 1.5,
    max: 9,
    step: 0.1,
    format: secs,
    announce: saySecs,
    advanced: true,
    explain: 'The slowest a single movement takes \u2014 the passenger who needs a moment.',
  },
  {
    key: 'shuffleMovements.none',
    kind: 'slider',
    section: 'timing',
    label: 'Movements: clear row',
    min: 0,
    max: 6,
    step: 1,
    format: plain,
    announce: count('movement', 'movements'),
    explain: 'Movements needed just to sit down when nobody is in the way. Even this is not free.',
  },
  {
    key: 'shuffleMovements.aisle',
    kind: 'slider',
    section: 'timing',
    label: 'Movements: aisle seat blocks',
    min: 0,
    max: 14,
    step: 1,
    format: plain,
    announce: count('movement', 'movements'),
    explain: 'Movements when the aisle seat is already taken and its occupant has to get out.',
  },
  {
    key: 'shuffleMovements.middle',
    kind: 'slider',
    section: 'timing',
    label: 'Movements: middle seat blocks',
    min: 0,
    max: 14,
    step: 1,
    format: plain,
    announce: count('movement', 'movements'),
    explain: 'Movements when the middle seat is occupied but the aisle seat is free.',
  },
  {
    key: 'shuffleMovements.both',
    kind: 'slider',
    section: 'timing',
    label: 'Movements: both block',
    min: 0,
    max: 20,
    step: 1,
    format: plain,
    announce: count('movement', 'movements'),
    explain: 'The window-passenger-arrives-last case: two seated neighbours both have to get up.',
  },
  {
    key: 'shuffleSamePartyMovements',
    kind: 'slider',
    section: 'timing',
    label: 'Movements within a party',
    min: 0,
    max: 10,
    step: 1,
    format: plain,
    announce: count('movement', 'movements'),
    explain: 'Much cheaper: your own family stands up for you without the polite negotiation.',
  },
  {
    key: 'shuffleTime.1',
    kind: 'slider',
    section: 'timing',
    label: 'Shuffle past 1 person',
    min: 2,
    max: 25,
    step: 0.5,
    format: secs,
    announce: saySecs,
    explain: 'Time lost when one already-seated neighbour has to get up to let you in.',
  },
  {
    key: 'shuffleTime.2',
    kind: 'slider',
    section: 'timing',
    label: 'Shuffle past 2 people',
    min: 4,
    max: 40,
    step: 0.5,
    format: secs,
    announce: saySecs,
    explain: 'Time lost when two seated neighbours have to get up \u2014 the window-seat-arrives-last penalty.',
  },
  {
    key: 'shuffleCv',
    kind: 'slider',
    section: 'timing',
    label: 'Shuffle variability',
    min: 0,
    max: 1.2,
    step: 0.01,
    format: fixed2,
    announce: sayOf('of the mean'),
    explain: 'Randomness in how long a seat shuffle takes.',
  },
  {
    key: 'shuffleSamePartyTime',
    kind: 'slider',
    section: 'timing',
    label: 'Shuffle within a party',
    min: 0,
    max: 12,
    step: 0.5,
    format: secs,
    announce: saySecs,
    explain: 'Much faster: your own family stands up for you without the polite negotiation.',
  },
  {
    key: 'doorArrivalMean',
    kind: 'slider',
    section: 'timing',
    label: 'Door arrival interval',
    min: 1,
    max: 10,
    step: 0.1,
    format: secs,
    announce: saySecs,
    explain: 'Average gap between passengers reaching the aircraft door \u2014 the rate the gate can physically feed the jet bridge.',
  },
  {
    key: 'gateScanMean',
    kind: 'slider',
    section: 'timing',
    label: 'Gate scan interval',
    min: 0.5,
    max: 10,
    step: 0.1,
    format: secs,
    announce: saySecs,
    explain: 'Seconds between boarding-pass scans \u2014 the rate the gate can physically feed the jet bridge.',
  },
  {
    key: 'gateScanSd',
    kind: 'slider',
    section: 'timing',
    label: 'Gate scan spread',
    min: 0,
    max: 5,
    step: 0.1,
    format: secs,
    announce: saySecs,
    explain: 'Variability of the scan interval: misread passes, seat changes, arguments.',
  },

  // -------------------------------------------------------------------- bins
  {
    key: 'binBagsPerRowSide',
    kind: 'nullable-slider',
    section: 'bins',
    label: 'Bin capacity per row-side',
    min: 1,
    max: 10,
    step: 1,
    format: plain,
    announce: count('bag', 'bags'),
    autoLabel: 'Use airframe',
    autoSpoken: 'taken from the airframe',
    explain: 'How many bags fit in the bin above one side of one row. Bin volume is an airframe property; override it to model a retrofit.',
  },
  {
    key: 'binSearchRadius',
    kind: 'slider',
    section: 'bins',
    label: 'Bin search radius',
    min: 0,
    max: 8,
    step: 1,
    format: (v) => `${v} rows`,
    announce: count('row', 'rows'),
    explain: 'How many rows away a passenger will wander looking for a free bin before giving up.',
  },
  {
    key: 'binSearchPenalty',
    kind: 'slider',
    section: 'bins',
    label: 'Bin search penalty',
    min: 0,
    max: 15,
    step: 0.5,
    format: secs,
    announce: saySecs,
    explain: 'Extra seconds spent per row of displacement while hunting for space.',
  },
  {
    key: 'gateCheckPenalty',
    kind: 'slider',
    section: 'bins',
    label: 'Gate-check penalty',
    min: 0,
    max: 90,
    step: 1,
    format: secs,
    announce: saySecs,
    explain: 'The full stop when a bag has to go back down the jet bridge — tag, wait, hand over.',
  },
  {
    key: 'binCongestionWeight',
    kind: 'slider',
    section: 'bins',
    label: 'Full-bin fiddle factor',
    min: 0,
    max: 1.5,
    step: 0.05,
    format: fixed2,
    announce: sayOf('of the base stow time'),
    explain: 'How much longer stowing takes as a bin fills up and bags must be rearranged.',
  },

  // --------------------------------------------------------------- behaviour
  {
    key: 'zoneCount',
    kind: 'slider',
    section: 'behaviour',
    label: 'Zone count',
    min: 2,
    max: 8,
    step: 1,
    format: plain,
    announce: count('zone', 'zones'),
    explain: 'How many row bands the gate calls. More zones means finer control and more announcements.',
  },
  {
    key: 'doorAwareZones',
    kind: 'toggle',
    section: 'behaviour',
    label: 'Zones measured per door',
    explain:
      'Each open door works its own half of the cabin, far end first. Off, one cabin-wide order runs the length of the aeroplane — which is rear-first at the forward door and front-first at the rear one.',
  },
  {
    key: 'keepPartiesTogether',
    kind: 'toggle',
    section: 'behaviour',
    label: 'Keep parties together',
    explain: 'Families board as a block at their earliest member’s turn — the main reason clever orderings fall apart.',
  },
  {
    key: 'preboardFirst',
    kind: 'toggle',
    section: 'behaviour',
    label: 'Preboards first',
    explain: 'Assistance passengers are lifted to the front of the queue before anything else is applied.',
  },
  {
    key: 'nonComplianceRate',
    kind: 'slider',
    section: 'behaviour',
    label: 'Non-compliance',
    min: 0,
    max: 0.5,
    step: 0.005,
    format: pct,
    announce: sayPct,
    explain: 'Share of passengers who ignore their group call and drift up or down the queue.',
  },
  {
    key: 'complianceJitter',
    kind: 'slider',
    section: 'behaviour',
    label: 'Non-compliance drift',
    min: 0,
    max: 25,
    step: 1,
    format: (v) => `±${v}`,
    announce: (v) => `plus or minus ${sayNum(v)} queue ${Number(v) === 1 ? 'place' : 'places'}`,
    explain: 'How far out of position those passengers end up, in queue places.',
  },
  {
    key: 'lateRate',
    kind: 'slider',
    section: 'behaviour',
    label: 'Late arrivals',
    min: 0,
    max: 0.12,
    step: 0.002,
    format: pct,
    announce: sayPct,
    explain: 'Share who turn up after their group has gone and board at the very end.',
  },
  {
    key: 'openSeatingPolicy',
    kind: 'segmented',
    section: 'behaviour',
    label: 'Open-seating choice',
    options: [
      { value: 'aisle_first', label: 'Aisle' },
      { value: 'window_first', label: 'Window' },
      { value: 'front_first', label: 'Nearest' },
      { value: 'avoid_neighbours', label: 'Spread out' },
    ],
    explain: 'With no assigned seats, what passengers reach for as they walk in.',
  },
  {
    key: 'dt',
    kind: 'slider',
    section: 'behaviour',
    label: 'Engine time step',
    min: 0.05,
    max: 0.5,
    step: 0.05,
    format: secs,
    announce: saySecs,
    advanced: true,
    explain: 'Simulation tick length. Smaller is more exact and slower; 0.1 s is the calibrated value.',
  },
  {
    key: 'sampleInterval',
    kind: 'slider',
    section: 'behaviour',
    label: 'Metric sample interval',
    min: 0.5,
    max: 10,
    step: 0.5,
    format: secs,
    announce: saySecs,
    advanced: true,
    explain: 'How often curves are recorded. Only affects chart resolution, never the result.',
  },
]

/** Root key of a possibly-dotted control key. */
export const rootKey = (key) => String(key).split('.')[0]

/**
 * The engine is the authority on which parameters exist: every simulation
 * field has an entry in DEFAULTS (ENGINE_SPEC section 8). So the panel renders
 * a control only when the live engine's defaults contain its key. That keeps
 * the UI honest as the engine's parameterisation evolves, and means a control
 * for a parameter that no longer exists simply disappears instead of writing
 * dead values into the config.
 */
export function presentControls(section, defaults, mode) {
  return CONTROLS.filter((c) => c.section === section).filter((c) => {
    if (c.modes && mode != null && !c.modes.includes(mode)) return false
    if (c.kind === 'aircraft' || c.kind === 'strategy' || c.kind === 'seed' || c.kind === 'doors') return true
    if (c.shell) return true
    return Object.prototype.hasOwnProperty.call(defaults || {}, rootKey(c.key))
  })
}

/**
 * The value a nullable control falls back to when it is left on auto.
 *
 * Bin capacity inherits from the airframe; sweep replications inherit from the
 * main replication count, by the worker's own rule. Both are shown, never
 * merely implied.
 */
export function autoValueOf(control, { aircraft, config } = {}) {
  if (control.key === 'binBagsPerRowSide') return aircraft?.binBagsPerRowSide ?? control.min
  if (control.key === 'sweepRuns') return autoSweepRuns(config?.runs)
  return control.min
}

/** The panel's name for a config key, for messages about it. */
export function labelForKey(key) {
  const control = CONTROLS.find((c) => c.key === key || rootKey(c.key) === key)
  return control ? control.label : key
}

export const CONTROLS_BY_SECTION = SECTIONS.reduce((acc, s) => {
  acc[s.id] = CONTROLS.filter((c) => c.section === s.id)
  return acc
}, {})
