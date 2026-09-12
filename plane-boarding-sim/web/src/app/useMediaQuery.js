/** Subscribe to a CSS media query from JS, so behaviour can follow layout. */
import { useEffect, useState } from 'react'

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    try {
      return window.matchMedia?.(query)?.matches ?? false
    } catch {
      return false
    }
  })

  useEffect(() => {
    let mql
    try {
      mql = window.matchMedia?.(query)
    } catch {
      return undefined
    }
    if (!mql) return undefined
    setMatches(mql.matches)
    const onChange = (ev) => setMatches(ev.matches)
    // Safari < 14 only has the deprecated listener API.
    if (mql.addEventListener) mql.addEventListener('change', onChange)
    else mql.addListener(onChange)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange)
      else mql.removeListener(onChange)
    }
  }, [query])

  return matches
}
