// @vitest-environment jsdom
/**
 * The analytics grid's live region.
 *
 * A streaming batch reports progress several times a second (measured: 39
 * text mutations in 10.5 s while seven strategies ran). Pushed into a polite
 * live region that queue never drains. The rule this file defends: the live
 * region carries milestones — start, each quarter, the finish, a stop — and
 * the running total lives in ordinary, non-live text beside it.
 */
import { afterEach, describe, it, expect } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { ChartGrid, useMilestoneStatus } from '../../src/charts/ChartGrid.jsx'
import { makeBatch } from '../../src/charts/__fixtures__/makeBatch.js'
import { installCanvasStub } from './stubCanvas.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
installCanvasStub()

const mounted = []

function render(ui) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(ui))
  const handle = { container, root, update: (next) => act(() => root.render(next)) }
  mounted.push(handle)
  return handle
}

afterEach(() => {
  while (mounted.length) {
    const handle = mounted.pop()
    act(() => handle.root.unmount())
    handle.container.remove()
  }
})

function watch(node) {
  const seen = []
  const observer = new MutationObserver((records) => {
    for (const record of records) seen.push(record)
  })
  observer.observe(node, { childList: true, characterData: true, subtree: true })
  return { seen, stop: () => observer.disconnect() }
}

const flush = () => act(async () => { await Promise.resolve() })

/** A cheap clone of a batch at a different point in the run. */
function atRuns(base, runs, complete = false) {
  const byStrategy = {}
  for (const [key, entry] of Object.entries(base.byStrategy)) {
    byStrategy[key] = { ...entry, runs }
  }
  const meta = { ...base.meta, runsDone: runs * Object.keys(byStrategy).length, complete }
  return { ...base, byStrategy, meta }
}

describe('useMilestoneStatus', () => {
  function Probe(props) {
    const text = useMilestoneStatus(props)
    return <p data-testid="live">{text}</p>
  }

  const base = { strategies: 4, expected: 800, running: true, complete: false, notices: [] }

  it('says nothing before a batch exists', async () => {
    const view = render(<Probe {...base} strategies={0} expected={0} runs={0} running={false} />)
    await flush()
    expect(view.container.textContent).toBe('')
  })

  it('mutates a handful of times across a whole streaming run', async () => {
    const view = render(<Probe {...base} runs={0} />)
    await flush()
    const live = watch(view.container.querySelector('[data-testid="live"]'))

    // 200 progress reports, i.e. the real streaming cadence for a minute.
    for (let i = 1; i <= 200; i++) {
      view.update(<Probe {...base} runs={i * 4} />)
    }
    view.update(<Probe {...base} runs={800} running={false} complete />)
    await flush()
    live.stop()

    // 25% + 50% + 75% + complete. The start fired before the observer.
    expect(live.seen.length).toBeLessThanOrEqual(6)
    expect(view.container.textContent).toMatch(/Run complete/)
  })

  it('walks start → quarters → complete, in words', async () => {
    const said = []
    const view = render(<Probe {...base} runs={0} />)
    const read = () => {
      const text = view.container.textContent
      if (text && said[said.length - 1] !== text) said.push(text)
    }
    await flush()
    read()
    for (const runs of [100, 300, 500, 700]) {
      view.update(<Probe {...base} runs={runs} />)
      await flush()
      read()
    }
    view.update(<Probe {...base} runs={800} running={false} complete />)
    await flush()
    read()

    expect(said).toHaveLength(5)
    expect(said[0]).toMatch(/Run started/)
    expect(said[1]).toMatch(/quarter/i)
    expect(said[2]).toMatch(/Halfway/i)
    expect(said[3]).toMatch(/Three quarters/i)
    expect(said[4]).toMatch(/Run complete/)
  })

  it('announces a stopped run', async () => {
    const view = render(<Probe {...base} runs={0} />)
    await flush()
    view.update(<Probe {...base} runs={260} running={false} />)
    await flush()
    expect(view.container.textContent).toMatch(/Run stopped/)
  })

  it('carries the filter notices, which only change on a click', async () => {
    const view = render(<Probe {...base} runs={400} notices={['Every strategy is hidden.']} />)
    await flush()
    expect(view.container.textContent).toMatch(/Every strategy is hidden/)
  })

  it('never re-announces a quarter as the denominator grows', async () => {
    // Strategies stream in one at a time, so `requested * strategies` climbs
    // mid-run and the completed fraction can appear to go backwards.
    const view = render(<Probe {...base} strategies={1} expected={200} runs={0} />)
    await flush()
    const live = watch(view.container.querySelector('[data-testid="live"]'))
    view.update(<Probe {...base} strategies={1} expected={200} runs={60} />)   // 30% of 200
    await flush()
    view.update(<Probe {...base} strategies={7} expected={1400} runs={220} />) // 16% of 1400
    await flush()
    view.update(<Probe {...base} strategies={7} expected={1400} runs={400} />) // 29% of 1400
    await flush()
    live.stop()
    expect(live.seen.length, 'the quarter mark is announced exactly once').toBe(1)
  })
})

describe('ChartGrid status wiring', () => {
  const streaming = makeBatch({
    runs: 40,
    strategies: ['wilma', 'random'],
    sweep: false,
    complete: false,
    runsRequested: 200,
  })

  it('keeps the precise figure out of the live region', async () => {
    const view = render(<ChartGrid batch={streaming} running />)
    await flush()
    const status = view.container.querySelector('.cg-status')
    const live = view.container.querySelector('[role="status"]')

    expect(status.getAttribute('aria-live')).toBeNull()
    expect(status.getAttribute('role')).toBeNull()
    expect(status.textContent).toMatch(/Streaming — 80 replications of 200 each\./)
    expect(live).not.toBe(status)
    expect(live.className).toBe('cg-sr')
    expect(live.textContent).toMatch(/Run started/)
  })

  it('never says "replications in of"', async () => {
    const view = render(<ChartGrid batch={streaming} running />)
    await flush()
    expect(view.container.textContent).not.toMatch(/\bin of\b/)
  })

  it('mutates its live region a bounded number of times while streaming', async () => {
    const view = render(<ChartGrid batch={atRuns(streaming, 1)} running />)
    await flush()
    const live = watch(view.container.querySelector('[role="status"]'))

    for (let i = 1; i <= 24; i++) {
      view.update(<ChartGrid batch={atRuns(streaming, i * 8)} running />)
    }
    view.update(<ChartGrid batch={atRuns(streaming, 200, true)} />)
    await flush()
    live.stop()

    expect(live.seen.length).toBeLessThanOrEqual(6)
    expect(view.container.querySelector('[role="status"]').textContent).toMatch(/Run complete/)
  })
})
