/**
 * Configuration loading, layering and validation.
 *
 * Port of `python/plane_boarding/config.py`.
 *
 * The defaults are IMPORTED from `parity/defaults.json`, the same file the
 * Python engine reads. Nothing in here restates a constant: a number copied
 * into two languages is a parity bug waiting to happen.
 *
 * Three layers, applied in this order:
 *
 *     parity/defaults.json  ->  aircraft.defaultConfig  ->  user overrides
 */
import DEFAULTS_JSON from '../../../parity/defaults.json' with { type: 'json' }
import { pyRoundInt } from './pyutil.js'

/** The parsed `parity/defaults.json`, comment keys and all. */
export const DEFAULTS = DEFAULTS_JSON

export function loadDefaults() {
  return DEFAULTS
}

/** Drop `_`-prefixed documentation keys. They are for humans, not the engine. */
function stripComments(d) {
  const out = {}
  for (const k of Object.keys(d)) {
    if (!k.startsWith('_')) out[k] = d[k]
  }
  return out
}

export const CONSTANTS = { ...DEFAULTS._constants }

export const BODY_DEPTH = CONSTANTS.BODY_DEPTH
export const DESIRED_HEADWAY = CONSTANTS.DESIRED_HEADWAY
export const MIN_SPEED_FRACTION = CONSTANTS.MIN_SPEED_FRACTION
export const INCH = CONSTANTS.INCH
export const MAX_SIM_SECONDS = CONSTANTS.MAX_SIM_SECONDS

// PCG32 stream layout (ENGINE_SPEC 1.3). Loaded rather than hard-coded so the
// two engines cannot drift on a stream index.
export const PAX_STREAM = Math.trunc(CONSTANTS.PAX_STREAM)
export const ORDER_STREAM = Math.trunc(CONSTANTS.ORDER_STREAM)
export const DOOR_STREAM_BASE = Math.trunc(CONSTANTS.DOOR_STREAM_BASE)
export const SERVICE_STREAM_BASE = Math.trunc(CONSTANTS.SERVICE_STREAM_BASE)
export const SERVICE_STREAM_STRIDE = Math.trunc(CONSTANTS.SERVICE_STREAM_STRIDE)

// Phase offsets within a passenger's sub-stream block. Each phase is a separate
// stream so that a phase whose draw COUNT depends on the boarding order (bin
// search, shuffle movements) cannot shift the phases either side of it.
export const SERVICE_PHASE_STOW = 0
export const SERVICE_PHASE_BIN = 1
export const SERVICE_PHASE_SHUFFLE = 2
export const SERVICE_PHASE_BEHAVIOUR = 3

export const DOOR_ASSIGNMENTS = ['single', 'split_by_row', 'split_by_aisle']
export const OPEN_SEATING_POLICIES = ['aisle_first', 'window_first', 'front_first', 'avoid_neighbours']

/** Passenger states, shared with the replay format and the web renderer. */
export const QUEUED = 0
export const WALKING = 1
export const STOWING = 2
export const SHUFFLING = 3
export const SEATED = 4

/** Raised for a scenario that cannot physically be simulated. */
export class ConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConfigError'
  }
}

/**
 * Turn `{"0": w, "1": w}` into parallel key/weight arrays sorted by key.
 *
 * Numeric ordering (not JSON insertion order) is the canonical order for
 * integer-keyed maps, so Python and JS agree without either language's
 * dict-ordering rules mattering. JavaScript would iterate integer-like keys in
 * ascending numeric order anyway, but relying on that is exactly the kind of
 * implicit agreement this project refuses to depend on.
 */
function numericWeightMap(raw, name) {
  const rawKeys = Object.keys(raw || {})
  const keys = []
  for (const k of rawKeys) {
    const n = Number(k)
    if (!Number.isInteger(n)) {
      throw new ConfigError(`${name}: keys must be integers, got ${JSON.stringify(rawKeys)}`)
    }
    keys.push(n)
  }
  keys.sort((a, b) => a - b)
  const weights = keys.map((k) => Number(raw[String(k)]))
  if (keys.length === 0) throw new ConfigError(`${name}: must not be empty`)
  if (weights.some((w) => w < 0)) throw new ConfigError(`${name}: weights must be non-negative`)
  let total = 0
  for (const w of weights) total += w
  if (total <= 0) throw new ConfigError(`${name}: weights must not all be zero`)
  return [keys, weights]
}

/** String-keyed weights keep JSON insertion order, which both languages preserve. */
function stringWeightMap(raw, name) {
  const keys = Object.keys(raw || {}).map(String)
  const weights = keys.map((k) => Number(raw[k]))
  if (keys.length === 0) throw new ConfigError(`${name}: must not be empty`)
  let total = 0
  for (const w of weights) total += w
  if (total <= 0) throw new ConfigError(`${name}: weights must not all be zero`)
  return [keys, weights]
}

