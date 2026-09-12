import { useId } from 'react'

/** A collapsible panel section. A real button with aria-expanded, as specified. */
export function Section({ id, title, hint, badge, open, onToggle, children }) {
  const panelId = useId()
  return (
    <section className={`section${open ? ' is-open' : ''}`}>
      <h3 className="section__heading">
        <button
          type="button"
          className="section__toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onToggle(id)}
        >
          <Chevron open={open} />
          <span className="section__title">{title}</span>
          {badge != null && <span className="section__badge num">{badge}</span>}
        </button>
      </h3>
      <div id={panelId} className="section__body" hidden={!open}>
        {hint && <p className="section__hint">{hint}</p>}
        {children}
      </div>
    </section>
  )
}

function Chevron({ open }) {
  return (
    <svg className={`chev${open ? ' is-open' : ''}`} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2.5 1 L7 5 L2.5 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
