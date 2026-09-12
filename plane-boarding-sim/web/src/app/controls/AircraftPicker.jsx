import { Field } from './Field.jsx'
import { radioGroupKeyDown, rovingTabIndex } from './radioGroup.js'

export function AircraftPicker({ id, label, explain, value, aircraftList, onChange }) {
  const current = aircraftList.find((a) => a.id === value)
  // A radiogroup is one tab stop with arrow keys, not N buttons. Same
  // implementation as Segmented — see controls/radioGroup.js.
  const options = aircraftList.map((a) => ({ value: a.id }))
  const onKeyDown = (ev) => radioGroupKeyDown(ev, options, value, onChange)
  return (
    <Field id={id} label={label} value={current ? `${current.seatCount} seats` : ''} explain={explain} labelFor={false}>
      {({ describedBy, labelId }) => (
        <>
          <div
            className="cards"
            role="radiogroup"
            aria-labelledby={labelId}
            aria-describedby={describedBy}
            id={id}
            onKeyDown={onKeyDown}
          >
            {aircraftList.map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                data-value={a.id}
                tabIndex={rovingTabIndex(options, value, a.id)}
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
