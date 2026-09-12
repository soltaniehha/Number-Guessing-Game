import { Field } from './Field.jsx'

/**
 * Enum picker. Rendered as a radiogroup so arrow keys move between options and
 * screen readers announce it as one control with N choices.
 */
export function Segmented({ id, label, explain, value, options, disabled, reason, onChange }) {
  return (
    <Field id={id} label={label} explain={explain} disabled={disabled} reason={reason}>
      {({ describedBy }) => (
        <div className="segmented" role="radiogroup" aria-label={label} aria-describedby={describedBy} id={id}>
          {options.map((opt) => {
            const optDisabled = disabled || opt.disabled
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
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
