// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import CabinView from '../../src/cabin/CabinView.jsx'
import CabinLegend from '../../src/cabin/CabinLegend.jsx'
import PlaybackControls from '../../src/cabin/PlaybackControls.jsx'
import PassengerTooltip from '../../src/cabin/PassengerTooltip.jsx'
import { usePlayback } from '../../src/cabin/usePlayback.js'
import { STATE, replayDuration } from '../../src/cabin/playback.js'
import { makeReplay, makeSplitEconomyAircraft } from '../../src/cabin/__fixtures__/makeReplay.js'
import { makeStubContext } from './stubContext.js'

const THEME_CSS = readFileSync(resolve(process.cwd(), 'src/theme.css'), 'utf8')
const REPLAY = makeReplay({ aircraft: 'single', loadFactor: 0.6 })
const DURATION = replayDuration(REPLAY)

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let now = 0
let pendingFrame = null

beforeAll(() => {
  const style = document.createElement('style')
  style.textContent = THEME_CSS
  document.head.appendChild(style)

  // jsdom has no canvas backend and no layout, so stand both in.
  HTMLCanvasElement.prototype.getContext = function getContext() {
    if (!this.__stub) this.__stub = makeStubContext()
    return this.__stub
  }
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback }
    observe(target) {
      this.callback([{ contentRect: { width: 1000, height: 380 } }], this)
      void target
    }
    disconnect() {}
  }
})

beforeEach(() => {
  now = 0
  pendingFrame = null
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  globalThis.requestAnimationFrame = (cb) => { pendingFrame = cb; return 1 }
  globalThis.cancelAnimationFrame = () => { pendingFrame = null }
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Run one animation frame `ms` after the previous one. */
function frame(ms) {
  now += ms
  const cb = pendingFrame
  pendingFrame = null
  if (cb) act(() => cb(now))
}

function mount(element) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(element))
  return {
    host,
    update: (next) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount())
      host.remove()
    },
  }
}

describe('CabinView', () => {
  it('renders two layered canvases and paints both', () => {
    const view = mount(<CabinView replay={REPLAY} tSeconds={DURATION * 0.3} />)
    const canvases = view.host.querySelectorAll('canvas')
    expect(canvases.length).toBe(2)
    const [statik, dots] = canvases
    expect(statik.width).toBeGreaterThan(0)
    expect(statik.__stub.calls.length).toBeGreaterThan(100)
    expect(statik.__stub.bad).toEqual([])
    expect(dots.__stub.calls.length).toBeGreaterThan(20)
    expect(dots.__stub.bad).toEqual([])
    view.unmount()
  })

  it('repaints only the dot layer when time advances', () => {
    const view = mount(<CabinView replay={REPLAY} tSeconds={0} />)
    const [statik, dots] = view.host.querySelectorAll('canvas')
    const staticCalls = statik.__stub.calls.length
    const dotCalls = dots.__stub.calls.length
    view.update(<CabinView replay={REPLAY} tSeconds={DURATION * 0.5} />)
    expect(statik.__stub.calls.length).toBe(staticCalls)
    expect(dots.__stub.calls.length).toBeGreaterThan(dotCalls)
    view.unmount()
  })

  it('carries an accessible description of the live state', () => {
    const view = mount(<CabinView replay={REPLAY} tSeconds={DURATION} />)
    const label = view.host.querySelector('[role="img"]').getAttribute('aria-label')
    expect(label).toContain(REPLAY.aircraft.name)
    expect(label).toContain(`${REPLAY.passengers.length} of ${REPLAY.passengers.length} seated`)
    view.unmount()
  })

  it('shows an empty state without a replay', () => {
    const view = mount(<CabinView replay={null} />)
    expect(view.host.textContent).toMatch(/Run a simulation/)
    view.unmount()
  })

  it('renders the twin-aisle aeroplane vertically too', () => {
    const twin = makeReplay({ aircraft: 'twin', loadFactor: 0.4 })
    const view = mount(
      <CabinView replay={twin} tSeconds={60} orientation="vertical" showHeat showQueue />,
    )
    for (const canvas of view.host.querySelectorAll('canvas')) {
      expect(canvas.__stub.bad).toEqual([])
    }
    view.unmount()
  })
})

