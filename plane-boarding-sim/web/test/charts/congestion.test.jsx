// @vitest-environment jsdom
/**
 * The congestion heatmap's two silent-wrong-number defects, and the canvas
 * cell layer that replaced 10,000 `<rect>` nodes.
 *
 * Both defects made the chart *confidently* wrong, which is worse than blank:
 *
 * - the time axis was `totalSeconds.mean / columns` (a ratio that inherits
 *   whatever the matrix was truncated by) instead of the sample interval;
 * - row labels were `slot + 1`, which is only the printed row number on an
 *   aircraft that starts at row 1 and skips nothing.
 */
import { afterEach, beforeAll, describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { CongestionHeatmap } from '../../src/charts/CongestionHeatmap.jsx'
import { AisleThroughput } from '../../src/charts/AisleThroughput.jsx'
import { sampleIntervalOf, rowNumbersOf, DEFAULT_SAMPLE_INTERVAL } from '../../src/charts/selectors.js'
import { makeBatch, B787, A320, SAMPLE_INTERVAL, cabinRows } from '../../src/charts/__fixtures__/makeBatch.js'
import { installCanvasStub } from './stubCanvas.js'

const THEME_CSS = readFileSync(resolve(process.cwd(), 'src/theme.css'), 'utf8')

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
  act(() => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

/** The chart's table view, as `{ columns, rows }` of text. */
function tableOf(container) {
  click(container.querySelector('.ch-tablebtn'))
  const table = container.querySelector('table.ch-table')
  return {
    caption: table.querySelector('caption').textContent,
    columns: [...table.querySelectorAll('thead th')].map((th) => th.textContent),
    rows: [...table.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('th, td')].map((cell) => cell.textContent),
    ),
  }
}

const ariaOf = (container) => container.querySelector('svg[role="img"]').getAttribute('aria-label')

beforeAll(() => {
  const style = document.createElement('style')
  style.textContent = THEME_CSS
  document.head.appendChild(style)
  installCanvasStub()
})

afterEach(() => {
  while (mounted.length) {
    const handle = mounted.pop()
    act(() => handle.root.unmount())
    handle.container.remove()
  }
  document.documentElement.removeAttribute('data-theme')
})

/* ---------- selectors --------------------------------------------------- */

describe('congestion matrix metadata', () => {
  it('reads the sample interval from meta, falling back to the engine default', () => {
    expect(sampleIntervalOf({ meta: { sampleInterval: 5 } })).toBe(5)
    expect(sampleIntervalOf({ meta: {} })).toBe(DEFAULT_SAMPLE_INTERVAL)
    expect(sampleIntervalOf(undefined)).toBe(DEFAULT_SAMPLE_INTERVAL)
    // Junk is not an interval.
    expect(sampleIntervalOf({ meta: { sampleInterval: 0 } })).toBe(DEFAULT_SAMPLE_INTERVAL)
    expect(sampleIntervalOf({ meta: { sampleInterval: -2 } })).toBe(DEFAULT_SAMPLE_INTERVAL)
    expect(sampleIntervalOf({ meta: { sampleInterval: 'two' } })).toBe(DEFAULT_SAMPLE_INTERVAL)
  })

  it('maps row slots to printed row numbers, from either meta shape', () => {
    const rows = cabinRows(B787)
    const fromSlots = rowNumbersOf({ meta: { rowSlots: rows.map((number, slot) => ({ slot, number })) } }, rows.length)
    expect(fromSlots.exact).toBe(true)
    expect(fromSlots.numbers).toEqual(rows)
    // slot 21 is row 42 on a 787-9, not row 22
    expect(fromSlots.numbers[21]).toBe(42)

    const fromArray = rowNumbersOf({ meta: { rowNumbers: rows } }, rows.length)
    expect(fromArray.numbers).toEqual(rows)
    expect(fromArray.exact).toBe(true)
  })

  it('reports "not exact" rather than guessing when the mapping is absent or short', () => {
    expect(rowNumbersOf({ meta: {} }, 4)).toEqual({ numbers: [null, null, null, null], exact: false })
    expect(rowNumbersOf({ meta: { rowNumbers: [1, 2] } }, 4).exact).toBe(false)
    expect(rowNumbersOf(undefined, 0)).toEqual({ numbers: [], exact: false })
  })
})

/* ---------- S4: row labels are row numbers ------------------------------ */

describe('row labels come from the real row numbers', () => {
  const rows = cabinRows(B787)
  const batch = makeBatch({ runs: 6, cabin: B787, strategies: ['wilma'], sweep: false })

  it('labels every row of a cabin with gaps by its printed number', () => {
    const container = render(<CongestionHeatmap batch={batch} hidden={new Set()} />)
    const table = tableOf(container)
    expect(table.columns[0]).toBe('Row')
    expect(table.rows.map((r) => r[0])).toEqual(rows.map((n) => `Row ${n}`))
    // The specific case the old `slot + 1` label got wrong: slot 21 is row 42.
    expect(table.rows[21][0]).toBe('Row 42')
    expect(table.rows[21][0]).not.toBe('Row 22')
  })

  it('puts real row numbers on the y axis, not slot indices', () => {
    const container = render(<CongestionHeatmap batch={batch} hidden={new Set()} />)
    const svg = container.querySelector('svg[role="img"]')
    const ticks = [...svg.querySelectorAll('text.num')].map((t) => t.textContent)
    expect(ticks).toContain('1')
    expect(ticks).toContain(`${rows[rows.length - 1]}`) // 57, not 37
    expect(ticks).not.toContain(`${rows.length}`)
    expect([...svg.querySelectorAll('text')].map((t) => t.textContent)).toContain('Cabin row')
  })

  it('names the worst jam by its row number in the description', () => {
    const container = render(<CongestionHeatmap batch={batch} hidden={new Set()} />)
    const label = ariaOf(container)
    const match = /at row (\d+)/.exec(label)
    expect(match).not.toBeNull()
    expect(rows).toContain(Number(match[1]))
  })

  it('labels by SLOT rather than inventing a row number when meta has no mapping', () => {
    const stripped = { ...batch, meta: { ...batch.meta, rowSlots: undefined } }
    const container = render(<CongestionHeatmap batch={stripped} hidden={new Set()} />)
    expect(ariaOf(container)).toMatch(/row slot/)
    expect([...container.querySelectorAll('text')].map((t) => t.textContent)).toContain('Cabin row slot')
    const table = tableOf(container)
    expect(table.columns[0]).toBe('Row slot')
    expect(table.rows[21][0]).toBe('Row slot 21')
    expect(table.rows.map((r) => r[0])).not.toContain('Row 22')
  })
})

/* ---------- S3: time axis is the sample interval ------------------------ */

describe('bucket time comes from the sample interval, not a ratio', () => {
  const batch = makeBatch({ runs: 8, strategies: ['random'], sweep: false })
  const columns = batch.byStrategy.random.congestionMean[0].length

  it('does not move when the mean run length changes', () => {
    const stretched = {
      ...batch,
      byStrategy: {
        random: {
          ...batch.byStrategy.random,
          totalSeconds: { ...batch.byStrategy.random.totalSeconds, mean: batch.byStrategy.random.totalSeconds.mean * 2 },
        },
      },
    }
    const base = tableOf(render(<CongestionHeatmap batch={batch} hidden={new Set()} />))
    const after = tableOf(render(<CongestionHeatmap batch={stretched} hidden={new Set()} />))
    // "Peak at" is a time read-out; the ratio bug moved every one of them.
    expect(after.rows.map((r) => r[2])).toEqual(base.rows.map((r) => r[2]))
  })

  it('follows meta.sampleInterval when the run was sampled at a different rate', () => {
    const slow = { ...batch, meta: { ...batch.meta, sampleInterval: SAMPLE_INTERVAL * 2 } }
    const fast = tableOf(render(<CongestionHeatmap batch={batch} hidden={new Set()} />))
    const doubled = tableOf(render(<CongestionHeatmap batch={slow} hidden={new Set()} />))
    expect(doubled.caption).toContain('sampled every 4s')
    expect(fast.caption).toContain('sampled every 2s')
    // Same matrix, twice the seconds per column: peak times double.
    const secondsOf = (mmss) => {
      const parts = mmss.split(':').map(Number)
      return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1]
    }
    for (let i = 0; i < fast.rows.length; i += 1) {
      expect(secondsOf(doubled.rows[i][2])).toBe(secondsOf(fast.rows[i][2]) * 2)
    }
  })

  it('ends the time axis at columns × sample interval', () => {
    const container = render(<CongestionHeatmap batch={batch} hidden={new Set()} />)
    const svg = container.querySelector('svg[role="img"]')
    const ticks = [...svg.querySelectorAll('text')]
      .map((t) => t.textContent)
      .filter((t) => /^\d+m$|^\d+:\d\d$/.test(t))
    const last = ticks[ticks.length - 1]
    const seconds = last.endsWith('m') ? Number(last.slice(0, -1)) * 60 : NaN
    expect(seconds).toBeLessThanOrEqual(columns * SAMPLE_INTERVAL)
    expect(seconds).toBeGreaterThan(columns * SAMPLE_INTERVAL * 0.7)
  })

  it('gives the aisle-throughput chart the same clock', () => {
    const container = render(<AisleThroughput batch={batch} hidden={new Set()} />)
    const table = tableOf(container)
    expect(table.rows).toHaveLength(columns)
    expect(table.rows[0][0]).toBe('0:00')
    expect(table.rows[1][0]).toBe('0:02')
    expect(table.rows[30][0]).toBe('1:00')
  })
})

