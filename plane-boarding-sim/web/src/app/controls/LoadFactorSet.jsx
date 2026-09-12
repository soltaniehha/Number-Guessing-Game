import { Field } from './Field.jsx'

/**
 * The points on the load-factor sweep: a checkbox per candidate load factor.
 *
 * Plain checkboxes in a labelled group, so the whole set is reachable and
 * operable from the keyboard and announced as one control. At least one point
 * must stay selected — a sweep with no axis is not a sweep — and the last one
 * standing is `aria-disabled` rather than `disabled`, so the reason stays
 * readable (see controls/Toggle.jsx).
 */
export function LoadFactorSet({ id, label, explain, value, points, disabled, reason, onChange }) {
  const selected = Array.isArray(value) ? value : []
  const lockId = `${id}-lock`
  const isLast = selected.length === 1

  const toggle = (point) => {
    if (disabled) return
    const on = selected.includes(point)
    if (on && isLast) return
    const next = on ? selected.filter((p) => p !== point) : [...selected, point]
    onChange(next.sort((a, b) => a - b))
  }

  return (
    <Field
      id={id}
      label={label}
      value={`${selected.length} ${selected.length === 1 ? 'point' : 'points'}`}
      explain={explain}
      disabled={disabled}
      reason={reason}
      labelFor={false}
    >
      {({ describedBy, labelId }) => (
        <div className="chips chips--points" id={id} role="group" aria-labelledby={labelId} aria-describedby={describedBy}>
          {points.map((point) => {
            const on = selected.includes(point)
            const locked = on && isLast
            const pct = `${Math.round(point * 100)}%`
            return (
              <label key={point} className={`chip${on ? ' is-on' : ''}`} title={locked ? 'A sweep needs at least one load factor.' : `${pct} full`}>
                <input
                  type="checkbox"
                  checked={on}
                  aria-disabled={disabled || locked || undefined}
                  aria-describedby={locked ? lockId : undefined}
                  onChange={() => toggle(point)}
                />
                <span className="num">{pct}</span>
              </label>
            )
          })}
          {isLast && (
            <p className="field__help" id={lockId}>
              A sweep needs at least one load factor.
            </p>
          )}
        </div>
      )}
    </Field>
  )
}
