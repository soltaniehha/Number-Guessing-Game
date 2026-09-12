/**
 * The seven named scenarios of UI_SPEC section 3.1.
 *
 * A preset is a *patch*: applying it means "defaults, then these values", so a
 * preset never silently inherits whatever you were fiddling with. Each carries
 * a one-line description of the real-world situation it reproduces.
 *
 * A patch may name a parameter under either service-time parameterisation
 * (see lib/simParams.js); keys the live engine does not know about are dropped
 * when the preset is applied, so a preset never writes dead values.
 */

export const PRESETS = [
  {
    id: 'us_legacy_hub',
    name: 'US legacy hub, full flight',
    blurb: 'A packed morning bank at a US hub: five revenue tiers, one jet bridge, not a spare seat.',
    patch: {
      aircraftId: 'a320neo',
      strategy: 'priority_5tier',
      loadFactor: 0.98,
      doors: ['1L'],
      doorAssignment: 'single',
      zoneCount: 5,
      preboardRate: 0.035,
    },
  },
  {
    id: 'euro_lcc',
    name: 'European LCC turnaround',
    blurb: 'Twenty-five minutes on stand: both airstairs open, small bins, and nobody listening to the group calls.',
    patch: {
      aircraftId: 'b737-8200',
      strategy: 'random',
      loadFactor: 0.96,
      doors: ['1L', '2L'],
      doorAssignment: 'split_by_row',
      nonComplianceRate: 0.24,
      complianceJitter: 10,
      binBagsPerRowSide: 3,
      bagWeights: { 0: 0.1, 1: 0.55, 2: 0.35 },
      gateScanMean: 1.8,
      doorArrivalMean: 3.0,
    },
  },
  {
    id: 'regional_commuter',
    name: 'Regional commuter',
    blurb: 'A 2-2 regional jet where half the roller-bags will not fit and get tagged on the airbridge.',
    patch: {
      aircraftId: 'e175',
      strategy: 'back_to_front',
      loadFactor: 0.88,
      doors: ['1L'],
      doorAssignment: 'single',
      zoneCount: 3,
      binBagsPerRowSide: 2,
      binSearchRadius: 1,
      gateCheckPenalty: 30,
      bagWeights: { 0: 0.12, 1: 0.6, 2: 0.28 },
    },
  },
  {
    id: 'longhaul_widebody',
    name: 'Long-haul widebody',
    blurb: 'Twin-aisle, two doors, everybody with a full-size wheelie and a duty-free bag.',
    patch: {
      aircraftId: 'b777-300er',
      strategy: 'block_boarding',
      loadFactor: 0.92,
      doors: ['1L', '2L'],
      doorAssignment: 'split_by_row',
      zoneCount: 5,
      bagWeights: { 0: 0.06, 1: 0.5, 2: 0.44 },
      stowBaseMean: 15.5,
      stowWeibullScale: 19.0,
      binBagsPerRowSide: 5,
      childRate: 0.24,
    },
  },
  {
    id: 'southwest_open',
    name: 'Southwest legacy open seating',
    blurb: 'No assigned seats at all: board in check-in order and grab the first aisle you like.',
    patch: {
      aircraftId: 'b737-800',
      strategy: 'open_seating',
      loadFactor: 0.95,
      doors: ['1L'],
      doorAssignment: 'single',
      openSeatingPolicy: 'aisle_first',
      keepPartiesTogether: true,
    },
  },
  {
    id: 'steffen_ideal',
    name: "Steffen's laboratory ideal",
    blurb: 'The physics-paper conditions: perfect Steffen order, everyone solo, everyone compliant, nobody late.',
    patch: {
      aircraftId: 'a320neo',
      strategy: 'steffen_perfect',
      loadFactor: 1,
      doors: ['1L'],
      doorAssignment: 'single',
      partySizeWeights: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 },
      keepPartiesTogether: false,
      preboardRate: 0,
      slowPaxRate: 0,
      childRate: 0,
      nonComplianceRate: 0,
      lateRate: 0,
    },
  },
  {
    id: 'nightmare',
    name: 'The nightmare',
    blurb: 'Front-to-back on a completely full aircraft, two bags each, bins the size of a glovebox.',
    patch: {
      aircraftId: 'a320neo',
      strategy: 'front_to_back',
      loadFactor: 1,
      doors: ['1L'],
      doorAssignment: 'single',
      zoneCount: 6,
      bagWeights: { 0: 0, 1: 0, 2: 1 },
      binBagsPerRowSide: 1,
      binSearchRadius: 2,
      gateCheckPenalty: 45,
      nonComplianceRate: 0.35,
      complianceJitter: 14,
      lateRate: 0.05,
    },
  },
]

export const PRESET_BY_ID = Object.fromEntries(PRESETS.map((p) => [p.id, p]))
