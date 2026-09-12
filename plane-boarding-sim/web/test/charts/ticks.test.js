import { describe, it, expect } from 'vitest'
import { niceStep, niceTicks, niceDomain, timeStep, timeTicks, thinTicks } from '../../src/charts/primitives/ticks.js'

describe('niceStep', () => {
  it('snaps to 1 / 2 / 2.5 / 5 decades', () => {
    expect(niceStep(1)).toBe(1)
    expect(niceStep(1.4)).toBe(2)
    expect(niceStep(2.2)).toBe(2.5)
    expect(niceStep(3)).toBe(5)
    expect(niceStep(7)).toBe(10)
    expect(niceStep(140)).toBe(200)
    expect(niceStep(0.014)).toBeCloseTo(0.02, 10)
  })

  it('is safe on garbage', () => {
    expect(niceStep(0)).toBe(1)
    expect(niceStep(-3)).toBe(1)
    expect(niceStep(Number.NaN)).toBe(1)
  })
})

describe('niceTicks', () => {
  it('produces round values inside the domain', () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100])
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10])
  })

  it('never leaves the domain', () => {
    const ticks = niceTicks(3, 97, 5)
    expect(Math.min(...ticks)).toBeGreaterThanOrEqual(3)
    expect(Math.max(...ticks)).toBeLessThanOrEqual(97)
  })

  it('has no floating-point dust', () => {
    for (const t of niceTicks(0, 1, 5)) {
      expect(String(t).length).toBeLessThan(6)
    }
  })

  it('degenerates gracefully', () => {
    expect(niceTicks(5, 5)).toEqual([5])
    expect(niceTicks(Number.NaN, 1)).toEqual([])
    expect(niceTicks(10, 0, 5)).toEqual(niceTicks(0, 10, 5))
  })

  it('respects the requested count roughly', () => {
    const ticks = niceTicks(0, 873, 5)
    expect(ticks.length).toBeGreaterThanOrEqual(4)
    expect(ticks.length).toBeLessThanOrEqual(8)
  })
})

describe('niceDomain', () => {
  it('expands outward to round numbers', () => {
    expect(niceDomain(3, 97, 5)).toEqual([0, 100])
    expect(niceDomain(812, 1436, 5)).toEqual([800, 1600])
  })

  it('pads a zero-width domain', () => {
    const [lo, hi] = niceDomain(42, 42)
    expect(hi).toBeGreaterThan(lo)
  })
})

describe('time ticks', () => {
  it('picks clock-friendly steps', () => {
    expect(timeStep(600, 5)).toBe(120)
    expect(timeStep(60, 4)).toBe(15)
    expect(timeStep(7200, 4)).toBe(1800)
  })

  it('emits ticks on those steps', () => {
    const ticks = timeTicks(0, 900, 5)
    expect(ticks[0]).toBe(0)
    expect(ticks.every((t) => t % (ticks[1] - ticks[0]) === 0)).toBe(true)
    expect(Math.max(...ticks)).toBeLessThanOrEqual(900)
  })

  it('handles a degenerate span', () => {
    expect(timeTicks(10, 10)).toEqual([10])
  })
})

describe('thinTicks', () => {
  it('keeps at most the requested number of labels', () => {
    const many = Array.from({ length: 40 }, (_, i) => i)
    const thinned = thinTicks(many, 6)
    expect(thinned.length).toBeLessThanOrEqual(6)
    expect(thinned[0]).toBe(0)
  })

  it('passes short lists through untouched', () => {
    expect(thinTicks([1, 2, 3], 6)).toEqual([1, 2, 3])
  })
})
