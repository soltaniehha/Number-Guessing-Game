import { Field } from './Field.jsx'
import { snap } from '../../lib/format.js'

/*
 * A control that is irrelevant right now is `aria-disabled`, never `disabled`.
 * `disabled` takes it out of the tab order, and the field's help line has by
 * then been replaced by the *reason* it is irrelevant — so `disabled` is
 * exactly the attribute that makes the explanation unreachable to the people
 * who most need it. aria-disabled announces the state, keeps the control
 * focusable so its aria-describedby reason can be read, and the handler
 * refuses the change.
 */

export function Slider({ id, label, explain, value, min, max, step, format, announce, disabled, reason, onChange }) {
  const shown = typeof format === 'function' ? format(value) : String(value)
  // What the eye reads and what a screen reader says are different strings:
  // "16.0s" is read out as the letter S. See controlSchema.js.
  const spoken = typeof announce === 'function' ? announce(value) : shown
  return (
    <Field id={id} label={label} value={shown} explain={explain} disabled={disabled} reason={reason}>
      {({ describedBy }) => (
        <input
          id={id}
          className="slider"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-disabled={disabled || undefined}
          aria-describedby={describedBy}
          aria-valuetext={spoken}
          onChange={(e) => {
            if (disabled) return
            onChange(snap(Number(e.target.value), step))
          }}
        />
      )}
    </Field>
  )
}
