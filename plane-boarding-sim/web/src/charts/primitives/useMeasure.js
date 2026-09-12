import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Element size via ResizeObserver, with a sane fallback for environments that
 * do not have one (jsdom in the test run, very old browsers) so charts still
 * produce geometry instead of collapsing to zero width.
 */
export function useMeasure(fallbackWidth = 640, fallbackHeight = 0) {
  const nodeRef = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0, measured: false })

  const ref = useCallback((node) => {
    nodeRef.current = node
    if (node && typeof node.getBoundingClientRect === 'function') {
      const rect = node.getBoundingClientRect()
      if (rect.width > 0) setSize({ width: rect.width, height: rect.height, measured: true })
    }
  }, [])

  useEffect(() => {
    const node = nodeRef.current
    if (!node) return undefined
    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => {
        const rect = node.getBoundingClientRect()
        if (rect.width > 0) setSize({ width: rect.width, height: rect.height, measured: true })
      }
      onResize()
      if (typeof window !== 'undefined') window.addEventListener('resize', onResize)
      return () => { if (typeof window !== 'undefined') window.removeEventListener('resize', onResize) }
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const box = entry.contentRect
        if (box.width > 0) setSize({ width: box.width, height: box.height, measured: true })
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return [
    ref,
    {
      width: size.measured && size.width > 0 ? size.width : fallbackWidth,
      height: size.measured && size.height > 0 ? size.height : fallbackHeight,
      measured: size.measured,
    },
  ]
}
