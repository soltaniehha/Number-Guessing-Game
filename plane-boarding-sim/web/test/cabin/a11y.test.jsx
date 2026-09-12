// @vitest-environment jsdom
/**
 * Accessibility regressions for the cabin view.
 *
 * The rate test is the important one. The live region used to carry the
 * running tally, which mutated 5.6 times a second at 25× — a polite queue
 * fed at that rate never drains, and the screen-reader user hears the same
 * sentence for the rest of the session. Anyone "improving" the message later
 * has to keep it on the milestone cadence.
 */
import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import CabinView from '../../src/cabin/CabinView.jsx'
import { STATE, describePassenger, replayDuration } from '../../src/cabin/playback.js'
import { makeReplay } from '../../src/cabin/__fixtures__/makeReplay.js'
import { makeStubContext } from './stubContext.js'

const THEME_CSS = readFileSync(resolve(process.cwd(), 'src/theme.css'), 'utf8')
const REPLAY = makeReplay({ aircraft: 'single', loadFactor: 0.6 })
const DURATION = replayDuration(REPLAY)

globalThis.IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  const style = document.createElement('style')
  style.textContent = THEME_CSS
  document.head.appendChild(style)

  HTMLCanvasElement.prototype.getContext = function getContext() {
    if (!this.__stub) this.__stub = makeStubContext()
    return this.__stub
  }
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback }
    observe() { this.callback([{ contentRect: { width: 1000, height: 380 } }], this) }
    disconnect() {}
  }
})

let mounted = []

function mount(element) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(element))
  const handle = {
    host,
    root,
    update: (next) => act(() => root.render(next)),
    unmount: () => { act(() => root.unmount()); host.remove() },
  }
  mounted.push(handle)
  return handle
}

afterEach(() => {
  for (const handle of mounted) {
    try { handle.unmount() } catch { /* already gone */ }
  }
  mounted = []
  vi.restoreAllMocks()
})

/** Let queued MutationObserver records and pending effects flush. */
async function settle(ms = 0) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)) })
}

function liveRegions(host) {
  return [...host.querySelectorAll('[aria-live="polite"]')]
}

function watch(node) {
  const seen = []
  const observer = new MutationObserver((records) => {
    for (const record of records) seen.push(record)
  })
  observer.observe(node, { childList: true, characterData: true, subtree: true })
  return { seen, stop: () => observer.disconnect() }
}

function watchAttribute(node, name) {
  const seen = []
  const observer = new MutationObserver((records) => {
    for (const record of records) seen.push(record)
  })
  observer.observe(node, { attributes: true, attributeFilter: [name] })
  return { seen, stop: () => observer.disconnect() }
}

describe('CabinView live regions', () => {
  it('announces milestones, not the running tally', async () => {
    const view = mount(<CabinView replay={REPLAY} tSeconds={0} />)
    await settle()

    const [announcer] = liveRegions(view.host)
    expect(announcer).toBeTruthy()
    const canvas = view.host.querySelector('.cab-view__dots')

    const live = watch(announcer)
    const label = watchAttribute(canvas, 'aria-label')

    // 120 clock ticks across the whole boarding — the old implementation
    // produced a text mutation on very nearly every one of them.
    const STEPS = 120
    for (let i = 1; i <= STEPS; i++) {
      view.update(<CabinView replay={REPLAY} tSeconds={(DURATION * i) / STEPS} />)
    }
    await settle()
    live.stop()
    label.stop()

    // start + 25% + 50% + 75% + complete = five, plus slack for a stop.
    // Measured at the time of writing: four, for a 120-tick run.
    expect(live.seen.length).toBeLessThanOrEqual(8)
    expect(live.seen.length).toBeGreaterThan(0)
    expect(label.seen.length).toBeLessThanOrEqual(8)
    expect(announcer.textContent).toMatch(/Boarding complete/)
  })

  it('keeps the precise running figures on a NON-live description', async () => {
    const view = mount(<CabinView replay={REPLAY} tSeconds={DURATION * 0.4} />)
    await settle()
    const canvas = view.host.querySelector('.cab-view__dots')
    const detail = document.getElementById(canvas.getAttribute('aria-describedby'))

    expect(detail).toBeTruthy()
    expect(detail.getAttribute('aria-live')).toBeNull()
    expect(detail.textContent).toMatch(/of \d+ seated/)
    expect(detail.textContent).toMatch(/jet-bridge queue/)
    // The figures are allowed to churn precisely because nothing announces them.
    const before = detail.textContent
    view.update(<CabinView replay={REPLAY} tSeconds={DURATION} />)
    expect(detail.textContent).not.toBe(before)
  })

  it('announces a reset and a pause', async () => {
    const view = mount(<CabinView replay={REPLAY} tSeconds={0} playing />)
    await settle()
    const [announcer] = liveRegions(view.host)

    view.update(<CabinView replay={REPLAY} tSeconds={DURATION * 0.3} playing />)
    view.update(<CabinView replay={REPLAY} tSeconds={DURATION * 0.3} playing={false} />)
    await settle()
    expect(announcer.textContent).toMatch(/paused/i)

    view.update(<CabinView replay={REPLAY} tSeconds={0} playing={false} />)
    await settle()
    expect(announcer.textContent).toMatch(/reset to the start/i)
  })

  it('falls back to a settled clock when the host does not pass `playing`', async () => {
    const view = mount(<CabinView replay={REPLAY} tSeconds={0} />)
    await settle()
    const [announcer] = liveRegions(view.host)
    view.update(<CabinView replay={REPLAY} tSeconds={DURATION * 0.3} />)
    await settle(600)
    expect(announcer.textContent).toMatch(/paused/i)
  })
})

