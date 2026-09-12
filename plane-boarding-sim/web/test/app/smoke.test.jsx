// @vitest-environment jsdom
/**
 * Shell smoke test: the app boots against the fixture engine, renders the
 * control panel and the three modes, and survives the interactions the
 * keyboard shortcuts drive.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../../src/App.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

async function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(<App />)
  })
  // The engine loads asynchronously through the bridge; wait for the shell.
  for (let i = 0; i < 50 && !host.querySelector('.app'); i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
  }
  return { host, root }
}

const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
}

const key = async (k) => {
  await act(async () => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }))
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
  window.location.hash = ''
})

describe('app shell', () => {
  it('boots and renders the header, panel and status bar', async () => {
    const { host } = await mount()
    expect(host.querySelector('.header__title')?.textContent).toMatch(/Boarding/)
    expect(host.querySelectorAll('.tab')).toHaveLength(3)
    expect(host.querySelector('.statusbar')).toBeTruthy()
    expect(host.querySelectorAll('.section').length).toBeGreaterThanOrEqual(7)
  })

  it('gives every collapsible section a real button with aria-expanded', async () => {
    const { host } = await mount()
    const toggles = [...host.querySelectorAll('.section__toggle')]
    expect(toggles.length).toBeGreaterThanOrEqual(7)
    for (const t of toggles) {
      expect(t.tagName).toBe('BUTTON')
      expect(['true', 'false']).toContain(t.getAttribute('aria-expanded'))
      expect(t.getAttribute('aria-controls')).toBeTruthy()
    }
    const first = toggles[0]
    const before = first.getAttribute('aria-expanded')
    await click(first)
    expect(first.getAttribute('aria-expanded')).not.toBe(before)
  })

  it('gives every control an accessible name', async () => {
    const { host } = await mount()
    // Open every section so all controls are in the tree.
    for (const t of [...host.querySelectorAll('.section__toggle')]) {
      if (t.getAttribute('aria-expanded') === 'false') await click(t)
    }
    const inputs = [...host.querySelectorAll('input, select, [role="radiogroup"], [role="switch"]')]
    expect(inputs.length).toBeGreaterThan(20)
    for (const el of inputs) {
      const named =
        el.getAttribute('aria-label') ||
        el.getAttribute('aria-labelledby') ||
        (el.id && [...host.querySelectorAll("label[for]")].find((l) => l.getAttribute("for") === el.id)) ||
        el.closest('label')
      expect(Boolean(named)).toBe(true)
    }
  })

  it('switches mode with the number keys and with the tabs', async () => {
    const { host } = await mount()
    await key('2')
    expect(host.querySelector('.tab.is-active')?.textContent).toMatch(/Analytics/)
    await key('3')
    expect(host.querySelector('.tab.is-active')?.textContent).toMatch(/Compare/)
    await key('1')
    expect(host.querySelector('.tab.is-active')?.textContent).toMatch(/Cabin/)
    await click([...host.querySelectorAll('.tab')][1])
    expect(host.querySelector('.tab.is-active')?.textContent).toMatch(/Analytics/)
  })

  it('does not fire shortcuts while a text field has focus', async () => {
    const { host } = await mount()
    const seed = host.querySelector('#ctl-seed')
    seed.focus()
    await act(async () => {
      seed.dispatchEvent(new window.KeyboardEvent('keydown', { key: '2', bubbles: true }))
    })
    expect(host.querySelector('.tab.is-active')?.textContent).toMatch(/Cabin/)
  })

  it('toggles the theme and remembers it', async () => {
    const { host } = await mount()
    const before = document.documentElement.getAttribute('data-theme')
    const toggle = [...host.querySelectorAll('button')].find((b) => /theme/i.test(b.getAttribute('aria-label') || ''))
    await click(toggle)
    const after = document.documentElement.getAttribute('data-theme')
    expect(after).not.toBe(before)
    expect(JSON.parse(window.localStorage.getItem('boardingLab.theme'))).toBe(after)
  })

  it('applies a preset, updates the hash, and resets', async () => {
    const { host } = await mount()
    const preset = [...host.querySelectorAll('.preset')].find((p) => /nightmare/i.test(p.textContent))
    await click(preset)
    expect(window.location.hash).toMatch(/^#c1=/)
    expect(host.querySelector('.share__count')?.textContent).toMatch(/changed/)
    const reset = [...host.querySelectorAll('.btn')].find((b) => b.textContent === 'Reset to defaults')
    await click(reset)
    expect(host.querySelector('.share__count')?.textContent).toMatch(/all defaults/)
    expect(window.location.hash).toBe('')
  })

  it('keeps the last open door locked, but reachable and explained', async () => {
    const { host } = await mount()
    expect(host.querySelectorAll('.door__input').length).toBeGreaterThan(1)
    // Close doors until one is left, whatever the airframe opens by default.
    for (let i = 0; i < 8; i += 1) {
      const open = [...host.querySelectorAll('.door__input')].filter((d) => d.checked)
      if (open.length <= 1) break
      await click(open[open.length - 1])
    }
    const checked = [...host.querySelectorAll('.door__input')].filter((d) => d.checked)
    expect(checked).toHaveLength(1)
    const last = checked[0]
    // aria-disabled, not disabled: the "at least one door must stay open"
    // explanation has to be reachable with a keyboard.
    expect(last.getAttribute('aria-disabled')).toBe('true')
    expect(last.disabled).toBe(false)
    last.focus()
    expect(document.activeElement).toBe(last)
    const reason = host.querySelector(`#${last.getAttribute('aria-describedby')}`)
    expect(reason?.textContent).toMatch(/at least one door/i)
    // ...and it still refuses to close.
    await act(async () => {
      last.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    expect([...host.querySelectorAll('.door__input')].filter((d) => d.checked)).toHaveLength(1)
  })

  it('marks an irrelevant control aria-disabled and keeps its reason reachable', async () => {
    const { host } = await mount()
    // Default strategy is not a zone strategy, so zoneCount must be dead.
    const behaviour = [...host.querySelectorAll('.section__toggle')].find((t) => /behaviour/i.test(t.textContent))
    if (behaviour.getAttribute('aria-expanded') === 'false') await click(behaviour)
    const zone = host.querySelector('#ctl-zoneCount')
    expect(zone.getAttribute('aria-disabled')).toBe('true')
    // `disabled` would take it out of the tab order, and with it the only
    // place the reason is written down.
    expect(zone.disabled).toBe(false)
    zone.focus()
    expect(document.activeElement).toBe(zone)
    const reason = host.querySelector(`#${zone.getAttribute('aria-describedby')}`)
    expect(reason?.textContent).toMatch(/zone/i)
    expect(zone.closest('.field').getAttribute('title')).toMatch(/zone/i)
  })

  it('renders the empty state and the analytics toolbar', async () => {
    const { host } = await mount()
    expect(host.querySelector('.empty__title')?.textContent).toMatch(/Nothing boarding/)
    await key('2')
    expect(host.querySelector('.toolbar__title')).toBeTruthy()
    expect(host.querySelector('.empty__title')?.textContent).toMatch(/No replications/)
  })
})

describe('running', () => {
  it('runs a cabin replay and drives the transport', async () => {
    const { host } = await mount()
    const runBtn = [...host.querySelectorAll('.btn--run')].pop()
    await click(runBtn)
    for (let i = 0; i < 40 && !host.querySelector('.transport'); i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5))
      })
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(host.querySelector('.empty__title')).toBeNull()
    // The status bar now reports a real total.
    expect(host.querySelector('.statusbar').textContent).toMatch(/\d\d:\d\d/)
    await key(' ')
    await key('ArrowRight')
    await key('R')
    expect(host.querySelector('.transport__clock')?.textContent).toBe('00:00')
  })

  it('runs a batch of replications in Analytics', { timeout: 20000 }, async () => {
    const { host } = await mount()
    await key('2')
    // Keep the test quick: 10 replications.
    const runs = host.querySelector('#ctl-runs')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(runs, '10')
      runs.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    await click([...host.querySelectorAll('.btn--run')].pop())
    for (let i = 0; i < 80 && !host.querySelector('.summary'); i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10))
      })
    }
    expect(host.querySelector('.summary__value')?.textContent).toMatch(/\d\d:\d\d/)
  })

  it('ranks strategies in Compare', { timeout: 30000 }, async () => {
    const { host } = await mount()
    await key('3')
    const runs = host.querySelector('#ctl-runs')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(runs, '10')
      runs.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    await click([...host.querySelectorAll('.btn--run')].pop())
    for (let i = 0; i < 200 && !host.querySelector('.rank'); i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10))
      })
    }
    const rows = [...host.querySelectorAll('.rank tbody tr')]
    expect(rows.length).toBeGreaterThan(1)
    expect(rows[0].classList.contains('is-best')).toBe(true)

    // The chart grid, when present, must accept our BatchResult.
    for (let i = 0; i < 40; i += 1) {
      if (host.querySelector('.viewport__loading') === null) break
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10))
      })
    }
    const boundary = [...host.querySelectorAll('.alert--bad')].find((a) => /could not render/.test(a.textContent))
    expect(boundary).toBeUndefined()
  })
})
