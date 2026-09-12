import { Field } from './Field.jsx'

/**
 * A weight set — bag mix, party-size mix, status mix.
 *
 * The engine takes raw weights and normalises them itself, so the sliders edit
 * raw weight while the read-out shows the normalised share. A stacked bar above
 * the sliders makes the mix legible at a glance, and every row states the
 * percentage that will actually be used.
 */
export function WeightSet({ id, label, explain, value, keys, keyLabels, colors, disabled, reason, onChange }) {
  const weights = value || {}
  const total = keys.reduce((s, k) => s + (Number(weights[k]) || 0), 0)
  const share = (k) => (total > 0 ? (Number(weights[k]) || 0) / total : 0)

  const setKey = (k, raw) => onChange({ ...weights, [k]: raw })

  return (
    <Field
      id={id}
      label={label}
      value={total > 0 ? '100%' : '—'}
      explain={explain}
      disabled={disabled}
      reason={reason}
      labelFor={false}
    >
      {({ describedBy, labelId }) => (
        <div className="weights" id={id} role="group" aria-labelledby={labelId} aria-describedby={describedBy}>
          <div className="weights__bar" aria-hidden="true">
            {keys.map((k, i) => (
              <span
                key={k}
                className="weights__seg"
                style={{
                  width: `${share(k) * 100}%`,
                  background: `var(--series-${(colors?.[i] ?? i + 1)})`,
                }}
              />
            ))}
          </div>
          <div className="weights__rows">
            {keys.map((k) => (
              <div className="weights__row" key={k}>
                <label className="weights__name" htmlFor={`${id}-${k}`}>
                  {keyLabels?.[k] ?? k}
                </label>
                <input
                  id={`${id}-${k}`}
                  className="slider slider--mini"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={Number(weights[k]) || 0}
                  aria-disabled={disabled || undefined}
                  aria-describedby={describedBy}
                  aria-valuetext={`${(share(k) * 100).toFixed(0)} percent`}
                  onChange={(e) => {
                    if (disabled) return
                    setKey(k, Number(e.target.value))
                  }}
                />
                <span className="weights__pct num">{total > 0 ? `${(share(k) * 100).toFixed(0)}%` : '—'}</span>
              </div>
            ))}
          </div>
          {total === 0 && <p className="weights__warn">Every weight is zero — give at least one a value.</p>}
        </div>
      )}
    </Field>
  )
}
