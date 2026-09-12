// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { ChartGrid } from '../../src/charts/ChartGrid.jsx'
import { BoardingTimeByStrategy } from '../../src/charts/BoardingTimeByStrategy.jsx'
import { TimeDistribution } from '../../src/charts/TimeDistribution.jsx'
import { SeatedCurve } from '../../src/charts/SeatedCurve.jsx'
import { CongestionHeatmap } from '../../src/charts/CongestionHeatmap.jsx'
import { TimeBreakdown } from '../../src/charts/TimeBreakdown.jsx'
import { InterferenceCounts } from '../../src/charts/InterferenceCounts.jsx'
import { LoadFactorSweep } from '../../src/charts/LoadFactorSweep.jsx'
import { WaitTimeBoxes } from '../../src/charts/WaitTimeBoxes.jsx'
import { SeatPositionHeatmap } from '../../src/charts/SeatPositionHeatmap.jsx'
import { Convergence } from '../../src/charts/Convergence.jsx'
import { RiskReward } from '../../src/charts/RiskReward.jsx'
import { AisleThroughput } from '../../src/charts/AisleThroughput.jsx'

import {
  makeBatch,
  makePartialBatch,
  makeStreamingBatch,
  makeEmptyBatch,
} from '../../src/charts/__fixtures__/makeBatch.js'
import { installCanvasStub } from './stubCanvas.js'

const CHARTS = [
  ['BoardingTimeByStrategy', BoardingTimeByStrategy],
  ['TimeDistribution', TimeDistribution],
  ['SeatedCurve', SeatedCurve],
  ['CongestionHeatmap', CongestionHeatmap],
  ['TimeBreakdown', TimeBreakdown],
  ['InterferenceCounts', InterferenceCounts],
  ['LoadFactorSweep', LoadFactorSweep],
  ['WaitTimeBoxes', WaitTimeBoxes],
  ['SeatPositionHeatmap', SeatPositionHeatmap],
  ['Convergence', Convergence],
  ['RiskReward', RiskReward],
  ['AisleThroughput', AisleThroughput],
]

const mounted = []

function render(ui) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(ui))
  const handle = { container, root }
  mounted.push(handle)
  return handle
}

function rerender(handle, ui) {
  act(() => handle.root.render(ui))
}

function click(el) {
  act(() => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // jsdom has no canvas backend; the heatmap's cell layer paints on one.
  installCanvasStub()
})

afterEach(() => {
  while (mounted.length) {
    const handle = mounted.pop()
    act(() => handle.root.unmount())
    handle.container.remove()
  }
})

const full = makeBatch({ runs: 40 })
const partial = makePartialBatch()
const streaming = makeStreamingBatch()
const blank = makeEmptyBatch()

