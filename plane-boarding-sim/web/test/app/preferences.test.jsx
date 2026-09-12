// @vitest-environment jsdom
/**
 * The three OS/user preferences the shell has to honour: the colour scheme it
 * starts in, whether it may start moving on its own, and whether a shared link
 * can smuggle keys into the config.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../../src/App.jsx'
import { preferredTheme, prefersReducedMotion } from '../../src/state/StoreProvider.jsx'
import { decodeConfig, encodeConfig } from '../../src/lib/urlConfig.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const realMatchMedia = window.matchMedia

/** Answer `matches` for every query listed in `on`, false for the rest. */
function stubMatchMedia(on) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: on.some((needle) => query.includes(needle)),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}

/**
 * Every root mounted by a test, so `afterEach` can take them down again.
 *
 * These tests mount the whole App, which starts a playback clock and a
 * deferred run. Leaving a root mounted lets one of those fire after vitest has
 * torn the environment down, which fails the RUN while every test passes --
 * an intermittent, maddening way for `make test` to go red.
 */
const mounted = []

async function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  await act(async () => {
    root.render(<App />)
  })
  for (let i = 0; i < 60 && !host.querySelector('.app'); i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
  }
  return { host, root }
}

beforeEach(() => {
  document.body.innerHTML = ''
  window.localStorage.clear()
  window.location.hash = ''
  document.documentElement.removeAttribute('data-theme')
})

afterEach(async () => {
  while (mounted.length) {
    const root = mounted.pop()
    await act(async () => {
      root.unmount()
    })
  }
  window.matchMedia = realMatchMedia
})

describe('prefers-color-scheme', () => {
  it('starts light when the OS asks for light and nothing is stored', async () => {
    stubMatchMedia([])
    expect(preferredTheme()).toBe('light')
    const { host } = await mount()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(host.querySelector('.app')).toBeTruthy()
  })

  it('starts dark when the OS asks for dark', async () => {
    stubMatchMedia(['prefers-color-scheme: dark'])
    expect(preferredTheme()).toBe('dark')
    await mount()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('a stored choice still beats the OS', async () => {
    stubMatchMedia(['prefers-color-scheme: dark'])
    window.localStorage.setItem('boardingLab.theme', JSON.stringify('light'))
    await mount()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('falls back to dark rather than throwing when matchMedia is missing', () => {
    window.matchMedia = undefined
    expect(preferredTheme()).toBe('dark')
    expect(prefersReducedMotion()).toBe(false)
  })
})

describe('prefers-reduced-motion', () => {
  it('does not start the replay playing', async () => {
    stubMatchMedia(['prefers-reduced-motion: reduce'])
    expect(prefersReducedMotion()).toBe(true)
    const { host } = await mount()
    await act(async () => {
      ;[...host.querySelectorAll('.btn--run')].pop().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    for (let i = 0; i < 40 && !host.querySelector('.btn--play'); i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5))
      })
    }
    const play = host.querySelector('.btn--play')
    expect(play).toBeTruthy()
    expect(play.getAttribute('aria-label')).toBe('Play')
    expect(play.disabled).toBe(false)
  })

  it('still autoplays when the user has not asked for reduced motion', async () => {
    stubMatchMedia([])
    const { host } = await mount()
    await act(async () => {
      ;[...host.querySelectorAll('.btn--run')].pop().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    for (let i = 0; i < 40 && !host.querySelector('.btn--play'); i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5))
      })
    }
    expect(host.querySelector('.btn--play').getAttribute('aria-label')).toBe('Pause')
  })
})

describe('a config arriving in the hash', () => {
  it('keeps the values it knows', async () => {
    stubMatchMedia([])
    window.location.hash = `#${encodeConfig({ loadFactor: 0.5 }, { loadFactor: 0.92 })}`
    const { host } = await mount()
    const slider = host.querySelector('#ctl-loadFactor')
    expect(slider.value).toBe('0.5')
  })

  it('drops keys the engine has never heard of, and never re-encodes them', async () => {
    stubMatchMedia([])
    // A hand-built payload: a legitimate change plus junk.
    const payload = { loadFactor: 0.5, evilKey: 'pwned', __proto__x: 1, runs: 12 }
    window.location.hash = `#${encodeConfig(payload, {})}`
    const { host } = await mount()
    expect(host.querySelector('#ctl-loadFactor').value).toBe('0.5')
    expect(host.querySelector('#ctl-runs').value).toBe('12')

    const round = decodeConfig(window.location.hash)
    expect(round).toBeTruthy()
    expect(round).not.toHaveProperty('evilKey')
    expect(round).not.toHaveProperty('__proto__x')
    expect(round.loadFactor).toBe(0.5)
  })

  it('does not let a malformed hash value reach the UI as NaN', async () => {
    stubMatchMedia([])
    window.location.hash = `#${encodeConfig({ loadFactor: 'banana' }, {})}`
    const { host } = await mount()
    const slider = host.querySelector('#ctl-loadFactor')
    expect(slider.value).not.toBe('NaN')
    expect(Number.isFinite(Number(slider.value))).toBe(true)
    expect(host.querySelector('.section__badge')?.textContent ?? '').not.toMatch(/NaN/)
    expect(host.textContent).not.toMatch(/NaN/)
  })
})
