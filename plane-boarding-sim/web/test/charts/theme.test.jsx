// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useThemeVersion, readToken } from '../../src/charts/primitives/useTheme.js'
import { SeatedCurve } from '../../src/charts/SeatedCurve.jsx'
import { makeBatch } from '../../src/charts/__fixtures__/makeBatch.js'

const mounted = []

function render(ui) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(ui))
  const handle = { container, root }
  mounted.push(handle)
  return handle
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  while (mounted.length) {
    const handle = mounted.pop()
    act(() => handle.root.unmount())
    handle.container.remove()
  }
  document.documentElement.removeAttribute('data-theme')
})

function Probe() {
  const version = useThemeVersion()
  return <span data-testid="version">{version}</span>
}

describe('theme tokens', () => {
  it('reads a token from the document, with a fallback when unset', () => {
    document.documentElement.style.setProperty('--series-1', '#2563eb')
    expect(readToken('--series-1')).toBe('#2563eb')
    expect(readToken('--does-not-exist', { fallback: 'var(--text)' })).toBe('var(--text)')
    document.documentElement.style.removeProperty('--series-1')
  })

  it('bumps a version when the theme attribute changes, so computed reads happen again', async () => {
    const { container } = render(<Probe />)
    const before = Number(container.textContent)
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'dark')
      await Promise.resolve()
    })
    expect(Number(container.textContent)).toBeGreaterThan(before)
  })

  it('paints charts through CSS variables, so a theme flip needs no JS re-read', () => {
    const batch = makeBatch({ runs: 8 })
    const { container } = render(<SeatedCurve batch={batch} hidden={new Set()} />)
    const light = container.querySelector('svg[role="img"]').innerHTML
    act(() => {
      document.documentElement.setAttribute('data-theme', 'dark')
    })
    const dark = container.querySelector('svg[role="img"]').innerHTML
    // identical markup: every colour is a token reference the browser resolves
    expect(dark).toBe(light)
    expect(light).toMatch(/var\(--series-1\)/)
    expect(light).toMatch(/var\(--border\)/)
  })
})
