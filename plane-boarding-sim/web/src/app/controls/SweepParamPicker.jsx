import { Field } from './Field.jsx'

/**
 * Which scenario parameter the sweep varies (chart 7's x-axis).
 *
 * The options come from the ENGINE's `SWEEPABLE` map, never from a list kept
 * here: the worker throws on a parameter outside that set, so offering one
 * would be offering a run that cannot start. A native `<select>` rather than a
 * radiogroup because there are eight of them and the panel is 320 px wide.
 *
 * Each axis's own sentence — why it is worth sweeping — is printed underneath,
 * the same way the strategy picker prints the strategy's description. That is
 * how `eliteForwardBias` gets discovered: it is the axis that turns "does
 * priority boarding cost time?" from an assertion into a curve.
 */
export function SweepParamPicker({ id, label, explain, value, axes, disabled, reason, onChange }) {
  const current = axes.find((a) => a.key === value) || axes[0]
  return (
    <Field id={id} label={label} explain={explain} disabled={disabled} reason={reason}>
      {({ describedBy }) => (
        <>
          <select
            id={id}
            className="input input--select"
            value={current ? current.key : ''}
            disabled={disabled}
            aria-describedby={describedBy}
            onChange={(e) => onChange(e.target.value)}
          >
            {axes.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
          {!disabled && current?.axis?.hint && <p className="prose prose--strategy">{current.axis.hint}</p>}
        </>
      )}
    </Field>
  )
}
