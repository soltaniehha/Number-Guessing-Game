import { useRef } from 'react'
import { useDialogFocus } from './focusTrap.js'

/**
 * A small focus-trapping dialog. Escape closes, focus returns to the opener.
 *
 * All of the focus behaviour lives in `useDialogFocus`; see the note there
 * about why the mount effect and the key listener must be separate. Callers
 * should still hand this a `useCallback`-stable `onClose` — the split effect
 * makes an unstable one harmless rather than catastrophic, and belt and braces
 * is the right amount of clothing for a keyboard trap.
 */
export function Modal({ title, onClose, children, footer }) {
  const ref = useRef(null)
  useDialogFocus({ containerRef: ref, onClose })

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