describe.each(CHARTS)('%s', (name, Component) => {
    const Chart = Component
  it('renders a full batch without throwing', () => {
    const { container } = render(<Chart batch={full} hidden={new Set()} />)
    const svg = container.querySelector('svg[role="img"]')
    expect(svg, `${name} should draw an svg for a full batch`).not.toBeNull()
    expect(svg.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(20)
    expect(container.textContent).toContain(container.querySelector('.ch-title').textContent)
  })

  it('renders a one-run partial batch without throwing', () => {
    const { container } = render(<Chart batch={partial} hidden={new Set()} />)
    expect(container.querySelector('.ch-frame')).not.toBeNull()
    expect(container.innerHTML).not.toMatch(/NaN/)
  })

  it('renders a mid-stream batch with uneven run counts', () => {
    const { container } = render(<Chart batch={streaming} hidden={new Set()} />)
    expect(container.querySelector('.ch-frame')).not.toBeNull()
    expect(container.innerHTML).not.toMatch(/NaN/)
  })

  it('shows an informative empty state before any data arrives', () => {
    const { container } = render(<Chart batch={blank} hidden={new Set()} />)
    const empty = container.querySelector('.ch-empty')
    expect(empty, `${name} should render an empty state`).not.toBeNull()
    expect(empty.textContent.length).toBeGreaterThan(40)
    expect(container.querySelector('svg[role="img"]')).toBeNull()
  })

  it('survives undefined and malformed input', () => {
    expect(() => render(<Chart batch={undefined} hidden={undefined} />)).not.toThrow()
    expect(() =>
      render(<Chart batch={{ byStrategy: { broken: { runs: 1, name: 'Broken' } } }} hidden={new Set()} />),
    ).not.toThrow()
  })

  it('says so when every strategy is filtered out', () => {
    const hidden = new Set(Object.keys(full.byStrategy))
    const { container } = render(<Chart batch={full} hidden={hidden} />)
    expect(container.querySelector('.ch-empty').textContent).toMatch(/hidden/i)
  })

  it('updates in place as replications stream in', () => {
    const handle = render(<Chart batch={partial} hidden={new Set()} />)
    expect(() => rerender(handle, <Chart batch={streaming} hidden={new Set()} />)).not.toThrow()
    expect(() => rerender(handle, <Chart batch={full} hidden={new Set()} />)).not.toThrow()
    expect(handle.container.querySelector('.ch-frame')).not.toBeNull()
  })

  it('offers a table view of the same numbers', () => {
    const { container } = render(<Chart batch={full} hidden={new Set()} />)
    const button = container.querySelector('.ch-tablebtn')
    expect(button, `${name} should offer a table view`).not.toBeNull()
    click(button)
    const table = container.querySelector('table.ch-table')
    expect(table).not.toBeNull()
    expect(table.querySelectorAll('tbody tr').length).toBeGreaterThan(0)
    expect(table.querySelectorAll('thead th').length).toBeGreaterThan(1)
  })

  it('paints only with theme tokens — no hardcoded colours', () => {
    const { container } = render(<Chart batch={full} hidden={new Set()} />)
    const html = container.innerHTML
    expect(html, `${name} must not hardcode hex colours`).not.toMatch(/(fill|stroke|background|color)\s*[:=]\s*"?#[0-9a-fA-F]{3,8}/)
    expect(html).not.toMatch(/rgba?\(/)
  })
})

describe('ChartGrid', () => {
  it('renders all twelve charts in cards', () => {
    const { container } = render(<ChartGrid batch={full} />)
    expect(container.querySelectorAll('.cg-card')).toHaveLength(12)
    expect(container.querySelectorAll('.cg-card-note')).toHaveLength(12)
    expect(container.querySelectorAll('.ch-title')).toHaveLength(12)
  })

  it('has exactly one filter row, above the charts', () => {
    const { container } = render(<ChartGrid batch={full} />)
    const bars = container.querySelectorAll('.cg-filterbar')
    expect(bars).toHaveLength(1)
    expect(container.querySelector('.cg-card .cg-filterbar')).toBeNull()
    const root = container.querySelector('.cg-root')
    expect(root.children[0]).toBe(bars[0])
  })

  it('toggles a strategy across every chart at once', () => {
    const { container } = render(<ChartGrid batch={full} />)
    const buttons = [...container.querySelectorAll('.cg-filterbar .ch-legend-item.is-button')]
    expect(buttons.length).toBe(6)
    const before = container.querySelectorAll('.ch-legend-item').length
    click(buttons[0])
    expect(buttons[0].getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelectorAll('.ch-legend-item').length).toBeLessThan(before)
    click(buttons[0])
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true')
  })

  it('narrows to the top three and back', () => {
    const { container } = render(<ChartGrid batch={full} />)
    const top3 = [...container.querySelectorAll('.cg-btn')].find((b) => b.textContent === 'Top 3 only')
    click(top3)
    const off = [...container.querySelectorAll('.cg-filterbar .ch-legend-item.is-button')]
      .filter((b) => b.getAttribute('aria-pressed') === 'false')
    expect(off).toHaveLength(3)
    const showAll = [...container.querySelectorAll('.cg-btn')].find((b) => b.textContent === 'Show all')
    click(showAll)
    expect(
      [...container.querySelectorAll('.cg-filterbar .ch-legend-item.is-button')]
        .filter((b) => b.getAttribute('aria-pressed') === 'false'),
    ).toHaveLength(0)
  })

  it('maximises a single chart to full width and restores it', () => {
    const { container } = render(<ChartGrid batch={full} />)
    const first = container.querySelector('.cg-card')
    const button = first.querySelector('.cg-btn')
    expect(first.classList.contains('is-wide')).toBe(false)
    click(button)
    expect(container.querySelector('.cg-card').classList.contains('is-wide')).toBe(true)
    expect(container.querySelectorAll('.cg-card.is-wide')).toHaveLength(1)
    click(container.querySelector('.cg-card .cg-btn'))
    expect(container.querySelectorAll('.cg-card.is-wide')).toHaveLength(0)
  })

  it('reports streaming progress on screen, and milestones in the live region', () => {
    const { container } = render(<ChartGrid batch={streaming} running />)
    // The precise running total is ordinary text: it changes several times a
    // second, so announcing it would flood the polite queue (see a11y.test).
    expect(container.querySelector('.cg-status').textContent).toMatch(/Streaming/)
    expect(container.querySelector('[role="status"]').textContent).toMatch(/Run started/)
  })

  it('renders from nothing at all', () => {
    const { container } = render(<ChartGrid batch={blank} />)
    expect(container.querySelectorAll('.cg-card')).toHaveLength(12)
    expect(container.querySelectorAll('.ch-empty').length).toBe(12)
  })

  it('grows from empty to partial to complete without remounting', () => {
    const handle = render(<ChartGrid batch={blank} />)
    rerender(handle, <ChartGrid batch={partial} running />)
    rerender(handle, <ChartGrid batch={streaming} running />)
    rerender(handle, <ChartGrid batch={full} />)
    expect(handle.container.querySelectorAll('.cg-card')).toHaveLength(12)
    expect(handle.container.querySelectorAll('.ch-empty')).toHaveLength(0)
  })
})

describe('accessibility contract', () => {
  it('gives every chart a role=img element with a summarising label', () => {
    const { container } = render(<ChartGrid batch={full} />)
    const svgs = [...container.querySelectorAll('svg[role="img"]')]
    expect(svgs).toHaveLength(12)
    for (const svg of svgs) {
      const label = svg.getAttribute('aria-label')
      expect(label.length).toBeGreaterThan(30)
      expect(svg.querySelector('title')).not.toBeNull()
      expect(svg.querySelector('desc')).not.toBeNull()
    }
  })

  it('gives every hit target a keyboard entry point', () => {
    const { container } = render(<BoardingTimeByStrategy batch={full} hidden={new Set()} />)
    const hits = [...container.querySelectorAll('.ch-hit')]
    expect(hits.length).toBeGreaterThan(0)
    for (const hit of hits) expect(hit.getAttribute('tabindex')).toBe('0')
  })

  it('keeps a legend whenever two or more series share a chart', () => {
    const { container } = render(<SeatedCurve batch={full} hidden={new Set()} />)
    expect(container.querySelectorAll('.ch-legend-item').length).toBe(6)
  })

  it('drops the legend box for a single series', () => {
    const one = makeBatch({ runs: 5, strategies: ['wilma'], sweep: false })
    const { container } = render(<SeatedCurve batch={one} hidden={new Set()} />)
    expect(container.querySelectorAll('.ch-legend-item')).toHaveLength(0)
    expect(container.querySelector('svg[role="img"]')).not.toBeNull()
  })
})
