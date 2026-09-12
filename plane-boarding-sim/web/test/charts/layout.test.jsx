// @vitest-environment jsdom
/**
 * Layout guards for the two measured layout defects.
 *
 * jsdom has no layout engine, so these assert the geometry the browser then
 * lays out — the real proof is the Playwright rect-intersection pass, and
 * these keep the values from drifting back.
 */
import { afterEach, describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { Convergence } from '../../src/charts/Convergence.jsx'
import { makeBatch } from '../../src/charts/__fixtures__/makeBatch.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const CSS = readFileSync(resolve(process.cwd(), 'src/charts/charts.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const mounted = []
function render(ui) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(ui))
  mounted.push({ container, root })
  return container
}
afterEach(() => {
  while (mounted.length) {
    const handle = mounted.pop()
    act(() => handle.root.unmount())
    handle.container.remove()
  }
})

describe('the card grid survives a container narrower than a card', () => {
  it('floors the track at 100% of the container, not at 360px', () => {
    const rule = CSS.match(/\.cg-grid\s*{[^}]*}/)[0]
    expect(rule).toMatch(/minmax\(\s*min\(360px,\s*100%\)\s*,\s*1fr\s*\)/)
    expect(rule).not.toMatch(/minmax\(\s*360px/)
  })
})

describe('Convergence axis furniture does not collide', () => {
  it('puts the rotated axis title clear of the m:ss tick labels', () => {
    const batch = makeBatch({ runs: 40, strategies: ['wilma', 'random'], sweep: false })
    const container = render(<Convergence batch={batch} hidden={new Set()} />)

    const title = [...container.querySelectorAll('text')].find(
      (t) => t.textContent === 'Running mean (m:ss)',
    )
    expect(title, 'the y-axis title must be rendered').toBeTruthy()

    const x = Number(title.getAttribute('transform').match(/translate\((-?[\d.]+)/)[1])
    // Tick labels are anchored `end` at x = -8 and run about 34px wide, so
    // their left edge sits near -42. The title's box is ~11px tall around its
    // own centre, so its centre has to be at -48 or further out.
    expect(x).toBeLessThanOrEqual(-48)
  })
})
