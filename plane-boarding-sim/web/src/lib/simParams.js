/**
 * Parameter accessors that tolerate either service-time parameterisation.
 *
 * ENGINE_SPEC section 8 documents `stowBaseMean / stowCv / stowBagExponent`
 * and `shuffleTime{1,2} / shuffleCv / gateScanMean`; parity/defaults.json has
 * since moved to the Schultz calibration — `stowWeibullShape / Scale`,
 * elementary `shuffleMovements` and `doorArrivalMean`. Rather than pick a
 * winner, the shell reads whichever the live engine exposes through these
 * helpers, and the control panel shows the controls that exist.
 */

/** log-gamma (Lanczos), used only to turn a Weibull scale into a mean. */
function lgamma(z) {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z)
  const x = z - 1
  let a = 0.99999999999980993
  const t = x + 7.5
  for (let i = 0; i < g.length; i += 1) a += g[i] / (x + i + 1)
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}

/** Mean seconds to stow ONE piece of luggage. */
export function meanStowPerBag(config) {
  if (Number.isFinite(config?.stowWeibullScale) && Number.isFinite(config?.stowWeibullShape)) {
    return config.stowWeibullScale * Math.exp(lgamma(1 + 1 / config.stowWeibullShape))
  }
  return config?.stowBaseMean ?? 12.5
}

/** Mean seconds of stowing for a passenger carrying `bags` pieces. */
export function meanStowForBags(config, bags) {
  if (bags <= 0) return 0
  if (Number.isFinite(config?.stowWeibullScale)) return bags * meanStowPerBag(config)
  return meanStowPerBag(config) * Math.pow(bags, config?.stowBagExponent ?? 0.85)
}

/** Mean seconds of a single elementary movement (stand, step out, sit). */
export function meanMovement(config) {
  const { shuffleMoveMin: a, shuffleMoveMode: m, shuffleMoveMax: b } = config || {}
  if ([a, m, b].every(Number.isFinite)) return (a + m + b) / 3
  return 2.4
}

/**
 * Mean seconds lost to a seat shuffle with `blockers` seated people in the way.
 * Maps the elementary-movement model onto the 0/1/2 blocker cases.
 */
export function meanShuffle(config, blockers) {
  const moves = config?.shuffleMovements
  if (moves) {
    const key = blockers >= 2 ? 'both' : blockers === 1 ? 'aisle' : 'none'
    return (Number(moves[key]) || 0) * meanMovement(config)
  }
  if (blockers <= 0) return 0
  return Number(config?.shuffleTime?.[blockers]) || 0
}

/** Mean seconds a same-party shuffle costs. */
export function meanSamePartyShuffle(config) {
  if (Number.isFinite(config?.shuffleSamePartyMovements)) {
    return config.shuffleSamePartyMovements * meanMovement(config)
  }
  return config?.shuffleSamePartyTime ?? 2.5
}

/** Mean seconds between passengers being fed through a single door. */
export function meanDoorInterval(config) {
  if (Number.isFinite(config?.doorArrivalMean)) return config.doorArrivalMean
  return config?.gateScanMean ?? 2.2
}

/** Bin slots per row-side: config override, else the airframe's own figure. */
export function binCapacity(config, aircraft) {
  if (Number.isFinite(config?.binBagsPerRowSide)) return config.binBagsPerRowSide
  return aircraft?.binBagsPerRowSide ?? 4
}
