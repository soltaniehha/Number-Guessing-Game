import { useMemo, useRef } from 'react'
import { seriesColor, seriesShape, MAX_SERIES } from './primitives/palette.js'

/**
 * Reading a (possibly very partial) BatchResult.
 *
 * Every accessor here tolerates missing fields: the dashboard has to render
 * honestly after one replication, and mid-stream a strategy may have a
 * `totalSeconds` summary but no congestion matrix yet.
 */

/** STRATEGIES.md order — used only to break ties when new keys appear. */
export const CANONICAL_STRATEGY_ORDER = [
  'random',
  'back_to_front',
  'front_to_back',
  'wilma',
  'wilma_zoned',
  'steffen_perfect',
  'steffen_modified',
  'reverse_pyramid',
  'rotating_zone',
  'block_boarding',
  'open_seating',
  'priority_5tier',
  'common_sense_5tier',
  'by_bags',
  'slowest_first',
]

const FALLBACK_NAMES = {
  random: 'Free-for-all',
  back_to_front: 'Back-to-front zones',
  front_to_back: 'Front-to-back zones',
  wilma: 'Window / Middle / Aisle',
  wilma_zoned: 'Outside-in × back-to-front',
  steffen_perfect: 'Steffen (perfect)',
  steffen_modified: 'Steffen (modified)',
  reverse_pyramid: 'Reverse pyramid',
  rotating_zone: 'Rotating zone',
  block_boarding: 'Zone blocks',
  open_seating: 'Open seating',
  priority_5tier: '5-tier priority',
  common_sense_5tier: '5-tier common sense',
  by_bags: 'Carry-on based',
  slowest_first: 'Slowest first',
}

export const strategyName = (key, entry) =>
  entry?.name ?? FALLBACK_NAMES[key] ?? key

const canonicalIndex = (key) => {
  const i = CANONICAL_STRATEGY_ORDER.indexOf(key)
  return i === -1 ? CANONICAL_STRATEGY_ORDER.length : i
}

export const batchKeys = (batch) => Object.keys(batch?.byStrategy ?? {})

export const hasAnyRuns = (batch) =>
  batchKeys(batch).some((k) => (batch.byStrategy[k]?.runs ?? 0) > 0)

/**
 * Stable entity → colour/shape identity.
 *
 * The order is the order keys were FIRST seen (canonical order among each new
 * arrival), held in a ref. So hiding a strategy never repaints the survivors,
 * and a strategy that streams in later appends rather than reshuffling.
 */
