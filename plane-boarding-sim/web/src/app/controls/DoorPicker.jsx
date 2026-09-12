import { Field } from './Field.jsx'

/**
 * Door toggles, generated from the selected aircraft's door list and rebuilt
 * whenever the aircraft changes. The last open door cannot be closed — an
 * aircraft nobody can get into is not a scenario.
 */
export function DoorPicker({ id, label, explain, aircraft, enabled, onToggle }) {
  const doors = aircraft?.doors || []
  const onCount = doors.filter((d) => enabled.includes(d.id)).length
  const lockId = `${id}-lock`
  const locked = onCount === 1

  return (
    <Field id={id} label={label} value={`${onCount}/${doors.length}`} explain={explain} labelFor={false}>
      {({ describedBy, labelId }) => (
        <div className="doors" id={id} role="group" aria-labelledby={labelId} aria-describedby={describedBy}>
          {doors.map((door) => {
            const on = enabled.includes(door.id)
            const isLastOpen = on && onCount === 1
            return (
              <label
                key={door.id}
                className={`door${on ? ' is-on' : ''}${isLastOpen ? ' is-locked' : ''}`}
                title={isLastOpen ? 'At least one door must stay open.' : door.name}
              >
                {/* aria-disabled, not disabled: `disabled` is what made the
                    "at least one door must stay open" explanation impossible
                    to reach with a keyboard. */}
                <input
                  type="checkbox"
                  className="door__input"
                  checked={on}
                  aria-disabled={isLastOpen || undefined}
                  aria-describedby={isLastOpen ? lockId : undefined}
                  onChange={() => {
                    if (isLastOpen) return
                    onToggle(door.id)
                  }}
                />
                <span className="door__id num">{door.id}</span>
                <span className="door__meta">
                  {door.kind === 'airstair' ? 'Airstair' : 'Jet bridge'}
                  {door.rowBefore == null ? ' · aft' : ` · fwd of row ${door.rowBefore}`}
                </span>
              </label>
            )
          })}
          {locked && (
            <p className="field__help" id={lockId}>
              At least one door must stay open.
            </p>
          )}
        </div>
      )}
    </Field>
  )
}
