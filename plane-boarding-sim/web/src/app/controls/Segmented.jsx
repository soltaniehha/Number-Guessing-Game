import { Field } from './Field.jsx'
import { radioGroupKeyDown, rovingTabIndex } from './radioGroup.js'

/**
 * Enum picker. Rendered as a radiogroup so arrow keys move between options and
 * screen readers announce it as one control with N choices.
 */
export function Segmented({ id, label, explain, value, options, disabled, reason, onChange }) {
  const onKeyDown = (ev) => radioGroupKeyDown(ev, options, value, onChange)

  return (
    <Field id={id} label={label} explain={explain} disabled={disabled} reason={reason} labelFor={false}>
      {({ describedBy, labelId }) => (
        <div
          className="segmented"
          role="radiogroup"
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          id={id}
          aria-disabled={disabled || undefined}
          onKeyDown={disabled ? undefined : onKeyDown}
        >
          {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                data-value={opt.value}
                tabIndex={rovingTabIndex(options, value, opt.value)}
                aria-checked={value === opt.value}
                // The whole control being irrelevant is aria-disabled, so the
                // reason stays readable from the focused radio. A single
                // option being illegal for this airframe is a different thing
                // and stays `disabled`: it has its own tooltip and the group
                // around it still works.
                aria-disabled={disabled || undefined}
                aria-describedby={disabled ? describedBy : undefined}
                className={`segmented__item${value === opt.value ? ' is-active' : ''}`}
                disabled={!disabled && opt.disabled}
                title={opt.disabled ? opt.reason : undefined}
                onClick={disabled || opt.disabled ? undefined : () => onChange(opt.value)}
              >
                {opt.label}
              </button>
          ))}
        </div>
      )}
    </Field>
  )
}
