import { Field } from './Field.jsx'

/**
 * Door toggles, generated from the selected aircraft's door list and rebuilt
 * whenever the aircraft changes. The last open door cannot be closed — an
 * aircraft nobody can get into is not a scenario.
 *
 * Only BOARDING doors are selectable. An airframe's door list also contains
 * service doors and overwing exits, and the engine refuses to board through
 * them: ticking the A320neo's `1R` produced `door(s) ["1R"] are not boarding
 * doors` on every subsequent run. Four of the A320neo's six doors were traps,
 * three of the E175's four, and eight of the 777's ten.
 *
 * They are still *shown*, greyed and with the reason, because they are real
 * doors on a real aeroplane and silently dropping half the fuselage from the
 * list is its own kind of confusing.
 */
/** The door kinds in `parity/aircraft.json` that are never boardable. */
const UNUSABLE_KIND = { service: 'Service door', overwing: 'Overwing exit' }
const kindLabel = (door) => (door.kind === 'airstair' ? 'Airstair' : 'Jet bridge')
const placeLabel = (door) => (door.rowBefore == null ? 'aft' : `fwd of row ${door.rowBefore}`)

export function DoorPicker({ id, label, explain, aircraft, enabled, onToggle }) {
  const all = aircraft?.doors || []
  const doors = all.filter((d) => d.boardable !== false)
  const other = all.filter((d) => d.boardable === false)
  const onCount = doors.filter((d) => enabled.includes(d.id)).length
  const lockId = `${id}-lock`
  const otherId = `${id}-other`
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
                  {kindLabel(door)} · {placeLabel(door)}
                </span>
              </label>
            )
          })}
          {locked && (
            <p className="field__help" id={lockId}>
              At least one door must stay open.
            </p>
          )}
          {other.length > 0 && (
            <>
              <ul className="doors__other" aria-describedby={otherId}>
                {other.map((door) => (
                  <li key={door.id} className="door door--unusable" title={door.name}>
                    <span className="door__id num">{door.id}</span>
                    <span className="door__meta">
                      {UNUSABLE_KIND[door.kind] || kindLabel(door)}
                      {' · '}
                      {placeLabel(door)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="field__help" id={otherId}>
                {other.length === 1 ? 'This door is' : `These ${other.length} doors are`} on the aircraft but cannot be
                boarded through — service doors and overwing exits are not passenger boarding doors.
              </p>
            </>
          )}
        </div>
      )}
    </Field>
  )
}