export function useSeries(batch, hidden) {
  const seenRef = useRef([])
  const keys = batchKeys(batch)
  const keysKey = keys.join('|')

  const ordered = useMemo(() => {
    const seen = seenRef.current
    const fresh = keys
      .filter((k) => !seen.includes(k))
      .sort((a, b) => canonicalIndex(a) - canonicalIndex(b) || a.localeCompare(b))
    if (fresh.length) seenRef.current = [...seen, ...fresh]
    return seenRef.current.filter((k) => keys.includes(k))
  }, [keysKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => {
    const all = ordered.map((key, i) => {
      const entry = batch?.byStrategy?.[key]
      const overflow = i >= MAX_SERIES
      return {
        key,
        index: i,
        label: strategyName(key, entry),
        color: overflow ? 'var(--text-3)' : seriesColor(i),
        shape: seriesShape(i),
        overflow,
        entry,
        runs: entry?.runs ?? 0,
        hidden: hidden?.has(key) ?? false,
      }
    })
    return {
      all,
      visible: all.filter((s) => !s.hidden),
      overflowCount: all.filter((s) => s.overflow).length,
    }
  }, [ordered, batch, hidden])
}

/** Legend descriptors for a series list. */
export const legendItems = (list, kind = 'rect') =>
  list.map((s) => ({ key: s.key, label: s.label, color: s.color, shape: s.shape, kind }))

/** Total replications completed across the batch. */
export const totalRuns = (batch) =>
  batchKeys(batch).reduce((acc, k) => acc + (batch.byStrategy[k]?.runs ?? 0), 0)

/** Shared "n runs" subtitle fragment. */
export function runsLabel(batch, series) {
  const list = series ?? []
  if (list.length === 0) return 'no runs yet'
  const counts = list.map((s) => s.runs ?? 0)
  const min = Math.min(...counts)
  const max = Math.max(...counts)
  const requested = batch?.meta?.runsRequested
  const body = min === max ? `${max} run${max === 1 ? '' : 's'}` : `${min}–${max} runs`
  return requested && max < requested ? `${body} of ${requested}` : body
}

/** Passenger count for the batch, falling back to a seat-map count. */
export function paxCount(batch, entry) {
  if (Number.isFinite(batch?.meta?.paxCount)) return batch.meta.paxCount
  const curve = entry?.seatedCurveMean
  if (Array.isArray(curve) && curve.length) {
    return curve.reduce((m, p) => Math.max(m, p.seated ?? 0), 0)
  }
  return null
}

/** Parse `12A` into `{ row: 12, letter: 'A' }`. */
export function parseSeatId(id) {
  const match = /^(\d+)\s*([A-Za-z]+)$/.exec(String(id ?? ''))
  if (!match) return null
  return { row: Number(match[1]), letter: match[2].toUpperCase() }
}

/** Rows and letters present in a `seatTimeMean` map, in cabin order. */
export function seatMapShape(seatTimeMean) {
  const rows = new Set()
  const letters = new Set()
  for (const id of Object.keys(seatTimeMean ?? {})) {
    const seat = parseSeatId(id)
    if (!seat) continue
    rows.add(seat.row)
    letters.add(seat.letter)
  }
  return {
    rows: [...rows].sort((a, b) => a - b),
    letters: [...letters].sort(),
  }
}

/** Min/max over a 2-D matrix, ignoring non-finite cells. */
export function matrixExtent(matrix) {
  let min = Infinity
  let max = -Infinity
  for (const row of matrix ?? []) {
    for (const v of row ?? []) {
      if (!Number.isFinite(v)) continue
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  return Number.isFinite(min) ? [min, max] : [0, 0]
}

/** Sort a series list by mean boarding time, fastest first. */
export const byMeanAsc = (list) =>
  [...list].sort(
    (a, b) => (a.entry?.totalSeconds?.mean ?? Infinity) - (b.entry?.totalSeconds?.mean ?? Infinity),
  )

/* ---------- congestion matrix: units and row identity -------------------- */

/**
 * Fallback column spacing, seconds.
 *
 * The engine's own default (`parity/defaults.json`, `sampleInterval: 2.0`).
 * Used only when a batch predates `meta.sampleInterval`; a batch that carries
 * the field always wins, because the user can change the interval.
 */
export const DEFAULT_SAMPLE_INTERVAL = 2

/**
 * Seconds per column of `congestionMean`.
 *
 * ENGINE_SPEC §7: `congestion` is *sampled* at `sampleInterval`, so column `b`
 * is the sample taken at `b * sampleInterval` seconds — a fixed grid that has
 * nothing to do with how long the run lasted. Deriving it as
 * `totalSeconds.mean / columns` (which this layer used to do) is wrong by
 * exactly the amount the matrix was truncated by, and stretches the whole time
 * axis: on a320neo/random/0.92 that was 2.234 s per column instead of 2.0, an
 * 11.7% error in every time read-out.
 */
export function sampleIntervalOf(batch) {
  const v = Number(batch?.meta?.sampleInterval)
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_SAMPLE_INTERVAL
}

/**
 * Printed row numbers for the congestion matrix's rows.
 *
 * The matrix is indexed by **row slot** (ENGINE_SPEC §2.1): a contiguous
 * fore→aft index that is NOT the printed row number. `slot + 1` only coincides
 * with the row number on an aircraft that starts at row 1 and skips nothing —
 * on `b737_max8` (no row 13) everything aft of row 12 is off by one, and on
 * `b787_9` (rows 1-12, 20-22, 30-35, 42-57) slot 21 is row 42, not row 22.
 *
 * Accepts either `meta.rowSlots` (`[{slot, number}]`, the geometry export's own
 * shape) or a parallel `meta.rowNumbers` array of numbers.
 *
 * @returns {{numbers: (number|null)[], exact: boolean}} `exact` is false when
 *   the batch did not ship the mapping, in which case callers must label by
 *   slot rather than invent a row number.
 */
export function rowNumbersOf(batch, rowCount) {
  const n = Number.isFinite(rowCount) && rowCount > 0 ? Math.trunc(rowCount) : 0
  const numbers = new Array(n).fill(null)
  const meta = batch?.meta
  const source = Array.isArray(meta?.rowSlots)
    ? meta.rowSlots
    : Array.isArray(meta?.rowNumbers)
      ? meta.rowNumbers
      : null
  if (!source) return { numbers, exact: false }

  for (let i = 0; i < source.length; i += 1) {
    const item = source[i]
    const slot = Number.isFinite(item?.slot) ? item.slot : i
    if (slot < 0 || slot >= n) continue
    const value = Number(
      typeof item === 'number' || typeof item === 'string' ? item : item?.number ?? item?.rowNumber,
    )
    if (Number.isFinite(value)) numbers[slot] = value
  }
  return { numbers, exact: n > 0 && numbers.every((v) => v != null) }
}