describe('CabinView keyboard access to the dots', () => {
  it('puts the dot layer in the tab order', () => {
    const view = mount(<CabinView replay={REPLAY} tSeconds={DURATION * 0.4} />)
    const canvas = view.host.querySelector('.cab-view__dots')
    expect(canvas.getAttribute('tabindex')).toBe('0')
    expect(canvas.getAttribute('aria-label')).toContain(REPLAY.aircraft.name)
  })

  function press(canvas, key) {
    act(() => {
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    })
  }

  it('steps through passengers with the arrow keys and dismisses with Escape', () => {
    const view = mount(<CabinView replay={REPLAY} tSeconds={DURATION * 0.4} />)
    const canvas = view.host.querySelector('.cab-view__dots')

    expect(document.querySelector('.cab-tip')).toBeNull()

    press(canvas, 'ArrowRight')
    const first = document.querySelector('.cab-tip')
    expect(first, 'ArrowRight should open the read-out').not.toBeNull()
    const firstSeat = first.querySelector('.cab-tip__seat').textContent

    press(canvas, 'ArrowRight')
    const secondSeat = document.querySelector('.cab-tip__seat').textContent
    expect(secondSeat).not.toBe(firstSeat)

    press(canvas, 'ArrowLeft')
    expect(document.querySelector('.cab-tip__seat').textContent).toBe(firstSeat)

    press(canvas, 'Escape')
    expect(document.querySelector('.cab-tip')).toBeNull()
  })

  it('Escape works from anywhere while the read-out is open', () => {
    const view = mount(<CabinView replay={REPLAY} tSeconds={DURATION * 0.4} />)
    const canvas = view.host.querySelector('.cab-view__dots')
    press(canvas, 'ArrowRight')
    expect(document.querySelector('.cab-tip')).not.toBeNull()
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector('.cab-tip')).toBeNull()
  })

  it('mirrors the read-out into its own polite region, throttled', async () => {
    const view = mount(<CabinView replay={REPLAY} tSeconds={DURATION * 0.4} />)
    const canvas = view.host.querySelector('.cab-view__dots')
    const inspector = liveRegions(view.host)[1]
    expect(inspector).toBeTruthy()

    const live = watch(inspector)
    // Five quick presses, as a held arrow key would produce.
    for (let i = 0; i < 5; i++) press(canvas, 'ArrowRight')
    await settle(0)
    expect(live.seen.length, 'nothing announced until the selection settles').toBe(0)

    await settle(600)
    live.stop()
    expect(live.seen.length).toBe(1)
    expect(inspector.textContent).toMatch(/^Seat \w+/)
    expect(inspector.textContent).toMatch(/bag/)
  })
})

describe('CabinView legend', () => {
  it('renders the key in the view itself, naming colour AND shape', () => {
    const view = mount(<CabinView replay={REPLAY} tSeconds={0} />)
    const legend = view.host.querySelector('.cab-legend')
    expect(legend, 'the cabin must ship its own legend').not.toBeNull()
    const text = legend.textContent
    for (const word of ['Queued', 'Walking', 'Stowing', 'Seated']) expect(text).toContain(word)
    for (const word of ['red', 'blue', 'amber', 'green']) expect(text).toContain(word)
    for (const shape of ['hollow ring', 'dot with a trail', 'dot inside a ring', 'solid dot']) {
      expect(text).toContain(shape)
    }
    expect(text).toMatch(/shape as well as a colour/i)
  })

  it('can be suppressed for hosts that draw their own', () => {
    const view = mount(<CabinView replay={REPLAY} tSeconds={0} showLegend={false} />)
    expect(view.host.querySelector('.cab-legend')).toBeNull()
  })
})

describe('describePassenger', () => {
  it('says everything the tooltip says, as one sentence', () => {
    const text = describePassenger(REPLAY, 0, 42, STATE.WALKING)
    const pax = REPLAY.passengers[0]
    expect(text).toContain(`Seat ${pax.seatRow}${pax.seatLetter}`)
    expect(text).toContain('Walking')
    expect(text).toMatch(/party of \d+|travelling solo/)
    expect(text).toMatch(/\d+ bags?/)
    expect(text.endsWith('.')).toBe(true)
  })

  it('is empty for no passenger', () => {
    expect(describePassenger(REPLAY, -1, 0)).toBe('')
    expect(describePassenger(null, 0, 0)).toBe('')
  })
})
