import { Field } from './Field.jsx'

/**
 * Enum picker. Rendered as a radiogroup so arrow keys move between options and
 * screen readers announce it as one control with N choices.
 */
export function Segmented({ id, label, explain, value, options, disabled, reason, onChange }) {
  /** Arrow keys move between options, as a radio group should. */
  const onKeyDown = (ev) => {
    const step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    const live = options.filter((o) => !o.disabled)
    if (live.length < 2) return
    ev.preventDefault()
    const at = Math.max(0, live.findIndex((o) => o.value === value))
    const next = live[(at + step + live.length) % live.length]
    onChange(next.value)
    ev.currentTarget.querySelector(`[data-value="${next.value}"]`)?.focus()
  }

  return (
    <Field id={id} label={label} explain={explain} disabled={disabled} reason={reason} labelFor={false}>
      {({ describedBy, labelId }) => (
        <div
          className="segmented"
          role="radiogroup"
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          id={id}
          onKeyDown={disabled ? undefined : onKeyDown}
        >
          {options.map((opt) => {
            const optDisabled = disabled || opt.disabled
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                data-value={opt.value}
                tabIndex={value === opt.value ? 0 : -1}
                aria-checked={value === opt.value}
                className={`segmented__item${value === opt.value ? ' is-active' : ''}`}
                disabled={optDisabled}
                title={opt.disabled ? opt.reason : undefined}
                onClick={() => onChange(opt.value)}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      )}
    </Field>
  )
}