describe('usePlayback', () => {
  function Probe({ duration, onClock }) {
    const clock = usePlayback({ duration })
    onClock(clock)
    return null
  }

  function mountClock(duration = DURATION) {
    let clock = null
    const view = mount(<Probe duration={duration} onClock={(c) => { clock = c }} />)
    return { view, get: () => clock }
  }

  it('advances exactly one simulated second per wall second at 1x', () => {
    const { view, get } = mountClock()
    act(() => get().setPlaying(true))
    // 60 jittery animation frames summing to exactly 1000 ms of wall clock.
    for (let i = 0; i < 60; i++) frame(i % 3 === 0 ? 20 : 15)
    expect(now).toBe(1000)
    expect(get().t).toBeCloseTo(1, 6)
    view.unmount()
  })

  it('scales with the speed multiplier', () => {
    const { view, get } = mountClock()
    act(() => get().setSpeed(10))
    act(() => get().setPlaying(true))
    for (let i = 0; i < 10; i++) frame(100)
    expect(get().t).toBeCloseTo(10, 6)
    view.unmount()
  })

  it('covers more ground per frame at 100x rather than more frames', () => {
    const { view, get } = mountClock()
    act(() => get().setSpeed(100))
    act(() => get().setPlaying(true))
    frame(16.7)
    expect(get().t).toBeCloseTo(1.67, 4)
    view.unmount()
  })

  it('clamps a huge wall delta from a backgrounded tab', () => {
    const { view, get } = mountClock()
    act(() => get().setPlaying(true))
    frame(30000)
    expect(get().t).toBeLessThanOrEqual(0.25)
    view.unmount()
  })

  it('stops at the end and rewinds on the next play', () => {
    const { view, get } = mountClock(1)
    act(() => get().setPlaying(true))
    frame(250)
    frame(250)
    frame(250)
    frame(250)
    frame(250)
    expect(get().t).toBe(1)
    expect(get().playing).toBe(false)
    act(() => get().toggle())
    expect(get().t).toBe(0)
    expect(get().playing).toBe(true)
    view.unmount()
  })

  it('steps by whole frames and resets', () => {
    const { view, get } = mountClock()
    act(() => get().step(1))
    expect(get().t).toBeCloseTo(0.25, 9)
    act(() => get().step(1))
    expect(get().t).toBeCloseTo(0.5, 9)
    act(() => get().step(-1))
    expect(get().t).toBeCloseTo(0.25, 9)
    act(() => get().setT(42))
    expect(get().t).toBe(42)
    act(() => get().reset())
    expect(get().t).toBe(0)
    view.unmount()
  })

  it('pauses when the tab is hidden and resumes when it comes back', () => {
    const { view, get } = mountClock()
    act(() => get().setPlaying(true))
    frame(16)
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(get().playing).toBe(false)
    hidden.mockReturnValue(false)
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(get().playing).toBe(true)
    view.unmount()
  })
})

