/**
 * Contrast floors, computed from the tokens as they are written in
 * src/theme.css.
 *
 * `--text-3` is the one-line-explanation / axis-tick ink and it lands on three
 * different surfaces plus the tinted open-door row. It failed AA on every one
 * of them in both themes (3.68 / 3.25 / 2.99 light; 4.19 / 3.79 / 3.29 dark).
 * None of that text is large, so 4.5:1 applies to all of it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { contrastRatio, labelInk, parseColor } from '../../src/charts/primitives/ink.js'

const CSS = readFileSync(resolve(process.cwd(), 'src/theme.css'), 'utf8')

/** The token table for one theme, read straight out of the stylesheet. */
function tokensOf(selector) {
  const start = CSS.indexOf(selector)
  expect(start, `${selector} must exist in theme.css`).toBeGreaterThan(-1)
  const open = CSS.indexOf('{', start)
  const close = CSS.indexOf('\n}', open)
  const block = CSS.slice(open, close)
  const out = {}
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[match[1]] = match[2].trim()
  }
  return out
}

const LIGHT = tokensOf(':root {')
const DARK = { ...LIGHT, ...tokensOf(":root[data-theme='dark']") }

/** `color-mix(in srgb, A p%, B)` the way the browser composites it. */
function mix(a, b, fraction) {
  const A = parseColor(a)
  const B = parseColor(b)
  return {
    r: A.r * fraction + B.r * (1 - fraction),
    g: A.g * fraction + B.g * (1 - fraction),
    b: A.b * fraction + B.b * (1 - fraction),
  }
}

/** Every real composited background --text-3 is painted on. */
function surfaces(t) {
  return {
    '--surface': t['--surface'],
    '--surface-2': t['--surface-2'],
    '--surface-3': t['--surface-3'],
    'open-door row': mix(t['--good'], t['--surface-2'], 0.08),
    '--bg': t['--bg'],
  }
}

const AA = 4.5

describe('--text-3 clears WCAG AA everywhere it is used', () => {
  for (const [theme, tokens] of [['light', LIGHT], ['dark', DARK]]) {
    for (const [name, background] of Object.entries(surfaces(tokens))) {
      it(`${theme}: on ${name}`, () => {
        const ratio = contrastRatio(tokens['--text-3'], background)
        expect(ratio, `${theme} --text-3 on ${name} is ${ratio?.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
      })
    }
  }

  it('--text and --text-2 are still comfortably above it', () => {
    for (const tokens of [LIGHT, DARK]) {
      expect(contrastRatio(tokens['--text'], tokens['--surface'])).toBeGreaterThanOrEqual(7)
      expect(contrastRatio(tokens['--text-2'], tokens['--surface-2'])).toBeGreaterThanOrEqual(AA)
    }
  })
})

describe('in-fill label ink is chosen by luminance, not by theme', () => {
  // The four fills of the "Where the time goes" stack, in both themes.
  const FILLS = ['--state-walking', '--state-stowing', '--series-4', '--state-waiting']

  for (const [theme, tokens] of [['light', LIGHT], ['dark', DARK]]) {
    for (const token of FILLS) {
      it(`${theme}: ${token}`, () => {
        const fill = tokens[token]
        const ink = labelInk(fill)
        const ratio = contrastRatio(ink, fill)
        expect(ratio, `${ink} on ${fill} is ${ratio?.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
      })
    }
  }

  it('picks different inks for different fills in the same theme', () => {
    const inks = new Set(FILLS.map((token) => labelInk(LIGHT[token])))
    expect(inks.size, 'a single theme-wide ink cannot clear AA on all four').toBe(2)
  })

  it('falls back to the dark ink when the fill cannot be resolved', () => {
    expect(labelInk('')).toBe('#000000')
    expect(labelInk('var(--nope)')).toBe('#000000')
  })
})

describe('theme.css owns its own color-scheme', () => {
  it('declares light as the base and dark under [data-theme=dark]', () => {
    expect(CSS).not.toMatch(/color-scheme:\s*light dark/)
    expect(CSS).toMatch(/color-scheme:\s*light;/)
    expect(tokensOf(":root[data-theme='dark']")).toBeTruthy()
    const darkBlock = CSS.slice(CSS.indexOf(":root[data-theme='dark']"))
    expect(darkBlock.slice(0, 200)).toMatch(/color-scheme:\s*dark;/)
  })
})