describe('a truncated matrix says so instead of cropping in silence', () => {
  const batch = makeBatch({ runs: 8, strategies: ['random'], sweep: false })

  /** Drop the tail of every row, the way averaging over the shortest run does. */
  const crop = (b, keep) => ({
    ...b,
    byStrategy: {
      random: {
        ...b.byStrategy.random,
        congestionMean: b.byStrategy.random.congestionMean.map((row) => row.slice(0, keep)),
      },
    },
  })

  it('states the covered window in the caption, the footnote and the description', () => {
    const columns = batch.byStrategy.random.congestionMean[0].length
    const container = render(<CongestionHeatmap batch={crop(batch, Math.floor(columns * 0.7))} hidden={new Set()} />)
    expect(ariaOf(container)).toMatch(/Covers the first \d+:\d\d of boarding against a mean run of \d+:\d\d/)
    expect(container.querySelector('.ch-foot').textContent).toMatch(/shortest replication/)
    expect(tableOf(container).caption).toMatch(/Covers the first/)
  })

  it('says nothing when the matrix covers the whole run', () => {
    const container = render(<CongestionHeatmap batch={batch} hidden={new Set()} />)
    expect(ariaOf(container)).not.toMatch(/Covers the first/)
    expect(container.querySelector('.ch-foot').textContent).not.toMatch(/shortest replication/)
  })
})

