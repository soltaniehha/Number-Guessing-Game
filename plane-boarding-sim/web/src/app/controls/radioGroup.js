/**
 * The one radiogroup keyboard implementation.
 *
 * A `role="radiogroup"` whose children are `role="radio"` owes the keyboard two
 * things: the whole group is a single tab stop (roving tabindex — exactly one
 * child has `tabIndex={0}`), and the arrow keys move the selection between the
 * children. Without both it is a row of buttons wearing a radiogroup's clothes:
 * N tab stops and inert arrows.
 */

/**
 * @param {KeyboardEvent} ev        the React keydown event on the group
 * @param {Array<{value: *, disabled?: boolean}>} options  in visual order
 * @param {*} value                 the currently selected value
 * @param {(next: *) => void} onChange
 */
export function radioGroupKeyDown(ev, options, value, onChange) {
  const step =
    ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0
  const jump = ev.key === 'Home' ? 'first' : ev.key === 'End' ? 'last' : null
  if (!step && !jump) return

  const live = options.filter((o) => !o.disabled)
  if (live.length === 0) return
  if (step && live.length < 2) return

  ev.preventDefault()
  const at = Math.max(0, live.findIndex((o) => o.value === value))
  const next = jump === 'first' ? live[0] : jump === 'last' ? live[live.length - 1] : live[(at + step + live.length) % live.length]
  if (!next || next.value === value) {
    ev.currentTarget.querySelector(`[data-value="${next?.value ?? value}"]`)?.focus()
    return
  }
  onChange(next.value)
  ev.currentTarget.querySelector(`[data-value="${next.value}"]`)?.focus()
}

/** Roving tabindex: the selected option is the group's single tab stop. */
export function rovingTabIndex(options, value, optionValue) {
  const live = options.filter((o) => !o.disabled)
  const selected = live.some((o) => o.value === value) ? value : live[0]?.value
  return optionValue === selected ? 0 : -1
}
