import { Field } from './Field.jsx'

const FAMILY_ORDER = ['commercial', 'outside-in', 'optimal', 'hybrid', 'zone', 'open', 'experimental', 'baseline']
const FAMILY_LABEL = {
  baseline: 'Baseline',
  zone: 'Zone schemes',
  'outside-in': 'Outside-in',
  optimal: 'Optimal orderings',
  hybrid: 'Hybrid',
  commercial: 'Commercial / revenue',
  open: 'Open seating',
  experimental: 'Experimental',
}

/** Strategy picker with the strategy's own description printed underneath. */
export function StrategyPicker({ id, label, explain, value, strategies, onChange }) {
  const list = Object.values(strategies)
  const current = strategies[value]
  const families = FAMILY_ORDER.filter((f) => list.some((s) => s.family === f))
  const orphans = list.filter((s) => !FAMILY_ORDER.includes(s.family))

  return (
    <Field id={id} label={label} explain={explain}>
      {({ describedBy }) => (
        <>
          <select
            id={id}
            className="input input--select"
            value={value}
            aria-describedby={describedBy}
            onChange={(e) => onChange(e.target.value)}
          >
            {families.map((f) => (
              <optgroup key={f} label={FAMILY_LABEL[f] || f}>
                {list
                  .filter((s) => s.family === f)
                  .map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name}
                    </option>
                  ))}
              </optgroup>
            ))}
            {orphans.length > 0 && (
              <optgroup label="Other">
                {orphans.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {current?.description && <p className="prose prose--strategy">{current.description}</p>}
        </>
      )}
    </Field>
  )
}
