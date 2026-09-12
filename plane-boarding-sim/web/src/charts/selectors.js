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
