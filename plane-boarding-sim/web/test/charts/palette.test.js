import { describe, it, expect } from 'vitest'
import {
  SERIES_SLOT_ORDER,
  MAX_SERIES,
  ALL_PAIRS_SAFE,
  seriesColor,
  seriesShape,
  heatColor,
  heatLevel,
  heatBins,
  assignSeries,
  shapePath,
  HEAT_STEPS,
  ACTIVITY_SERIES,
  INTERFERENCE_SERIES,
  ORDINAL_STEPS_3,
  ORDINAL_STEPS_4,
} from '../../src/charts/primitives/palette.js'

describe('categorical slots', () => {
  it('is the validated eleven-slot order with no repeats', () => {
    expect(SERIES_SLOT_ORDER).toEqual([1, 2, 8, 7, 6, 5, 4, 3, 10, 11, 12])
    expect(new Set(SERIES_SLOT_ORDER).size).toBe(SERIES_SLOT_ORDER.length)
    expect(MAX_SERIES).toBe(11)
    expect(ALL_PAIRS_SAFE).toBe(3)
  })

  it('emits theme tokens, never literal colours', () => {
    for (let i = 0; i < MAX_SERIES; i++) {
      expect(seriesColor(i)).toMatch(/^var\(--series-\d+\)$/)
    }
  })

  it('folds past the cap into the muted token instead of inventing a hue', () => {
    expect(seriesColor(MAX_SERIES)).toBe('var(--text-3)')
    expect(seriesColor(-1)).toBe('var(--text-3)')
  })

  it('gives every slot a marker shape as secondary encoding', () => {
    const shapes = new Set()
    for (let i = 0; i < MAX_SERIES; i++) shapes.add(seriesShape(i))
    expect(shapes.size).toBeGreaterThanOrEqual(6)
  })
})

describe('assignSeries', () => {
  const keys = ['wilma', 'random', 'steffen_modified']

  it('maps each entity to a stable slot', () => {
    const map = assignSeries(keys)
    expect(map.get('wilma').color).toBe(seriesColor(0))
    expect(map.get('steffen_modified').color).toBe(seriesColor(2))
  })

  it('does not repaint survivors when the list shrinks from the end', () => {
    const before = assignSeries(keys)
    const after = assignSeries(keys.slice(0, 2))
    expect(after.get('wilma').color).toBe(before.get('wilma').color)
    expect(after.get('random').color).toBe(before.get('random').color)
  })

  it('marks overflow beyond the cap', () => {
    const many = Array.from({ length: MAX_SERIES + 2 }, (_, i) => `s${i}`)
    const map = assignSeries(many)
    expect(map.get(`s${MAX_SERIES}`).overflow).toBe(true)
    expect(map.get(`s${MAX_SERIES}`).color).toBe('var(--text-3)')
    expect(map.get('s0').overflow).toBe(false)
  })
})

describe('heat ramp', () => {
  it('has six steps and emits tokens', () => {
    expect(HEAT_STEPS).toBe(6)
    expect(heatColor(0)).toBe('var(--heat-0)')
    expect(heatColor(5)).toBe('var(--heat-5)')
  })

  it('clamps out-of-range levels', () => {
    expect(heatColor(-4)).toBe('var(--heat-0)')
    expect(heatColor(99)).toBe('var(--heat-5)')
  })

  it('buckets values across the extent, endpoints included', () => {
    expect(heatLevel(0, 0, 60)).toBe(0)
    expect(heatLevel(59.9, 0, 60)).toBe(5)
    expect(heatLevel(60, 0, 60)).toBe(5)
    expect(heatLevel(30, 0, 60)).toBe(3)
  })

  it('degenerates to step 0 on a flat range and null on rubbish', () => {
    expect(heatLevel(5, 5, 5)).toBe(0)
    expect(heatLevel(null, 0, 10)).toBeNull()
  })

  it('describes bin edges for the scale legend', () => {
    const bins = heatBins(0, 60)
    expect(bins).toHaveLength(6)
    expect(bins[0].x0).toBe(0)
    expect(bins[5].x1).toBe(60)
  })
})

describe('ordinal ramps and the activity stack', () => {
  it('keeps the validated opacity steps monotone', () => {
    for (const steps of [ORDINAL_STEPS_3, ORDINAL_STEPS_4]) {
      for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1])
      expect(steps[steps.length - 1]).toBe(1)
    }
  })

  it('orders interference by severity', () => {
    expect(INTERFERENCE_SERIES.map((s) => s.key)).toEqual(['none', 'sameParty', 'one', 'two'])
  })

  it('paints activities with cabin state tokens', () => {
    expect(ACTIVITY_SERIES.map((a) => a.key)).toEqual(['walk', 'stow', 'shuffle', 'blocked'])
    for (const a of ACTIVITY_SERIES) expect(a.color).toMatch(/^var\(--/)
  })
})

describe('shapePath', () => {
  it('produces a closed path for every shape', () => {
    for (const shape of ['circle', 'square', 'triangle', 'diamond', 'pentagon', 'cross', 'nonsense']) {
      const d = shapePath(shape, 10, 10, 5)
      expect(d.startsWith('M')).toBe(true)
      expect(d.endsWith('Z')).toBe(true)
      expect(d).not.toMatch(/NaN/)
    }
  })
})
