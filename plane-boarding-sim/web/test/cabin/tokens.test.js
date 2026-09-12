// @vitest-environment jsdom
import { beforeAll, describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CLASS_TOKENS,
  HEAT_TOKENS,
  STATE_TOKENS,
  TOKEN_NAMES,
  classToken,
  heatColor,
  mixColor,
  observeTheme,
  parseColor,
  prefersReducedMotion,
  readTokens,
  stateToken,
  withAlpha,
} from '../../src/cabin/tokens.js'
import { STATE } from '../../src/cabin/playback.js'

// Vitest stubs CSS imports, so load the real stylesheet off disk. These
// assertions are only meaningful against the frozen src/theme.css.
const THEME_CSS = readFileSync(resolve(process.cwd(), 'src/theme.css'), 'utf8')

beforeAll(() => {
  const style = document.createElement('style')
  style.textContent = THEME_CSS
  document.head.appendChild(style)
})

describe('readTokens', () => {
  it('resolves every token the renderer uses from theme.css', () => {
    const tokens = readTokens()
    for (const name of TOKEN_NAMES) {
      expect(tokens[name], `--${name}`).toBeTruthy()
      expect(tokens[name], `--${name}`).not.toBe('transparent')
      expect(parseColor(tokens[name]), `--${name} is a parseable colour`).not.toBeNull()
    }
  })

  it('follows the theme attribute', () => {
    document.documentElement.removeAttribute('data-theme')
    const light = readTokens()
    document.documentElement.setAttribute('data-theme', 'dark')
    const dark = readTokens()
    document.documentElement.removeAttribute('data-theme')

    expect(dark.bg).not.toBe(light.bg)
    expect(dark['state-seated']).not.toBe(light['state-seated'])
    expect(dark['class-first']).not.toBe(light['class-first'])
    // ...and switching back restores the light palette exactly.
    expect(readTokens().bg).toBe(light.bg)
  })

  it('never throws without a document', () => {
    const fake = { ownerDocument: { defaultView: null } }
    const tokens = readTokens(fake)
    expect(Object.keys(tokens).length).toBe(TOKEN_NAMES.length)
  })
})

describe('token maps', () => {
  it('covers every passenger state and cabin class', () => {
    expect(STATE_TOKENS.length).toBe(5)
    expect(stateToken(STATE.QUEUED)).toBe('state-waiting')
    expect(stateToken(STATE.WALKING)).toBe('state-walking')
    expect(stateToken(STATE.STOWING)).toBe('state-stowing')
    expect(stateToken(STATE.SHUFFLING)).toBe('state-stowing')
    expect(stateToken(STATE.SEATED)).toBe('state-seated')
    for (const key of ['first', 'business', 'premium', 'economy']) {
      expect(classToken(key)).toBe(CLASS_TOKENS[key])
    }
    expect(classToken('nonsense')).toBe('class-economy')
  })

  it('resolves every state and class token against the real stylesheet', () => {
    const tokens = readTokens()
    for (const token of new Set([...STATE_TOKENS, ...Object.values(CLASS_TOKENS), ...HEAT_TOKENS])) {
      expect(parseColor(tokens[token]), token).not.toBeNull()
    }
  })
})

describe('colour maths', () => {
  it('parses hex, short hex and functional notation', () => {
    expect(parseColor('#e0364f')).toEqual([224, 54, 79, 1])
    expect(parseColor('#abc')).toEqual([170, 187, 204, 1])
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3, 1])
    expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3, 0.5])
    expect(parseColor('goldenrod')).toBeNull()
    expect(parseColor(undefined)).toBeNull()
  })

  it('re-emits a token at a new alpha', () => {
    expect(withAlpha('#16a34a', 0.25)).toBe('rgba(22, 163, 74, 0.25)')
    expect(withAlpha('#16a34a', 5)).toBe('rgba(22, 163, 74, 1)')
    // Unparseable input is passed through rather than silently blackened.
    expect(withAlpha('color-mix(in srgb, red, blue)', 0.5)).toBe('color-mix(in srgb, red, blue)')
  })

  it('mixes two token colours', () => {
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('rgba(128, 128, 128, 1)')
    expect(mixColor('#000000', '#ffffff', 0)).toBe('rgba(0, 0, 0, 1)')
  })

  it('samples the heat ramp continuously across the tokens', () => {
    const tokens = readTokens()
    expect(heatColor(tokens, 0)).toBe(withAlpha(tokens['heat-0'], 1))
    expect(heatColor(tokens, 1)).toBe(withAlpha(tokens['heat-5'], 1))
    // Monotonic and always parseable in between.
    for (let i = 0; i <= 10; i++) {
      expect(parseColor(heatColor(tokens, i / 10))).not.toBeNull()
    }
  })
})

describe('observeTheme', () => {
  it('fires when the theme attribute flips and stops after unsubscribe', async () => {
    let fired = 0
    const stop = observeTheme(() => { fired++ })
    document.documentElement.setAttribute('data-theme', 'dark')
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(fired).toBeGreaterThan(0)

    const seen = fired
    stop()
    document.documentElement.removeAttribute('data-theme')
    await new Promise((r) => setTimeout(r, 0))
    expect(fired).toBe(seen)
  })
})

describe('prefersReducedMotion', () => {
  it('is false when matchMedia is unavailable', () => {
    const original = window.matchMedia
    delete window.matchMedia
    expect(prefersReducedMotion()).toBe(false)
    window.matchMedia = original
  })
})