/**
 * A fully resolved scenario. Treat it as read-only.
 *
 * Fields are plain numbers rather than a nested object because the engine's
 * inner loop touches them tens of thousands of times per run.
 */
export class SimConfig {
  constructor(resolved) {
    const r = resolved
    this.raw = { ...r }

    this.aircraftId = String(r.aircraftId)
    this.strategy = String(r.strategy)
    this.seed = Math.trunc(Number(r.seed))
    this.loadFactor = Number(r.loadFactor)
    const doors = r.doors
    this.doors = doors === null || doors === undefined ? null : Array.from(doors)
    this.doorAssignment = String(r.doorAssignment)

    const [bagKeys, bagWeights] = numericWeightMap(r.bagWeights, 'bagWeights')
    this.bagKeys = bagKeys
    this.bagWeights = bagWeights
    const [partyKeys, partyWeights] = numericWeightMap(r.partySizeWeights, 'partySizeWeights')
    this.partyKeys = partyKeys
    this.partyWeights = partyWeights
    const [eliteKeys, eliteWeights] = stringWeightMap(r.eliteMix, 'eliteMix')
    this.eliteKeys = eliteKeys
    this.eliteWeights = eliteWeights
    this.eliteForwardBias = Number(r.eliteForwardBias)

    this.walkSpeedMean = Number(r.walkSpeedMean)
    this.walkSpeedSd = Number(r.walkSpeedSd)
    this.preboardRate = Number(r.preboardRate)
    this.slowPaxRate = Number(r.slowPaxRate)
    this.slowSpeedFactor = Number(r.slowSpeedFactor)
    this.slowStowFactor = Number(r.slowStowFactor)
    this.childRate = Number(r.childRate)

    this.stowWeibullShape = Number(r.stowWeibullShape)
    this.stowWeibullScale = Number(r.stowWeibullScale)
    this.stowVariability = Number(r.stowVariability)

    this.shuffleMoveMin = Number(r.shuffleMoveMin)
    this.shuffleMoveMode = Number(r.shuffleMoveMode)
    this.shuffleMoveMax = Number(r.shuffleMoveMax)
    const mv = r.shuffleMovements
    this.shuffleMovements = {
      none: Math.trunc(Number(mv.none)),
      aisle: Math.trunc(Number(mv.aisle)),
      middle: Math.trunc(Number(mv.middle)),
      both: Math.trunc(Number(mv.both)),
    }
    this.shuffleSamePartyMovements = Math.trunc(Number(r.shuffleSamePartyMovements))

    this.stowPassSpeedFactor = Number(r.stowPassSpeedFactor)
    this.doorArrivalMean = Number(r.doorArrivalMean)

    const bb = r.binBagsPerRowSide
    this.binBagsPerRowSide = bb === null || bb === undefined ? null : Math.trunc(Number(bb))
    this.binSearchRadius = Math.trunc(Number(r.binSearchRadius))
    this.binSearchPenalty = Number(r.binSearchPenalty)
    this.gateCheckPenalty = Number(r.gateCheckPenalty)
    this.binCongestionWeight = Number(r.binCongestionWeight)

    this.zoneCount = Math.trunc(Number(r.zoneCount))
    this.keepPartiesTogether = Boolean(r.keepPartiesTogether)
    this.preboardFirst = Boolean(r.preboardFirst)
    this.nonComplianceRate = Number(r.nonComplianceRate)
    this.complianceJitter = Math.trunc(Number(r.complianceJitter))
    this.lateRate = Number(r.lateRate)
    this.openSeatingPolicy = String(r.openSeatingPolicy)

    this.dt = Number(r.dt)
    this.sampleInterval = Number(r.sampleInterval)

    this._validate()
  }

