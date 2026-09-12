import { Field } from './Field.jsx'

/*
 * A control that is irrelevant right now is `aria-disabled`, never `disabled`.
 * `disabled` takes it out of the tab order, and the field's help line has by
 * then been replaced by the *reason* it is irrelevant — so `disabled` is
 * exactly the attribute that makes the explanation unreachable to the people
 * who most need it. aria-disabled announces the state, keeps the control
 * focusable so its aria-describedby reason can be read, and the handler
 * refuses the change.
 */

export function Toggle({ id, label, explain, value, disabled, reason, onChange }) {
  return (
    <Field id={id} label={label} explain={explain} disabled={disabled} reason={reason} inline>
      {({ describedBy }) => (
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={Boolean(value)}
          aria-describedby={describedBy}
          className={`switch${value ? ' is-on' : ''}`}
          aria-disabled={disabled || undefined}
          onClick={disabled ? undefined : () => onChange(!value)}
        >
          <span className="switch__track">
            <span className="switch__thumb" />
          </span>
          <span className="switch__state">{value ? 'On' : 'Off'}</span>
        </button>
      )}
    </Field>
  )
}
