// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

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
import { makeBatch } from '../../src/charts/__fixtures__/makeBatch.js'

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

const batch = makeBatch({ runs: 30 })
let observedWidth = 640
const mounted = []

/** Report a chosen element width to every chart, the way a real browser would. */
class StubResizeObserver {
  constructor(callback) { this.callback = callback }
  observe() { this.callback([{ contentRect: { width: observedWidth, height: 300 } }]) }
  unobserve() {}
  disconnect() {}
}

function renderAt(width, ui) {
  observedWidth = width
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(ui))
  mounted.push({ container, root })
  return container
}

/** Rough advance width of a label at the sizes this layer uses. */
const textWidth = (el) => (el.textContent ?? '').length * 6.6

function geometry(container) {
  const svg = container.querySelector('svg[role="img"]')
  if (!svg) return null
  const [, , vbWidth, vbHeight] = svg.getAttribute('viewBox').split(/\s+/).map(Number)
  const group = svg.querySelector('g[transform]')
  const [, mx, my] = /translate\(([-\d.]+),([-\d.]+)\)/.exec(group.getAttribute('transform')).map(Number)
  return { svg, vbWidth, vbHeight, marginLeft: mx, marginTop: my }
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver = StubResizeObserver
})

afterEach(() => {
  while (mounted.length) {
    const handle = mounted.pop()
    act(() => handle.root.unmount())
    handle.container.remove()
  }
})

describe.each([[400], [1400]])('legibility at %ipx', (width) => {
  it.each(CHARTS)('%s fills the measured width exactly', (name, Component) => {
    const Chart = Component
    const container = renderAt(width, <Chart batch={batch} hidden={new Set()} />)
    const geo = geometry(container)
    expect(geo, `${name} should draw`).not.toBeNull()
    expect(geo.vbWidth).toBe(width)
  })

  it.each(CHARTS)('%s keeps every label inside the frame', (name, Component) => {
    const Chart = Component
    const container = renderAt(width, <Chart batch={batch} hidden={new Set()} />)
    const geo = geometry(container)
    const overflowing = []
    for (const text of geo.svg.querySelectorAll('text')) {
      if (text.closest('title, desc')) continue
      const raw = text.getAttribute('x')
      const transform = text.getAttribute('transform')
      if (raw == null && !transform) continue
      // rotated axis titles are placed by transform; measure their origin only
      const localX = transform
        ? Number(/translate\(([-\d.]+)/.exec(transform)?.[1] ?? 0)
        : Number(raw)
      const anchor = text.getAttribute('text-anchor') ?? 'start'
      const w = transform ? 0 : textWidth(text)
      const absolute = geo.marginLeft + localX
      const left = anchor === 'end' ? absolute - w : anchor === 'middle' ? absolute - w / 2 : absolute
      const right = anchor === 'end' ? absolute : anchor === 'middle' ? absolute + w / 2 : absolute + w
      if (left < -1 || right > geo.vbWidth + 1) {
        overflowing.push(`${text.textContent} [${left.toFixed(0)}..${right.toFixed(0)}] of ${geo.vbWidth}`)
      }
    }
    expect(overflowing, `${name} at ${width}px`).toEqual([])
  })

  it.each(CHARTS)('%s draws no negative or non-finite geometry', (name, Component) => {
    const Chart = Component
    const container = renderAt(width, <Chart batch={batch} hidden={new Set()} />)
    const geo = geometry(container)
    for (const rect of geo.svg.querySelectorAll('rect')) {
      expect(Number(rect.getAttribute('width')), name).toBeGreaterThanOrEqual(0)
      expect(Number(rect.getAttribute('height')), name).toBeGreaterThanOrEqual(0)
    }
    for (const path of geo.svg.querySelectorAll('path')) {
      expect(path.getAttribute('d') ?? '', name).not.toMatch(/NaN|Infinity/)
    }
  })

  it.each(CHARTS)('%s leaves room for its x-axis band inside the svg height', (name, Component) => {
    const Chart = Component
    const container = renderAt(width, <Chart batch={batch} hidden={new Set()} />)
    const geo = geometry(container)
    let lowest = 0
    for (const text of geo.svg.querySelectorAll('text')) {
      const y = Number(text.getAttribute('y'))
      if (Number.isFinite(y)) lowest = Math.max(lowest, geo.marginTop + y)
    }
    expect(lowest, `${name} at ${width}px`).toBeLessThanOrEqual(geo.vbHeight)
  })
})
