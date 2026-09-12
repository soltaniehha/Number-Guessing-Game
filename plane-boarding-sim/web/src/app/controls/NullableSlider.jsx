import { Field } from './Field.jsx'
import { snap } from '../../lib/format.js'

/**
 * A slider whose value may be null, meaning "inherit from the airframe".
 * Used for bin capacity, which is a property of the aeroplane unless you are
 * deliberately modelling a retrofit.
 */
export function NullableSlider({
  id, label, explain, value, autoValue, autoLabel = 'Auto',
  // Where the automatic value comes from, said out loud. Bin capacity inherits
  // from the airframe; other auto values do not, and saying so wrongly is
  // worse than saying nothing.
  autoSpoken = 'taken from the airframe',
  min, max, step, format, announce, disabled, reason, onChange,
}) {
  const isAuto = value == null
  const effective = isAuto ? autoValue : value
  const shown = typeof format === 'function' ? format(effective) : String(effective)
  const said = typeof announce === 'function' ? announce(effective) : shown
  const spoken = isAuto ? `${said}, ${autoSpoken}` : said

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
            aria-disabled={disabled || isAuto || undefined}
            aria-describedby={describedBy}
            aria-valuetext={spoken}
            onChange={(e) => {
              if (disabled || isAuto) return
              onChange(snap(Number(e.target.value), step))
            }}
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={isAuto}
              aria-disabled={disabled || undefined}
              onChange={(e) => {
                if (disabled) return
                onChange(e.target.checked ? null : autoValue)
              }}
            />
            <span>{autoLabel}</span>
          </label>
        </div>
      )}
    </Field>
  )
}
