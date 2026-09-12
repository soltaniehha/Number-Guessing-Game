/**
 * Relevance: is this control doing anything, given the rest of the config?
 *
 * Pure derivation — no state of its own. A control that cannot affect the
 * result is disabled and carries a tooltip saying why, which is far more
 * honest than letting someone spend a minute tuning a dead parameter.
 *
 * @returns {{relevant: boolean, reason?: string}}
 */

/** Strategies that actually divide the cabin into `zoneCount` bands. */
export const ZONE_STRATEGIES = new Set([
  'back_to_front',
  'front_to_back',
  'wilma_zoned',
  'rotating_zone',
  'block_boarding',
  'common_sense_5tier',
])

/**
 * Strategies that actually read a passenger's status tier.
 *
 * `block_boarding` is deliberately NOT here: it boards the premium *cabin*
 * first, which is a property of the seat map, and never looks at a frequent
 * flyer tier. `southwest_2026` is, because its group assignment shifts whole
 * groups by fare and status (STRATEGIES section 16).
 */
export const TIER_STRATEGIES = new Set([
  'priority_5tier',
  'common_sense_5tier',
  'southwest_2026',
  'open_seating',
])

/**
 * Strategies that order passengers by where they sit ALONG the cabin, and so
 * are the only ones the per-door regions can change (ENGINE_SPEC section 4.1
 * lists exactly these). `wilma` and `steffen_modified` are absent on purpose:
 * they order by seat depth and row parity, which say nothing about how far
 * down the aisle a passenger is walking.
 */
export const SPATIAL_STRATEGIES = new Set([
  'back_to_front',
  'front_to_back',
  'wilma_zoned',
  'rotating_zone',
  'block_boarding',
  'reverse_pyramid',
  'steffen_perfect',
  'common_sense_5tier',
  'southwest_2026',
])

const RELEVANT = { relevant: true }
const no = (reason) => ({ relevant: false, reason })

const sumWeights = (w, keys) => keys.reduce((s, k) => s + (Number(w?.[k]) || 0), 0)

/**
 * @param {string} key control key (dotted paths allowed)
 * @param {object} config the current SimConfig
 * @param {object} aircraft the resolved aircraft
 */
export function relevanceOf(key, config, aircraft) {
  const strategy = config.strategy
  const bagsCarried = sumWeights(config.bagWeights, ['1', '2'])
  const twoBaggers = sumWeights(config.bagWeights, ['2'])
  const groups = sumWeights(config.partySizeWeights, ['2', '3', '4', '5'])
  const doorCount = (config.doors || []).length
  const maxDepth = aircraft?.maxDepth ?? 3

  switch (key) {
    case 'zoneCount':
      return ZONE_STRATEGIES.has(strategy)
        ? RELEVANT
        : no('Only zone-based strategies split the cabin into bands.')

    case 'openSeatingPolicy':
      return strategy === 'open_seating'
        ? RELEVANT
        : no('Only used when seats are not assigned — pick the Open seating strategy.')

    case 'eliteMix':
      return TIER_STRATEGIES.has(strategy)
        ? RELEVANT
        : no('This strategy ignores frequent-flyer status.')

    // Where status SITS only matters to a strategy that boards by status. The
    // tilt still decides which individuals are elite under every strategy;
    // nothing else ever asks.
    case 'eliteForwardBias':
      return TIER_STRATEGIES.has(strategy)
        ? RELEVANT
        : no('This strategy ignores frequent-flyer status, so where status sits cannot change anything.')

    case 'doorAssignment':
      return doorCount > 1
        ? RELEVANT
        : no('Everyone uses the only open door.')

    // Per-door regions only exist when there is more than one region to cut
    // the cabin into, and only a strategy that orders by position along the
    // cabin can notice where the boundary falls.
    case 'doorAwareZones':
      if (doorCount < 2) return no('With one door open there is only one region, so the order is cabin-wide either way.')
      if (config.doorAssignment === 'single') {
        return no('Everyone walks to the same door under this door rule, so there is only one region.')
      }
      return SPATIAL_STRATEGIES.has(strategy)
        ? RELEVANT
        : no('This strategy does not order passengers by how far down the cabin they sit.')

    case 'complianceJitter':
      return config.nonComplianceRate > 0
        ? RELEVANT
        : no('Nobody is out of position while non-compliance is zero.')

    case 'slowSpeedFactor':
    case 'slowStowFactor':
      return config.slowPaxRate > 0
        ? RELEVANT
        : no('There are no reduced-mobility passengers on this flight.')

    case 'preboardFirst':
      return config.preboardRate > 0
        ? RELEVANT
        : no('There are no preboards to move to the front.')

    case 'childRate':
    case 'keepPartiesTogether':
    case 'shuffleSamePartyTime':
    case 'shuffleSamePartyMovements':
      return groups > 0
        ? RELEVANT
        : no('Everyone is travelling alone, so there are no parties.')

    case 'stowBaseMean':
    case 'stowCv':
    case 'stowWeibullScale':
    case 'stowWeibullShape':
    case 'stowVariability':
    case 'stowPassSpeedFactor':
    case 'binBagsPerRowSide':
    case 'binSearchRadius':
    case 'binSearchPenalty':
    case 'gateCheckPenalty':
    case 'binCongestionWeight':
      return bagsCarried > 0
        ? RELEVANT
        : no('Nobody is carrying a bag, so nothing is ever stowed.')

    case 'sweepParam':
    case 'sweepPoints':
    case 'sweepLoadFactors':
    case 'sweepValues':
    case 'sweepRuns':
      return config.sweepEnabled
        ? RELEVANT
        : no('Turn the sweep on to choose the parameter it varies and the points it runs.')

    case 'stowBagExponent':
      return twoBaggers > 0
        ? RELEVANT
        : no('Only matters when some passengers carry two bags.')

    case 'shuffleTime.1':
    case 'shuffleMovements.aisle':
      return maxDepth >= 2
        ? RELEVANT
        : no('Every seat on this aircraft touches the aisle.')

    case 'shuffleTime.2':
    case 'shuffleMovements.middle':
    case 'shuffleMovements.both':
      return maxDepth >= 3
        ? RELEVANT
        : no('No seat on this aircraft has two people between it and the aisle.')

    default:
      return RELEVANT
  }
}

/** Per-option relevance for segmented controls. */
export function optionRelevance(key, option, config, aircraft) {
  if (key === 'doorAssignment' && option === 'split_by_aisle' && (aircraft?.aisleCount ?? 1) < 2) {
    return no('Only twin-aisle aircraft can split boarding by aisle.')
  }
  return RELEVANT
}
