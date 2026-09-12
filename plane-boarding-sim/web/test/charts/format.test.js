import { describe, it, expect } from 'vitest'
import {
  formatDuration,
  formatDurationLong,
  formatDurationTick,
  formatNumber,
  formatTick,
  formatPercent,
  formatPercentValue,
  formatSignedDuration,
} from '../../src/charts/primitives/format.js'

describe('formatDuration (m:ss)', () => {
  it('formats the canonical example', () => {
    expect(formatDuration(432)).toBe('7:12')
  })

  it('never emits raw seconds and always pads', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(9)).toBe('0:09')
    expect(formatDuration(60)).toBe('1:00')
    expect(formatDuration(599)).toBe('9:59')
  })

  it('rolls over into hours', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(3782)).toBe('1:03:02')
  })

  it('rounds to the nearest second', () => {
    expect(formatDuration(431.6)).toBe('7:12')
    expect(formatDuration(431.4)).toBe('7:11')
  })

  it('handles negatives and rubbish safely', () => {
    expect(formatDuration(-75)).toBe('-1:15')
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(undefined)).toBe('—')
    expect(formatDuration(Number.NaN)).toBe('—')
    expect(formatDuration(Infinity)).toBe('—')
  })
})

describe('formatDurationLong', () => {
  it('uses the 7m 12s form', () => {
    expect(formatDurationLong(432)).toBe('7m 12s')
  })

  it('drops empty units', () => {
    expect(formatDurationLong(48)).toBe('48s')
    expect(formatDurationLong(120)).toBe('2m')
    expect(formatDurationLong(3782)).toBe('1h 3m')
  })
})

describe('formatDurationTick', () => {
  it('collapses whole minutes for axis labels', () => {
    expect(formatDurationTick(0)).toBe('0')
    expect(formatDurationTick(120)).toBe('2m')
    expect(formatDurationTick(3600)).toBe('1h')
    expect(formatDurationTick(150)).toBe('2:30')
  })
})

describe('number formatters', () => {
  it('formats counts with separators', () => {
    expect(formatNumber(1234)).toBe('1,234')
    expect(formatNumber(1234.567, 2)).toBe('1,234.57')
    expect(formatNumber(null)).toBe('—')
  })

  it('compacts axis ticks', () => {
    expect(formatTick(1000)).toBe('1k')
    expect(formatTick(1500)).toBe('1.5k')
    expect(formatTick(42)).toBe('42')
    expect(formatTick(4.25)).toBe('4.3')
  })

  it('formats percentages both ways', () => {
    expect(formatPercent(0.873)).toBe('87%')
    expect(formatPercentValue(87.3, 1)).toBe('87.3%')
  })

  it('signs deltas', () => {
    expect(formatSignedDuration(90)).toBe('+1m 30s')
    expect(formatSignedDuration(-90)).toBe('−1m 30s')
  })
})
