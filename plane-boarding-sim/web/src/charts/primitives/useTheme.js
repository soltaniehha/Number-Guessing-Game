import { useEffect, useState, useCallback } from 'react'

/**
 * Charts paint with `var(--token)` so the browser re-resolves every colour on
 * a theme flip for free. This hook exists for the handful of places that need
 * a *computed* value (measuring, canvas, exporting): it bumps a counter when
 * the theme actually changes, so those reads happen again.
 */
export function useThemeVersion() {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined
    const bump = () => setVersion((v) => v + 1)

    let observer
    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(bump)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'class', 'style'],
      })
    }

    let media
    if (typeof window.matchMedia === 'function') {
      media = window.matchMedia('(prefers-color-scheme: dark)')
      if (media.addEventListener) media.addEventListener('change', bump)
      else if (media.addListener) media.addListener(bump)
    }

    return () => {
      if (observer) observer.disconnect()
      if (media) {
        if (media.removeEventListener) media.removeEventListener('change', bump)
        else if (media.removeListener) media.removeListener(bump)
      }
    }
  }, [])

  return version
}

/**
 * Resolve a design token to its computed value (e.g. `--series-1` -> `#2563eb`).
 * Returns `fallback` when there is no DOM or the token is unset.
 */
export function readToken(name, { element = null, fallback = '' } = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback
  const el = element ?? document.documentElement
  try {
    const value = window.getComputedStyle(el).getPropertyValue(name)
    return value ? value.trim() || fallback : fallback
  } catch {
    return fallback
  }
}

/** `readToken`, re-run whenever the theme changes. */
export function useToken(name, fallback = '') {
  const version = useThemeVersion()
  const read = useCallback(() => readToken(name, { fallback }), [name, fallback])
  const [value, setValue] = useState(read)
  useEffect(() => { setValue(read()) }, [read, version])
  return value
}
