/**
 * Dialog focus machinery, shared by the modal and by the narrow-screen control
 * drawer so there is exactly one implementation to keep correct.
 *
 * Three things a dialog owes the keyboard:
 *   1. focus moves *into* it when it opens, and back to the opener when it closes;
 *   2. Tab and Shift+Tab cannot leave it;
 *   3. Escape closes it.
 *
 * The subtlety that broke this before: the focus-restore step must live in a
 * mount/unmount effect with no dependencies. Callers pass fresh `onClose`
 * arrows on every render, so an effect that depends on `onClose` re-runs on
 * every keystroke — and if that effect restores focus in its cleanup, every
 * keystroke yanks focus out of the dialog. The key listener does need the
 * current `onClose`, so it gets an effect of its own.
 */
import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'button, textarea, input, select, a[href], [tabindex]:not([tabindex="-1"])'

/**
 * Everything inside `node` that a Tab press can actually land on.
 *
 * `querySelectorAll` alone is not enough: a disabled or hidden trailing button
 * makes `last` unfocusable, the wrap-around never fires and the trap leaks.
 */
export function focusableIn(node) {
  if (!node) return []
  // Without a layout engine (jsdom) every rect is empty, so the visibility
  // filter would reject the whole document. Only apply it when there is layout.
  const hasLayout = typeof node.getClientRects === 'function' && node.getClientRects().length > 0
  return Array.from(node.querySelectorAll(FOCUSABLE)).filter((el) => {
    if (el.disabled) return false
    if (el.getAttribute('aria-disabled') === 'true' && el.tagName !== 'BUTTON' && el.tagName !== 'A') return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    if (el.closest('[inert]')) return false
    if (el.tabIndex < 0) return false
    if (!hasLayout) return true
    return el.getClientRects().length > 0
  })
}

/** The element that should hold focus when the dialog opens. */
export function initialFocusIn(node) {
  if (!node) return null
  // `querySelector('[data-autofocus], button, …')` returns the first element
  // matching *any* of the selectors in document order, which quietly ignores
  // the author's choice. Ask for the marked element first, on its own.
  return node.querySelector('[data-autofocus]') ?? focusableIn(node)[0] ?? node.querySelector(FOCUSABLE) ?? null
}

/**
 * Trap focus inside `containerRef` while `active`, closing on Escape.
 *
 * @param {object}   opts
 * @param {object}   opts.containerRef  ref to the dialog element
 * @param {Function} opts.onClose       called on Escape
 * @param {boolean}  [opts.active]      false disables the whole thing
 * @param {Function} [opts.returnFocusTo] returns the element to focus on close,
 *                                        overriding "whatever opened it"
 */
export function useDialogFocus({ containerRef, onClose, active = true, returnFocusTo }) {
  const opener = useRef(null)
  const returnTo = useRef(returnFocusTo)
  returnTo.current = returnFocusTo

  // Mount / unmount only. No dependency may enter this list: re-running it is
  // what stole focus on every keystroke.
  useEffect(() => {
    if (!active) return undefined
    opener.current = document.activeElement
    initialFocusIn(containerRef.current)?.focus()
    return () => {
      const explicit = typeof returnTo.current === 'function' ? returnTo.current() : null
      const back = explicit || opener.current
      if (back instanceof HTMLElement && document.contains(back)) back.focus()
    }
    // containerRef is a ref and returnFocusTo is read through a ref, so
    // `active` is genuinely the only input this effect has.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // The key listener, which does need the current onClose.
  useEffect(() => {
    if (!active) return undefined
    function onKey(ev) {
      const node = containerRef.current
      if (ev.key === 'Escape') {
        ev.stopPropagation()
        ev.preventDefault()
        onClose?.()
        return
      }
      if (ev.key !== 'Tab' || !node) return
      const focusable = focusableIn(node)
      if (focusable.length === 0) {
        // Nothing to land on inside: keep focus from escaping anyway.
        ev.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const at = document.activeElement
      const inside = node.contains(at)
      if (!inside) {
        ev.preventDefault()
        ;(ev.shiftKey ? last : first).focus()
      } else if (ev.shiftKey && at === first) {
        ev.preventDefault()
        last.focus()
      } else if (!ev.shiftKey && at === last) {
        ev.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [active, onClose, containerRef])
}
