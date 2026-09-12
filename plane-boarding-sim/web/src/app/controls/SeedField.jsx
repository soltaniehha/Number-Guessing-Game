import { Field } from './Field.jsx'

/** Seed entry with a dice button. The seed is what makes a run reproducible. */
export function SeedField({ id, label, explain, value, onChange, onRandomise }) {
  return (
    <Field id={id} label={label} explain={explain}>
      {({ describedBy }) => (
        <div className="seed">
          <input
            id={id}
            className="input input--seed num"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={value}
            aria-describedby={describedBy}
            onChange={(e) => {
              const n = Number(e.target.value)
              onChange(Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0)
            }}
          />
          <button type="button" className="btn btn--icon" onClick={onRandomise} title="Randomise the seed" aria-label="Randomise the seed">
            <DiceIcon />
          </button>
        </div>
      )}
    </Field>
  )
}

function DiceIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="3" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="5.2" cy="5.2" r="1.15" fill="currentColor" />
      <circle cx="10.8" cy="5.2" r="1.15" fill="currentColor" />
      <circle cx="8" cy="8" r="1.15" fill="currentColor" />
      <circle cx="5.2" cy="10.8" r="1.15" fill="currentColor" />
      <circle cx="10.8" cy="10.8" r="1.15" fill="currentColor" />
    </svg>
  )
}
