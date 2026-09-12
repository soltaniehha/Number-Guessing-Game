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
          {/*
            Dragging the range while "Auto" is ticked used to return early and
            silently snap back — the control accepted the gesture and did
            nothing with it. On bin capacity, the highest-leverage parameter in
            the model (1 bag per row-side is 26:11 against 16:09 at 10), that
            is the single worst place in the panel to swallow an interaction.
            Moving it now TAKES the parameter over: Auto unticks and the value
            the user dragged to is the value. Ticking Auto again hands it back.
          */}
          <input
            id={id}
            className="slider"
            type="range"
            min={min}
            max={max}
            step={step}
            value={effective ?? min}
            aria-disabled={disabled || undefined}
            aria-describedby={describedBy}
            aria-valuetext={spoken}
            onChange={(e) => {
              if (disabled) return
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
