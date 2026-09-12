import { describe, it, expect } from 'vitest'
import {
  linearScale,
  bandScale,
  timeScale,
  extent,
  clamp,
  cappedBand,
  bandInset,
} from '../../src/charts/primitives/scales.js'

describe('linearScale', () => {
  const x = linearScale({ domain: [0, 100], range: [0, 500] })

  it('maps domain to range linearly', () => {
    expect(x(0)).toBe(0)
    expect(x(50)).toBe(250)
    expect(x(100)).toBe(500)
  })

  it('extrapolates unless clamped', () => {
    expect(x(150)).toBe(750)
    const clamped = linearScale({ domain: [0, 100], range: [0, 500], clamp: true })
    expect(clamped(150)).toBe(500)
    expect(clamped(-20)).toBe(0)
  })

  it('inverts', () => {
    expect(x.invert(250)).toBe(50)
    expect(x.invert(x(37))).toBeCloseTo(37, 10)
  })

  it('supports an inverted range (screen y grows downward)', () => {
    const y = linearScale({ domain: [0, 100], range: [300, 0] })
    expect(y(0)).toBe(300)
    expect(y(100)).toBe(0)
    expect(y(50)).toBe(150)
  })

  it('does not divide by zero on a flat domain', () => {
    const flat = linearScale({ domain: [7, 7], range: [0, 100] })
    expect(Number.isFinite(flat(7))).toBe(true)
    expect(flat(7)).toBe(50)
  })

  it('returns NaN for non-numeric input rather than a bogus pixel', () => {
    expect(Number.isNaN(x(undefined))).toBe(true)
  })

  it('can nice its own domain', () => {
    const niced = linearScale({ domain: [3, 97], range: [0, 1], nice: true })
    expect(niced.domain()).toEqual([0, 100])
  })
})

describe('timeScale', () => {
  it('shares linear arithmetic but uses clock ticks', () => {
    const t = timeScale({ domain: [0, 600], range: [0, 300] })
    expect(t(300)).toBe(150)
    const ticks = t.ticks(5)
    expect(ticks).toContain(0)
    expect(ticks.every((v) => v % 60 === 0 || v % 30 === 0)).toBe(true)
  })
})

describe('bandScale', () => {
  const b = bandScale({ domain: ['a', 'b', 'c'], range: [0, 300], padding: 0.2 })

  it('places bands in order without overlap', () => {
    expect(b('a')).toBeLessThan(b('b'))
    expect(b('b')).toBeLessThan(b('c'))
    expect(b('a') + b.bandwidth()).toBeLessThanOrEqual(b('b') + 1e-9)
  })

  it('fits inside the range', () => {
    expect(b('a')).toBeGreaterThanOrEqual(0)
    expect(b('c') + b.bandwidth()).toBeLessThanOrEqual(300 + 1e-9)
  })

  it('leaves padding as air between bands', () => {
    expect(b.bandwidth()).toBeLessThan(b.step())
    expect(b.bandwidth()).toBeCloseTo(b.step() * 0.8, 8)
  })

  it('centres and inverts', () => {
    expect(b.center('b')).toBeCloseTo(b('b') + b.bandwidth() / 2, 10)
    expect(b.invert(b.center('c'))).toBe('c')
  })

  it('returns NaN for unknown keys', () => {
    expect(Number.isNaN(b('zzz'))).toBe(true)
  })

  it('survives an empty domain', () => {
    const none = bandScale({ domain: [], range: [0, 100] })
    expect(Number.isFinite(none.bandwidth())).toBe(true)
  })
})

describe('bar thickness caps', () => {
  it('caps thick bands at 24px and keeps them centred', () => {
    expect(cappedBand(60, 24)).toBe(24)
    expect(bandInset(60, 24)).toBe(18)
  })

  it('leaves thin bands alone', () => {
    expect(cappedBand(9, 24)).toBe(9)
    expect(bandInset(9, 24)).toBe(0)
  })
})

describe('helpers', () => {
  it('computes extents through an accessor and ignores rubbish', () => {
    expect(extent([{ v: 3 }, { v: 9 }, { v: null }], (d) => d.v)).toEqual([3, 9])
    expect(extent([])).toEqual([0, 0])
  })

  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-5, 0, 3)).toBe(0)
    expect(clamp(2, 0, 3)).toBe(2)
  })
})
