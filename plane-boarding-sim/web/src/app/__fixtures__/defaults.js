/**
 * A copy of `parity/defaults.json` (minus its `_comment` annotations) so the
 * shell can boot standalone.
 *
 * The real engine exports the parsed JSON file itself as `DEFAULTS`; this copy
 * exists ONLY so the app runs before `src/sim/index.js` lands. If the two ever
 * disagree, parity/defaults.json wins. The control panel is presence-driven
 * (see app/controlSchema.js), so adding or removing a parameter here is enough
 * to add or remove its control.
 */
export const ENGINE_DEFAULTS = {
    "loadFactor": 0.92,
    "doorAssignment": "split_by_row",
    "bagWeights": {
      0: 0.1,
      1: 0.42,
      2: 0.48
    },
    "partySizeWeights": {
      1: 0.52,
      2: 0.3,
      3: 0.1,
      4: 0.06,
      5: 0.02
    },
    "walkSpeedMean": 0.8,
    "walkSpeedSd": 0.15,
    "preboardRate": 0.025,
    "slowPaxRate": 0.05,
    "slowSpeedFactor": 0.55,
    "slowStowFactor": 1.6,
    "childRate": 0.18,
    "eliteMix": {
      "elite_top": 0.05,
      "elite_mid": 0.1,
      "cardholder": 0.15,
      "standard": 0.55,
      "basic": 0.15
    },
    "stowWeibullShape": 1.7,
    "stowWeibullScale": 16.0,
    "stowVariability": 0.28,
    "shuffleMoveMin": 1.8,
    "shuffleMoveMode": 2.4,
    "shuffleMoveMax": 3.0,
    "shuffleMovements": {
      "none": 1,
      "aisle": 4,
      "middle": 5,
      "both": 9
    },
    "shuffleSamePartyMovements": 2,
    "doorArrivalMean": 3.7,
    "binBagsPerRowSide": null,
    "binSearchRadius": 3,
    "binSearchPenalty": 3.5,
    "gateCheckPenalty": 22.0,
    "binCongestionWeight": 0.45,
    "zoneCount": 4,
    "keepPartiesTogether": true,
    "preboardFirst": true,
    "nonComplianceRate": 0.15,
    "complianceJitter": 6,
    "lateRate": 0.01,
    "openSeatingPolicy": "aisle_first",
    "dt": 0.1,
    "sampleInterval": 2.0
  }