/* ---------- S8: the cells are pixels, not DOM nodes --------------------- */

describe('the cell layer is a canvas', () => {
  const batch = makeBatch({ runs: 6, strategies: ['random'], sweep: false })
  const matrix = batch.byStrategy.random.congestionMean
  const cells = matrix.length * matrix[0].length

  it('paints thousands of cells without thousands of nodes', () => {
    expect(cells).toBeGreaterThan(5000)
    const container = render(<CongestionHeatmap batch={batch} hidden={new Set()} />)
    const svg = container.querySelector('svg[role="img"]')
    // frame + hit layer + the axis rule's own furniture — a handful, not 10k
    expect(svg.querySelectorAll('rect').length).toBeLessThan(8)
    const canvas = container.querySelector('canvas.ch-heat-canvas')
    expect(canvas).not.toBeNull()
    expect(canvas.getContext('2d').fills.length).toBe(cells)
  })

  it('scales its backing store by devicePixelRatio', () => {
    const original = window.devicePixelRatio
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true })
    const container = render(<CongestionHeatmap batch={batch} hidden={new Set()} />)
    const canvas = container.querySelector('canvas.ch-heat-canvas')
    const cssWidth = Number.parseFloat(canvas.style.width)
    const cssHeight = Number.parseFloat(canvas.style.height)
    expect(cssWidth).toBeGreaterThan(0)
    expect(canvas.width).toBe(Math.round(cssWidth * 2))
    expect(canvas.height).toBe(Math.round(cssHeight * 2))
    Object.defineProperty(window, 'devicePixelRatio', { value: original, configurable: true })
  })

  it('re-reads the --heat-* tokens when the theme flips', async () => {
    const container = render(<CongestionHeatmap batch={batch} hidden={new Set()} />)
    const ctx = container.querySelector('canvas.ch-heat-canvas').getContext('2d')
    const light = new Set(ctx.fills.map((f) => f.style))
    expect(light.size).toBeGreaterThan(1)
    expect([...light].every((c) => /^#|^rgb/.test(c))).toBe(true)

    ctx.fills.length = 0
    // The theme watcher is a MutationObserver: its callback lands in a
    // microtask, so the flip has to be awaited.
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'dark')
      await Promise.resolve()
    })
    const dark = new Set(ctx.fills.map((f) => f.style))
    expect(dark.size).toBeGreaterThan(1)
    expect([...dark].sort()).not.toEqual([...light].sort())
  })

  it('keeps the hit layer, its keyboard entry point and the table fallback', () => {
    const container = render(<CongestionHeatmap batch={batch} hidden={new Set()} />)
    const hit = container.querySelector('.ch-hit')
    expect(hit.getAttribute('tabindex')).toBe('0')
    expect(hit.getAttribute('aria-label')).toBe(ariaOf(container))
    // React routes onFocus through the bubbling `focusin` event.
    act(() => hit.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true })))
    const tip = container.querySelector('.ch-tip')
    expect(tip.textContent).toMatch(/Worst jam — row \d+/)
    expect(container.querySelector('.ch-tablebtn')).not.toBeNull()
  })

  it('drops the canvas with the chart in the table view', () => {
    const container = render(<CongestionHeatmap batch={batch} hidden={new Set()} />)
    expect(container.querySelector('canvas.ch-heat-canvas')).not.toBeNull()
    click(container.querySelector('.ch-tablebtn'))
    expect(container.querySelector('canvas.ch-heat-canvas')).toBeNull()
  })

  it('still draws for an aircraft whose fixture has no gaps', () => {
    const plain = makeBatch({ runs: 3, cabin: A320, strategies: ['wilma'], sweep: false })
    const container = render(<CongestionHeatmap batch={plain} hidden={new Set()} />)
    expect(tableOf(container).rows.map((r) => r[0])).toEqual(cabinRows(A320).map((n) => `Row ${n}`))
  })
})
