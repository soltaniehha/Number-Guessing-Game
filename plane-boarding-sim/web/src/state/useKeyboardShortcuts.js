/**
 * Global keyboard shortcuts (UI_SPEC section 4).
 *
 *   Space  play / pause      R  reset the transport
 *   left / right  step 1 s   1 2 3  Cabin / Analytics / Compare
 *   Enter (with meta/ctrl)   run
 *
 * Never fires while the user is typing in a field, and never while a modal has
 * focus captured.
 */
import { useEffect } from 'react'
import { usePlayback, useStore } from './StoreProvider.jsx'

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT'])
const RANGE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])
const ACTIVATION_KEYS = new Set([' ', 'Spacebar', 'Enter'])

export function isTypingTarget(el) {
  if (!el) return false
  if (el.isContentEditable) return true
  if (!TYPING.has(el.tagName)) return false
  // Range inputs are controls, not text fields; see isOwnedByTarget.
  if (el.tagName === 'INPUT' && el.type === 'range') return false
  return true
}

/**
 * True when the focused element has a better claim on this key than the app
 * does: arrows belong to a focused slider, and Space or Enter belongs to a
 * focused button, switch or checkbox.
 */
export function isOwnedByTarget(el, key) {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' && el.type === 'range' && RANGE_KEYS.has(key)) return true
  if (!ACTIVATION_KEYS.has(key)) return false
  if (tag === 'BUTTON' || tag === 'A') return true
  if (tag === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) return true
  return el.getAttribute?.('role') === 'switch' || el.getAttribute?.('role') === 'radio'
}

export function useKeyboardShortcuts() {
  const { setMode, run, modal } = useStore()
  const playback = usePlayback()

  useEffect(() => {
    function onKeyDown(ev) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) {
        if ((ev.key === 'Enter' || ev.key === 'r') && (ev.metaKey || ev.ctrlKey) && !isTypingTarget(ev.target)) {
          ev.preventDefault()
          run()
        }
        return
      }
      if (isTypingTarget(ev.target)) return
      if (isOwnedByTarget(ev.target, ev.key)) return
      if (modal) return

      switch (ev.key) {
        case ' ':
        case 'Spacebar':
          ev.preventDefault()
          playback.toggle()
          break
        case 'ArrowLeft':
          ev.preventDefault()
          playback.step(-1)
          break
        case 'ArrowRight':
          ev.preventDefault()
          playback.step(1)
          break
        case 'r':
        case 'R':
          ev.preventDefault()
          playback.rewind()
          break
        case '1':
          setMode('cabin')
          break
        case '2':
          setMode('analytics')
          break
        case '3':
          setMode('compare')
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [playback, setMode, run, modal])
}
