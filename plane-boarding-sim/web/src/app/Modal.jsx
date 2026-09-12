import { useEffect, useRef } from 'react'

/** A small focus-trapping dialog. Escape closes, focus returns to the opener. */
export function Modal({ title, onClose, children, footer }) {
  const ref = useRef(null)
  const opener = useRef(null)

  useEffect(() => {
    opener.current = document.activeElement
    const node = ref.current
    node?.querySelector('[data-autofocus], button, textarea, input')?.focus()

    function onKey(ev) {
      if (ev.key === 'Escape') {
        ev.stopPropagation()
        onClose()
        return
      }
      if (ev.key !== 'Tab' || !node) return
      const focusable = node.querySelectorAll('button, textarea, input, select, a[href], [tabindex]:not([tabindex="-1"])')
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault()
        last.focus()
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (opener.current instanceof HTMLElement) opener.current.focus()
    }
  }, [onClose])

  return (
    <div className="modal__scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="modal__head">
          <h2 className="modal__title">{title}</h2>
          <button type="button" className="btn btn--icon" onClick={onClose} aria-label="Close dialog">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2 2 L12 12 M12 2 L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  )
}
