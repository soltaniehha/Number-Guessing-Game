// @vitest-environment jsdom
/**
 * Chart 7 plots whichever parameter the batch swept.
 *
 * The engine's `SWEEPABLE` list has eight axes and the panel offers all of
 * them, but the chart used to read every point as a load factor: a zone-count
 * sweep of 2-6 zones came out as "200% … 600% full" under a card titled
 * "Load-factor sweep". The data was right, which is what made it dangerous.
 *
 * Also here: the two small n = 1 / one-strategy wording defects, because both
 * are the same failure — printing a shape the data does not have.
 */
import { afterEach, beforeAll, describe, it, expect } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { ParameterSweep, sweepAxisCopy } from '../../src/charts/ParameterSweep.jsx'
import { Convergence } from '../../src/charts/Convergence.jsx'
import { ChartGrid } from '../../src/charts/ChartGrid.jsx'
import { makeBatch } from '../../src/charts/__fixtures__/makeBatch.js'
import { installCanvasStub } from './stubCanvas.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted = []
function render(ui) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(ui))
  mounted.push({ container, root })
  return container
}
function click(el) {
  act(() => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })))
}
beforeAll(() => installCanvasStub())
afterEach(() => {
  while (mounted.length) {
    const handle = mounted.pop()
    act(() => handle.root.unmount())
    handle.container.remove()
  }
})

const base = makeBatch({ runs: 6, strategies: ['wilma', 'random'], sweep: false })

/** A batch carrying a sweep of `param` over `values`. */
const swept = (param, values) => ({
  ...base,
  sweep: {
    param,
    values: [...values],
    loadFactors: [...values],
    byStrategy: {
      wilma: values.map((_, i) => 900 - i * 8),
      random: values.map((_, i) => 1000 - i * 6),
    },
  },
})

const texts = (container) =>
  [...container.querySelectorAll('svg[role="img"] text')].map((t) => t.textContent)
const aria = (container) => container.querySelector('svg[role="img"]').getAttribute('aria-label')
const headers = (container) => {
  click(container.querySelector('.ch-tablebtn'))
  return [...container.querySelectorAll('table.ch-table thead th')].map((th) => th.textContent)
}

describe('the swept parameter drives every label', () => {
  it('plots a zone-count sweep as zones, not percentages', () => {
    const container = render(<ParameterSweep batch={swept('zoneCount', [2, 3, 4, 5, 6])} hidden={new Set()} />)
    expect(container.querySelector('.ch-title').textContent).toBe('Parameter sweep')
    expect(container.querySelector('.ch-sub').textContent).toContain('Zone count')
    const t = texts(container)
    expect(t).toContain('Number of boarding zones')
    expect(t).toContain('2')
    expect(t).toContain('6')
    expect(t.join(' ')).not.toMatch(/%/)
    expect(t).not.toContain('Load factor (% of seats sold)')
    expect(aria(container)).toContain('against zone count')
    expect(aria(container)).toContain('from 2 to 6')
    expect(headers(container)).toEqual(['Strategy', '2', '3', '4', '5', '6'])
  })

  it('still writes a load-factor sweep as percentages', () => {
    const container = render(<ParameterSweep batch={swept('loadFactor', [0.5, 0.75, 1])} hidden={new Set()} />)
    expect(container.querySelector('.ch-sub').textContent).toContain('Load factor')
    const t = texts(container)
    expect(t).toContain('Load factor (% of seats sold)')
    expect(t).toContain('50%')
    expect(t).toContain('100%')
    expect(aria(container)).toContain('from 50% to 100%')
    expect(headers(container)).toEqual(['Strategy', '50%', '75%', '100%'])
  })

  it('writes fractional axes as decimals rather than percentages', () => {
    const container = render(<ParameterSweep batch={swept('stowPassSpeedFactor', [0, 0.2, 0.4, 0.6])} hidden={new Set()} />)
    const t = texts(container)
    expect(t).toContain('0.2')
    expect(t.join(' ')).not.toMatch(/20%/)
    const bias = render(<ParameterSweep batch={swept('eliteForwardBias', [0, 0.5, 1])} hidden={new Set()} />)
    expect(texts(bias)).toContain('0.5')
    expect(texts(bias).join(' ')).not.toMatch(/50%/)
  })

  it('falls back to a plain numeric axis for a parameter it has never heard of', () => {
    const copy = sweepAxisCopy('someNewKnob')
    expect(copy.name).toBe('Some New Knob')
    expect(copy.format(0.5)).toBe('0.5')
    const container = render(<ParameterSweep batch={swept('someNewKnob', [1, 2, 3])} hidden={new Set()} />)
    expect(texts(container).join(' ')).not.toMatch(/%/)
    expect(aria(container)).toContain('some new knob')
  })

  it('reads the general `values` list, and the legacy `loadFactors` alias', () => {
    const legacy = {
      ...base,
      sweep: {
        param: 'loadFactor',
        loadFactors: [0.6, 0.8, 1],
        byStrategy: { wilma: [880, 900, 940], random: [980, 1000, 1040] },
      },
    }
    expect(texts(render(<ParameterSweep batch={legacy} hidden={new Set()} />))).toContain('60%')
  })

  it('explains itself when the batch has no sweep at all', () => {
    const container = render(<ParameterSweep batch={base} hidden={new Set()} />)
    const empty = container.querySelector('.ch-empty')
    expect(empty.textContent).toMatch(/No parameter sweep/)
    expect(empty.textContent).not.toMatch(/load-factor sweep/i)
  })
})

describe('counts are written with the plural they have', () => {
  it('says "1 strategy" in the grid status line', () => {
    const one = makeBatch({ runs: 5, strategies: ['wilma'], sweep: false })
    const container = render(<ChartGrid batch={one} />)
    const status = [...container.querySelectorAll('.cg-status')]
      .map((el) => el.textContent)
      .find((t) => t.includes('replications'))
    expect(status).toContain('across 1 strategy.')
    expect(status).not.toContain('1 strategies')
  })

  it('says "1 replication" on the convergence chart, and draws one x tick', () => {
    const one = makeBatch({ runs: 1, strategies: ['wilma'], sweep: false })
    const container = render(<Convergence batch={one} hidden={new Set()} />)
    expect(container.querySelector('.ch-sub').textContent).toContain('up to 1 replication')
    expect(container.querySelector('.ch-sub').textContent).not.toContain('1 replications')
    expect(aria(container)).not.toContain('1 replications')
    const ticks = texts(container).filter((t) => /^\d+$/.test(t))
    expect(ticks).toEqual(['1'])
  })

  it('keeps whole-number x ticks as replications accumulate', () => {
    for (const runs of [2, 3, 5, 9, 40]) {
      const container = render(<Convergence batch={makeBatch({ runs, strategies: ['wilma'], sweep: false })} hidden={new Set()} />)
      const ticks = texts(container).filter((t) => /^[\d,]+$/.test(t))
      expect(new Set(ticks).size, `runs=${runs}`).toBe(ticks.length)
      for (const t of ticks) expect(Number(t.replace(',', '')), `runs=${runs}`).toBeLessThanOrEqual(runs)
    }
  })
})