  _validate() {
    if (!(this.loadFactor >= 0 && this.loadFactor <= 1)) {
      throw new ConfigError(`loadFactor must be in [0, 1], got ${this.loadFactor}`)
    }
    if (!DOOR_ASSIGNMENTS.includes(this.doorAssignment)) {
      throw new ConfigError(
        `doorAssignment must be one of ${DOOR_ASSIGNMENTS}, got '${this.doorAssignment}'`,
      )
    }
    if (!OPEN_SEATING_POLICIES.includes(this.openSeatingPolicy)) {
      throw new ConfigError(
        `openSeatingPolicy must be one of ${OPEN_SEATING_POLICIES}, got '${this.openSeatingPolicy}'`,
      )
    }
    if (!(this.dt > 0)) throw new ConfigError(`dt must be positive, got ${this.dt}`)
    if (!(this.sampleInterval > 0)) {
      throw new ConfigError(`sampleInterval must be positive, got ${this.sampleInterval}`)
    }
    if (this.zoneCount < 1) throw new ConfigError(`zoneCount must be >= 1, got ${this.zoneCount}`)
    if (!(this.walkSpeedMean > 0)) {
      throw new ConfigError(`walkSpeedMean must be positive, got ${this.walkSpeedMean}`)
    }
    if (this.walkSpeedSd < 0) {
      throw new ConfigError(`walkSpeedSd must be non-negative, got ${this.walkSpeedSd}`)
    }
    if (!(this.shuffleMoveMin <= this.shuffleMoveMode && this.shuffleMoveMode <= this.shuffleMoveMax)) {
      throw new ConfigError(
        'shuffle movement triangular must satisfy min <= mode <= max, got ' +
          `(${this.shuffleMoveMin}, ${this.shuffleMoveMode}, ${this.shuffleMoveMax})`,
      )
    }
    if (!(this.stowPassSpeedFactor >= 0 && this.stowPassSpeedFactor <= 1)) {
      throw new ConfigError(
        'stowPassSpeedFactor must be in [0, 1] -- it is a fraction of walk speed, got ' +
          `${this.stowPassSpeedFactor}`,
      )
    }
    if (this.doorArrivalMean < 0) {
      throw new ConfigError(`doorArrivalMean must be non-negative, got ${this.doorArrivalMean}`)
    }
    if (this.binSearchRadius < 0) {
      throw new ConfigError(`binSearchRadius must be non-negative, got ${this.binSearchRadius}`)
    }
    if (this.binBagsPerRowSide !== null && this.binBagsPerRowSide < 0) {
      throw new ConfigError('binBagsPerRowSide must be non-negative')
    }
    for (const name of ['preboardRate', 'slowPaxRate', 'childRate', 'nonComplianceRate', 'lateRate']) {
      const v = this[name]
      if (!(v >= 0 && v <= 1)) {
        throw new ConfigError(`${name} must be a probability in [0, 1], got ${v}`)
      }
    }
    if (this.complianceJitter < 0) throw new ConfigError('complianceJitter must be non-negative')
    if (!(this.eliteForwardBias >= 0.0 && this.eliteForwardBias <= 1.0)) {
      throw new ConfigError(
        'eliteForwardBias must be in [0, 1] -- it is a linear tilt on the eliteMix ' +
          `weights and 1.0 already zeroes the rearmost row, got ${this.eliteForwardBias}`,
      )
    }
    for (const k of ['none', 'aisle', 'middle', 'both']) {
      if (this.shuffleMovements[k] < 0) {
        throw new ConfigError(`shuffleMovements[${k}] must be non-negative`)
      }
    }
  }

  /** Return a copy with `overrides` applied. Used heavily by sweeps. */
  replace(overrides) {
    return new SimConfig({ ...this.raw, ...overrides })
  }

  toDict() {
    return { ...this.raw }
  }
}

/**
 * Layer defaults -> aircraft defaults -> user overrides into a `SimConfig`.
 *
 * `aircraftId`, `strategy` and `seed` have no entry in defaults.json (they are
 * scenario identity, not calibration), so they get pragmatic fallbacks here.
 *
 * @param {object|null} aircraftDefaults
 * @param {object|null} overrides
 */
export function buildConfig(aircraftDefaults, overrides) {
  const resolved = {
    aircraftId: 'a320neo',
    strategy: 'random',
    seed: 1,
    doors: null,
  }
  Object.assign(resolved, stripComments(loadDefaults()))
  delete resolved._constants
  if (aircraftDefaults) Object.assign(resolved, stripComments(aircraftDefaults))
  if (overrides) {
    const unknown = Object.keys(overrides).filter(
      (k) => !Object.prototype.hasOwnProperty.call(resolved, k),
    )
    if (unknown.length) {
      throw new ConfigError(`unknown config keys: ${JSON.stringify(unknown.sort())}`)
    }
    Object.assign(resolved, overrides)
  }
  return new SimConfig(resolved)
}

/** The set of keys `buildConfig` recognises as overrides. */
export function knownConfigKeys() {
  const keys = new Set(['aircraftId', 'strategy', 'seed', 'doors'])
  for (const k of Object.keys(stripComments(loadDefaults()))) {
    if (k !== '_constants') keys.add(k)
  }
  return keys
}

/** Mean overhead-bin pieces per passenger. */
export function expectedBagsPerPax(cfg) {
  let total = 0
  for (const w of cfg.bagWeights) total += w
  let acc = 0
  for (let i = 0; i < cfg.bagKeys.length; i++) acc += cfg.bagKeys[i] * cfg.bagWeights[i]
  return acc / total
}

/**
 * Number of whole `dt` steps a service time occupies.
 *
 * Integer tick arithmetic (rather than accumulating floats) is what keeps the
 * two implementations from drifting apart over a 10,000-step run.
 */
export function ticksFor(duration, dt) {
  if (duration <= 0) return 0
  return Math.ceil(duration / dt - 1e-9)
}

export { pyRoundInt }
