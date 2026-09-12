import { Field } from './Field.jsx'
import { snap } from '../../lib/format.js'

/**
 * A slider whose value may be null, meaning "inherit from the airframe".
 * Used for bin capacity, which is a property of the aeroplane unless you are
 * deliberately modelling a retrofit.
 */
export function NullableSlider({
  id, label, explain, value, autoValue, autoLabel = 'Auto', min, max, step, format, disabled, reason, onChange,
}) {
  const isAuto = value == null
  const effective = isAuto ? autoValue : value
  const shown = typeof format === 'function' ? format(effective) : String(effective)

  return (
    <Field
      id={id}
      label={label}
      value={isAuto ? `${shown} \u00b7 auto` : shown}
      explain={explain}
      disabled={disabled}
      reason={reason}
    >
      {({ describedBy }) => (
        <div className="nullable">
          <input
            id={id}
            className="slider"
            type="range"
            min={min}
            max={max}
            step={step}
            value={effective ?? min}
            disabled={disabled || isAuto}
            aria-describedby={describedBy}
            aria-valuetext={shown}
            onChange={(e) => onChange(snap(Number(e.target.value), step))}
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={isAuto}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked ? null : autoValue)}
            />
            <span>{autoLabel}</span>
          </label>
        </div>
      )}
    </Field>
  )
}
