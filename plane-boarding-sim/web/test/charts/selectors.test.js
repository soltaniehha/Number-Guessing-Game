import { describe, it, expect } from 'vitest'
import {
  strategyName,
  batchKeys,
  hasAnyRuns,
  totalRuns,
  runsLabel,
  paxCount,
  parseSeatId,
  seatMapShape,
  matrixExtent,
  byMeanAsc,
  CANONICAL_STRATEGY_ORDER,
} from '../../src/charts/selectors.js'
import { makeBatch, makeEmptyBatch } from '../../src/charts/__fixtures__/makeBatch.js'

const batch = makeBatch({ runs: 12 })

describe('batch accessors', () => {
  it('reads keys and run totals', () => {
    expect(batchKeys(batch)).toHaveLength(6)
    expect(batchKeys(null)).toEqual([])
    expect(hasAnyRuns(batch)).toBe(true)
    expect(hasAnyRuns(makeEmptyBatch())).toBe(false)
    expect(totalRuns(batch)).toBe(72)
  })

  it('names strategies from the entry, then the canonical table, then the key', () => {
    expect(strategyName('wilma', { name: 'Custom' })).toBe('Custom')
    expect(strategyName('steffen_perfect')).toBe('Steffen (perfect)')
    expect(strategyName('made_up')).toBe('made_up')
    expect(CANONICAL_STRATEGY_ORDER).toContain('common_sense_5tier')
  })

  it('summarises run counts, flagging uneven progress', () => {
    const series = batchKeys(batch).map((k) => ({ runs: batch.byStrategy[k].runs }))
    expect(runsLabel(batch, series)).toContain('12 runs')
    expect(runsLabel(batch, [{ runs: 3 }, { runs: 9 }])).toContain('3–9 runs')
    expect(runsLabel(batch, [])).toBe('no runs yet')
  })

  it('finds the passenger count', () => {
    expect(paxCount(batch)).toBe(171)
    expect(paxCount({}, batch.byStrategy.wilma)).toBe(171)
  })
})

describe('seat ids', () => {
  it('parses row and letter', () => {
    expect(parseSeatId('12A')).toEqual({ row: 12, letter: 'A' })
    expect(parseSeatId('7 f')).toEqual({ row: 7, letter: 'F' })
    expect(parseSeatId('nope')).toBeNull()
    expect(parseSeatId(null)).toBeNull()
  })

  it('derives the cabin shape from a seat-time map', () => {
    const shape = seatMapShape(batch.byStrategy.wilma.seatTimeMean)
    expect(shape.rows[0]).toBe(1)
    expect(shape.rows).toHaveLength(30)
    expect(shape.letters).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })
})

describe('matrix and ordering helpers', () => {
  it('finds a matrix extent, ignoring holes', () => {
    expect(matrixExtent([[1, 2], [null, 5]])).toEqual([1, 5])
    expect(matrixExtent([])).toEqual([0, 0])
  })

  it('sorts fastest first and puts unknown means last', () => {
    const list = [
      { key: 'slow', entry: { totalSeconds: { mean: 900 } } },
      { key: 'unknown', entry: {} },
      { key: 'fast', entry: { totalSeconds: { mean: 700 } } },
    ]
    expect(byMeanAsc(list).map((s) => s.key)).toEqual(['fast', 'slow', 'unknown'])
  })
})
