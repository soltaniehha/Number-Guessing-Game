import { Field } from './Field.jsx'
import { snap } from '../../lib/format.js'

export function Slider({ id, label, explain, value, min, max, step, format, disabled, reason, onChange }) {
  const shown = typeof format === 'function' ? format(value) : String(value)
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
          disabled={disabled}
          aria-describedby={describedBy}
          aria-valuetext={shown}
          onChange={(e) => onChange(snap(Number(e.target.value), step))}
        />
      )}
    </Field>
  )
}
