import { Field } from './Field.jsx'

export function AircraftPicker({ id, label, explain, value, aircraftList, onChange }) {
  const current = aircraftList.find((a) => a.id === value)
  return (
    <Field id={id} label={label} value={current ? `${current.seatCount} seats` : ''} explain={explain} labelFor={false}>
      {({ describedBy, labelId }) => (
        <>
          <div className="cards" role="radiogroup" aria-labelledby={labelId} aria-describedby={describedBy} id={id}>
            {aircraftList.map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={a.id === value}
                className={`card${a.id === value ? ' is-active' : ''}`}
                onClick={() => onChange(a.id)}
              >
                <span className="card__title">{a.name}</span>
                <span className="card__meta num">
                  {a.seatCount} · {a.aisleCount === 2 ? 'twin aisle' : 'single aisle'}
                </span>
              </button>
            ))}
          </div>
          {current && <p className="prose">{current.description}</p>}
        </>
      )}
    </Field>
  )
}