describe('PlaybackControls', () => {
  it('exposes every transport control with an accessible name', () => {
    const view = mount(<PlaybackControls replay={REPLAY} t={0} />)
    const names = [...view.host.querySelectorAll('button')].map((b) =>
      b.getAttribute('aria-label'),
    )
    expect(names).toEqual(['Play', 'Step back one frame', 'Step forward one frame', 'Reset to the start'])
    view.unmount()
  })

  it('offers exactly the specified speed stops', () => {
    const view = mount(<PlaybackControls replay={REPLAY} t={0} />)
    const options = [...view.host.querySelectorAll('option')].map((o) => o.textContent)
    expect(options).toEqual(['1×', '2×', '5×', '10×', '25×', '50×', '100×'])
    view.unmount()
  })

  it('scrubs to a time and reports progress to assistive tech', () => {
    const seen = []
    const view = mount(
      <PlaybackControls replay={REPLAY} t={DURATION / 2} onSeek={(t) => seen.push(t)} />,
    )
    const range = view.host.querySelector('input[type="range"]')
    expect(Number(range.max)).toBeCloseTo(DURATION, 6)
    expect(Number(range.value)).toBeCloseTo(DURATION / 2, 3)
    expect(range.getAttribute('aria-valuetext')).toMatch(/percent seated/)

    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value',
    ).set
    act(() => {
      setter.call(range, String(DURATION * 0.25))
      range.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(seen.at(-1)).toBeCloseTo(DURATION * 0.25, 3)
    view.unmount()
  })

  it('disables everything without a replay', () => {
    const view = mount(<PlaybackControls replay={null} />)
    for (const el of view.host.querySelectorAll('button, input, select')) {
      expect(el.disabled).toBe(true)
    }
    view.unmount()
  })

  it('draws the seated-progress sparkline behind the scrubber', () => {
    const view = mount(<PlaybackControls replay={REPLAY} t={DURATION / 3} />)
    const spark = view.host.querySelector('canvas')
    expect(spark.__stub.calls.length).toBeGreaterThan(50)
    expect(spark.__stub.bad).toEqual([])
    view.unmount()
  })
})

describe('CabinLegend', () => {
  it('names every state and cabin class, with live counts', () => {
    const counts = [5, 4, 3, 2, 1]
    const view = mount(<CabinLegend replay={REPLAY} counts={counts} />)
    const text = view.host.textContent
    for (const label of ['Queued', 'Walking', 'Stowing', 'Seated', 'First', 'Main Cabin']) {
      expect(text).toContain(label)
    }
    // Stowing and shuffling are one visual state, so their counts are summed.
    expect(text).toContain('5')
    expect(text).toContain('1')
    expect(view.host.querySelectorAll('svg').length).toBe(4)
    view.unmount()
  })

  it('drops the class row when asked', () => {
    const view = mount(<CabinLegend replay={REPLAY} showClasses={false} showCounts={false} />)
    expect(view.host.textContent).not.toContain('Main Cabin')
    view.unmount()
  })

  /**
   * The 787-9 carries economy in two physically separate sections — rows 30-35
   * forward and 42-57 aft, split by a galley complex — and both declare
   * `classKey: 'economy'`. Deduping on the class alone dropped the aft section,
   * which is SIXTEEN rows and the largest cabin on the aeroplane, and left the
   * survivor labelled "Economy (forward)": a key that tells the reader the rear
   * half of the aircraft is something it is not.
   */
  it('lists both of the 787-9 economy sections', () => {
    const replay = { aircraft: makeSplitEconomyAircraft() }
    const view = mount(<CabinLegend replay={replay} showCounts={false} />)
    const chips = [...view.host.querySelectorAll('.cab-legend__chip')].map(
      (chip) => chip.parentElement.textContent.trim(),
    )
    expect(chips).toEqual([
      'Polaris Business',
      'Premium Plus',
      'Economy (forward)',
      'Economy (aft)',
    ])
    view.unmount()
  })

  it('still collapses two cabins that really are the same thing', () => {
    const replay = {
      aircraft: {
        cabins: [
          { id: 'eco_a', name: 'Main Cabin', classKey: 'economy' },
          { id: 'eco_b', name: 'Main Cabin', classKey: 'economy' },
          { id: 'first', name: 'First', classKey: 'first' },
        ],
      },
    }
    const view = mount(<CabinLegend replay={replay} showCounts={false} />)
    expect(view.host.querySelectorAll('.cab-legend__chip').length).toBe(2)
    view.unmount()
  })

  /**
   * Every airframe in the roster, straight from the declarative source both
   * ports read. Six aeroplanes, no chip listed twice, and the 787-9 keeping
   * all four of its cabins.
   */
  it('lists every roster cabin exactly once, on all six airframes', () => {
    const roster = JSON.parse(
      readFileSync(resolve(process.cwd(), '../parity/aircraft.json'), 'utf8'),
    )
    expect(roster.aircraft.length).toBe(6)
    for (const spec of roster.aircraft) {
      const view = mount(
        <CabinLegend replay={{ aircraft: { cabins: spec.cabins } }} showCounts={false} />,
      )
      const chips = [...view.host.querySelectorAll('.cab-legend__chip')].map(
        (chip) => chip.parentElement.textContent.trim(),
      )
      expect(chips, spec.id).toEqual(spec.cabins.map((c) => c.name))
      expect(new Set(chips).size, `${spec.id} lists a cabin twice`).toBe(chips.length)
      view.unmount()
    }
  })
})

describe('PassengerTooltip', () => {
  it('reports seat, group, party, bags, state and waiting time', () => {
    const pax = REPLAY.passengers[0]
    const view = mount(
      <PassengerTooltip
        replay={REPLAY}
        paxId={0}
        tSeconds={12.5}
        clientX={100}
        clientY={100}
        state={STATE.QUEUED}
      />,
    )
    const text = view.host.textContent
    expect(text).toContain(`${pax.seatRow}${pax.seatLetter}`)
    expect(text).toContain('Queued')
    expect(text).toContain(String(pax.bags))
    expect(text).toContain('12.5 s')
    view.unmount()
  })

  it('reports total time to seat once seated', () => {
    const view = mount(
      <PassengerTooltip
        replay={REPLAY}
        paxId={0}
        tSeconds={DURATION}
        clientX={10}
        clientY={10}
        state={STATE.SEATED}
      />,
    )
    expect(view.host.textContent).toContain('Time to seat')
    view.unmount()
  })

  it('stays inside the viewport when the cursor is near the edge', () => {
    window.innerWidth = 400
    window.innerHeight = 300
    const view = mount(
      <PassengerTooltip
        replay={REPLAY}
        paxId={1}
        tSeconds={30}
        clientX={398}
        clientY={298}
        state={STATE.WALKING}
      />,
    )
    const tip = view.host.querySelector('.cab-tip')
    const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(tip.style.transform)
    expect(match).not.toBeNull()
    // jsdom reports zero size, so the assertion that matters is the clamp.
    expect(Number(match[1])).toBeLessThanOrEqual(400)
    expect(Number(match[2])).toBeLessThanOrEqual(300)
    expect(Number(match[1])).toBeGreaterThanOrEqual(0)
    view.unmount()
  })
})
