/**
 * A copy of `parity/defaults.json` so the shell can boot standalone.
 *
 * The real engine exports the parsed JSON file itself as `DEFAULTS`; this copy
 * exists ONLY so the app runs before `src/sim/index.js` lands. If the two ever
 * disagree, parity/defaults.json wins.
 */
export const ENGINE_DEFAULTS = {
  loadFactor: 0.92,
  doorAssignment: 'split_by_row',

  bagWeights: { 0: 0.2, 1: 0.62, 2: 0.18 },
  partySizeWeights: { 1: 0.52, 2: 0.3, 3: 0.1, 4: 0.06, 5: 0.02 },

  walkSpeedMean: 0.9,
  walkSpeedSd: 0.18,

  preboardRate: 0.025,
  slowPaxRate: 0.05,
  slowSpeedFactor: 0.55,
  slowStowFactor: 1.6,
  childRate: 0.18,

  eliteMix: { elite_top: 0.05, elite_mid: 0.1, cardholder: 0.15, standard: 0.55, basic: 0.15 },

  stowBaseMean: 12.5,
  stowCv: 0.45,
  stowBagExponent: 0.85,
  stowVariability: 0.28,

  shuffleTime: { 1: 9.0, 2: 15.0 },
  shuffleCv: 0.35,
  shuffleSamePartyTime: 2.5,

  gateScanMean: 2.2,
  gateScanSd: 1.1,

  binBagsPerRowSide: 4,
  binSearchRadius: 3,
  binSearchPenalty: 3.5,
  gateCheckPenalty: 22.0,
  binCongestionWeight: 0.45,

  zoneCount: 4,
  keepPartiesTogether: true,
  preboardFirst: true,
  nonComplianceRate: 0.08,
  complianceJitter: 6,
  lateRate: 0.01,
  openSeatingPolicy: 'aisle_first',

  dt: 0.1,
  sampleInterval: 2.0,
}
