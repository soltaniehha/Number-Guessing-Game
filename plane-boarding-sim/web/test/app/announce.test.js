/**
 * `aria-valuetext` is read out literally, so every slider needs a spoken
 * formatter that is not just its visual one. See controlSchema.js.
 */
import { describe, expect, it } from 'vitest'
import { CONTROLS } from '../../src/app/controlSchema.js'

const byKey = (key) => CONTROLS.find((c) => c.key === key)

describe('slider announce formatters', () => {
  it('every slider that has a visual format also has a spoken one', () => {
    const sliders = CONTROLS.filter((c) => c.kind === 'slider' || c.kind === 'nullable-slider')
    expect(sliders.length).toBeGreaterThan(20)
    for (const c of sliders) {
      expect(typeof c.announce, `${c.key} has no announce formatter`).toBe('function')
    }
  })

  it('never leaves a bare letter where a unit should be spoken', () => {
    for (const c of CONTROLS) {
      if (typeof c.announce !== 'function') continue
      const mid = c.min != null && c.max != null ? (c.min + c.max) / 2 : 1
      const said = c.announce(mid)
      expect(said, `${c.key}`).not.toMatch(/\ds\b/) // "16.0s"
      expect(said, `${c.key}`).not.toMatch(/^[\d.\s±]+$/) // a naked number
    }
  })

  it('spells out seconds instead of the letter s', () => {
    expect(byKey('stowWeibullScale').format(16)).toBe('16.0s')
    expect(byKey('stowWeibullScale').announce(16)).toBe('16 seconds')
    expect(byKey('shuffleMoveMode').announce(2.4)).toBe('2.4 seconds')
    expect(byKey('dt').announce(0.05)).toBe('0.05 seconds')
    expect(byKey('gateScanMean').announce(1)).toBe('1 second')
  })

  it('gives counted values the thing they count', () => {
    expect(byKey('shuffleMovements.both').format(9)).toBe('9')
    expect(byKey('shuffleMovements.both').announce(9)).toBe('9 movements')
    expect(byKey('shuffleMovements.none').announce(1)).toBe('1 movement')
    expect(byKey('binBagsPerRowSide').announce(4)).toBe('4 bags')
    expect(byKey('binBagsPerRowSide').announce(1)).toBe('1 bag')
    expect(byKey('zoneCount').announce(4)).toBe('4 zones')
    expect(byKey('runs').announce(200)).toBe('200 replications')
  })

  it('gives the dimensionless fixed2 sliders something to be a number of', () => {
    for (const key of ['stowWeibullShape', 'stowVariability', 'walkSpeedSd']) {
      const said = byKey(key).announce(0.28)
      expect(said, key).toMatch(/^0\.28 \S/)
      expect(said.split(' ').length, key).toBeGreaterThan(1)
    }
    expect(byKey('walkSpeedSd').announce(0.15)).toBe('0.15 metres per second of spread')
    expect(byKey('stowVariability').announce(0.28)).toBe('0.28 of the mean, per person')
    expect(byKey('stowWeibullShape').announce(1.7)).toBe('1.70 Weibull shape')
  })

  it('says "percent" and "plus or minus" rather than punctuation', () => {
    expect(byKey('loadFactor').announce(0.92)).toBe('92 percent')
    expect(byKey('complianceJitter').announce(6)).toBe('plus or minus 6 queue places')
    expect(byKey('complianceJitter').announce(1)).toBe('plus or minus 1 queue place')
  })
})
