import { Field } from './Field.jsx'

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
          disabled={disabled}
          onClick={() => onChange(!value)}
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
