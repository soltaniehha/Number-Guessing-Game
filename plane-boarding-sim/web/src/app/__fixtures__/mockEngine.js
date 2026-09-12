/**
 * A deterministic *mock* engine.
 *
 * It is not a simulation: it produces RunResult-shaped output (ENGINE_SPEC
 * section 7) whose numbers move in the right direction when you move a control,
 * so the shell, charts and cabin view can be developed and demoed before the
 * real engine exists. Replaced wholesale by `src/sim/index.js`.
 */
import { resolveAircraft } from './aircraft.js'

/* ---------------------------------------------------------------- rng ---- */

function hashString(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

function mulberry32(a) {
  let t = a >>> 0
  return function next() {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/* ---------------------------------------------------- strategy character -- */

/** Relative aisle efficiency, shuffle avoidance and aisle spreading per strategy. */
const CHARACTER = {
  random: { eff: 1.15, outsideIn: 0.0, spread: 0.75 },
  back_to_front: { eff: 0.86, outsideIn: 0.0, spread: 0.2 },
  front_to_back: { eff: 0.75, outsideIn: 0.0, spread: 0.1 },
  wilma: { eff: 1.35, outsideIn: 0.95, spread: 0.7 },
  wilma_zoned: { eff: 1.44, outsideIn: 0.95, spread: 0.85 },
  steffen_perfect: { eff: 1.9, outsideIn: 1.0, spread: 1.0 },
  steffen_modified: { eff: 1.58, outsideIn: 0.85, spread: 0.9 },
  reverse_pyramid: { eff: 1.42, outsideIn: 0.8, spread: 0.85 },
  rotating_zone: { eff: 1.12, outsideIn: 0.0, spread: 0.6 },
  block_boarding: { eff: 0.95, outsideIn: 0.0, spread: 0.3 },
  open_seating: { eff: 1.3, outsideIn: 0.55, spread: 0.8 },
  priority_5tier: { eff: 1.05, outsideIn: 0.05, spread: 0.45 },
  common_sense_5tier: { eff: 1.4, outsideIn: 0.78, spread: 0.82 },
  by_bags: { eff: 1.18, outsideIn: 0.0, spread: 0.6 },
  slowest_first: { eff: 1.2, outsideIn: 0.1, spread: 0.65 },
}

/** Aisle-parallelism constant, tuned so a full A320 lands in the observed 15-45 min band. */
const PARALLEL_BASE = 2.1

const weightedMean = (weights) => {
  const entries = Object.entries(weights || {})
  const total = entries.reduce((s, [, w]) => s + Number(w), 0) || 1
  return entries.reduce((s, [k, w]) => s + Number(k) * Number(w), 0) / total
}

/* --------------------------------------------------------------- core ---- */

function plan(config) {
  const aircraft = resolveAircraft(config.aircraftId)
  const rnd = mulberry32(hashString(`${config.seed}|${config.strategy}|${config.aircraftId}|${config.loadFactor}`))
  const ch = CHARACTER[config.strategy] || CHARACTER.random

  const seatCount = aircraft.seatCount
  const paxCount = Math.max(1, Math.round(config.loadFactor * seatCount))
  const doors = Math.max(1, (config.doors || []).length)
  const meanBags = weightedMean(config.bagWeights)
  const meanParty = weightedMean(config.partySizeWeights)

  // Base service time per passenger, seconds of aisle occupancy.
  const stow = meanBags > 0 ? config.stowBaseMean * Math.pow(Math.max(meanBags, 0.01), config.stowBagExponent) : 0
  const shuffleRisk = (1 - ch.outsideIn) * (aircraft.maxDepth >= 3 ? 0.55 : 0.3)
  const shuffle = shuffleRisk * (config.shuffleTime?.[1] ?? 9)
  const binPenalty = 1 + config.binCongestionWeight * Math.min(1, (meanBags * paxCount) / (aircraft.rowCount * 2 * Math.max(1, config.binBagsPerRowSide)))
  const service = (stow + shuffle) * binPenalty

  // How much of the cabin can be serviced at once.
  const doorFactor = 1 + 0.72 * (doors - 1)
  const parallel = PARALLEL_BASE * doorFactor * ch.eff
  const friction =
    1 +
    0.9 * config.nonComplianceRate +
    1.4 * config.lateRate +
    (config.keepPartiesTogether ? 0.05 * (meanParty - 1) : 0) +
    0.25 * config.slowPaxRate * config.slowStowFactor

  const walkFloor = (aircraft.lengthM / Math.max(0.35, config.walkSpeedMean)) * 0.6
  const totalSeconds =
    (walkFloor + (paxCount * service * friction) / parallel + (paxCount * config.gateScanMean * 0.12) / doorFactor) *
    (0.94 + 0.12 * rnd())

  return { aircraft, rnd, ch, seatCount, paxCount, meanBags, meanParty, service, totalSeconds, doors }
}

/**
 * @param {object} config SimConfig
 * @returns {object} RunResult (ENGINE_SPEC section 7)
 */
export function runSimulation(config) {
  const p = plan(config)
  const { rnd, aircraft, paxCount, totalSeconds } = p
  const sample = config.sampleInterval || 2

  const seatedCurve = []
  const aisleOccupancy = []
  for (let t = 0; t <= totalSeconds; t += sample) {
    const u = t / totalSeconds
    const seated = Math.round(paxCount * Math.min(1, Math.pow(u, 1.35) * (1.06 - 0.06 * u)))
    seatedCurve.push({ t: Number(t.toFixed(1)), seated })
    const bell = Math.exp(-Math.pow((u - 0.45) / 0.32, 2))
    aisleOccupancy.push({ t: Number(t.toFixed(1)), count: Math.round(bell * Math.min(26, paxCount / 6) + 0.5) })
  }
  if (seatedCurve.length) seatedCurve[seatedCurve.length - 1].seated = paxCount

  const buckets = 40
  const congestion = aircraft.rowSlots.map((_, r) =>
    Array.from({ length: buckets }, (_, b) => {
      const rowU = r / Math.max(1, aircraft.rowCount - 1)
      const tU = b / (buckets - 1)
      const wave = Math.exp(-Math.pow((tU - (0.15 + 0.7 * (1 - rowU))) / 0.22, 2))
      return Number((wave * (1.2 + rnd() * 0.8)).toFixed(3))
    }),
  )

  const perPassenger = []
  const shuffled = aircraft.seats.slice(0, paxCount)
  let walk = 0
  let stowTot = 0
  let shuffleTot = 0
  let blockedTot = 0
  const interference = { none: 0, one: 0, two: 0, sameParty: 0 }
  let gateChecks = 0
  let binSearches = 0

  shuffled.forEach((seat, i) => {
    const enterTime = (i / paxCount) * totalSeconds * 0.92
    const walkTime = seat.x / Math.max(0.3, config.walkSpeedMean)
    const stowTime = rnd() < (config.bagWeights?.[0] ?? 0.2) ? 0 : config.stowBaseMean * (0.6 + rnd() * 0.9)
    const blockers = seat.depth - 1 - Math.floor(rnd() * seat.depth * (p.ch.outsideIn > 0.7 ? 0.1 : 1))
    const nBlock = Math.max(0, Math.min(2, blockers))
    const shuffleTime = nBlock === 0 ? 0 : (config.shuffleTime?.[nBlock] ?? 9) * (0.7 + rnd() * 0.6)
    const blockedTime = rnd() * totalSeconds * 0.06
    const timeInAisle = walkTime + stowTime + shuffleTime + blockedTime
    if (nBlock === 0) interference.none += 1
    else if (nBlock === 1) interference.one += 1
    else interference.two += 1
    if (rnd() < 0.05) interference.sameParty += 1
    if (rnd() < 0.06) gateChecks += 1
    if (rnd() < 0.18) binSearches += 1
    walk += walkTime
    stowTot += stowTime
    shuffleTot += shuffleTime
    blockedTot += blockedTime
    perPassenger.push({
      id: i,
      seat: seat.id,
      row: seat.rowNumber,
      letter: seat.letter,
      depth: seat.depth,
      tier: 'standard',
      groupLabel: `Group ${1 + (i % Math.max(1, config.zoneCount))}`,
      doorId: (config.doors && config.doors[0]) || '1L',
      bags: stowTime === 0 ? 0 : 1,
      party: Math.floor(i / 2),
      enterTime: Number(enterTime.toFixed(2)),
      sitTime: Number((enterTime + timeInAisle).toFixed(2)),
      timeInAisle: Number(timeInAisle.toFixed(2)),
      walkTime: Number(walkTime.toFixed(2)),
      stowTime: Number(stowTime.toFixed(2)),
      shuffleTime: Number(shuffleTime.toFixed(2)),
      blockedTime: Number(blockedTime.toFixed(2)),
      queueWaitTime: Number((enterTime * 0.4).toFixed(2)),
    })
  })

  const waits = perPassenger.map((x) => x.timeInAisle).sort((a, b) => a - b)
  const q = (f) => waits[Math.min(waits.length - 1, Math.floor(f * waits.length))] ?? 0

  return {
    totalSeconds: Number(totalSeconds.toFixed(2)),
    totalMinutes: Number((totalSeconds / 60).toFixed(3)),
    strategy: config.strategy,
    aircraftId: config.aircraftId,
    seed: config.seed,
    paxCount,
    seatCount: p.seatCount,
    loadFactor: config.loadFactor,
    seatedCurve,
    aisleOccupancy,
    congestion,
    perPassenger,
    timeBreakdown: {
      walk: Number(walk.toFixed(1)),
      stow: Number(stowTot.toFixed(1)),
      shuffle: Number(shuffleTot.toFixed(1)),
      blocked: Number(blockedTot.toFixed(1)),
    },
    interference,
    gateChecks,
    binSearches,
    aisleBlockEvents: Math.round(paxCount * 0.6),
    p50TimeToSeat: Number(q(0.5).toFixed(2)),
    p90TimeToSeat: Number(q(0.9).toFixed(2)),
    maxTimeToSeat: Number((waits[waits.length - 1] ?? 0).toFixed(2)),
    throughputPaxPerMin: Number((paxCount / (totalSeconds / 60)).toFixed(2)),
    isMock: true,
  }
}

/**
 * Mock Replay. Frame buffer sampled at 2 Hz.
 *
 * ASSUMED SHAPE (documented in engineBridge.js): the cabin agent's real Replay
 * is expected to expose at least `{ result, dt, duration, frames }` where each
 * frame is `{ t, pax: [{ id, x, aisleIndex, state, seat }] }`. `frameAt(t)` is
 * provided as a convenience.
 */
export function runReplay(config) {
  const result = runSimulation(config)
  const aircraft = resolveAircraft(config.aircraftId)
  const frameDt = 0.5
  const duration = result.totalSeconds
  const frames = []
  const seatById = new Map(aircraft.seats.map((s) => [s.id, s]))
  for (let t = 0; t <= duration + frameDt; t += frameDt) {
    const pax = []
    for (const p of result.perPassenger) {
      const seat = seatById.get(p.seat)
      if (t < p.enterTime - 30) {
        pax.push({ id: p.id, x: -2, aisleIndex: seat?.aisleIndex ?? 0, state: 'QUEUED', seat: p.seat })
      } else if (t < p.enterTime) {
        pax.push({ id: p.id, x: -1.2 + 0.8 * ((t - p.enterTime + 30) / 30), aisleIndex: seat?.aisleIndex ?? 0, state: 'QUEUED', seat: p.seat })
      } else if (t < p.sitTime - p.stowTime - p.shuffleTime) {
        const u = (t - p.enterTime) / Math.max(0.1, p.walkTime + p.blockedTime)
        pax.push({ id: p.id, x: (seat?.x ?? 0) * Math.min(1, u), aisleIndex: seat?.aisleIndex ?? 0, state: 'WALKING', seat: p.seat })
      } else if (t < p.sitTime) {
        pax.push({ id: p.id, x: seat?.x ?? 0, aisleIndex: seat?.aisleIndex ?? 0, state: t < p.sitTime - p.shuffleTime ? 'STOWING' : 'SHUFFLING', seat: p.seat })
      } else {
        pax.push({ id: p.id, x: seat?.x ?? 0, aisleIndex: seat?.aisleIndex ?? 0, state: 'SEATED', seat: p.seat })
      }
    }
    frames.push({ t: Number(t.toFixed(2)), pax })
  }
  return {
    result,
    aircraft,
    dt: frameDt,
    duration,
    frames,
    frameAt(t) {
      return frames[Math.max(0, Math.min(frames.length - 1, Math.round(t / frameDt)))]
    },
    isMock: true,
  }
}
