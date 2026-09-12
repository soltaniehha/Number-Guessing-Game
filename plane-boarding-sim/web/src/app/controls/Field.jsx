/**
 * The frame every control sits in: name on the left, live value on the right,
 * the control itself, then one line of plain English underneath.
 */
export function Field({ id, label, value, explain, disabled, reason, children, inline = false, labelFor = true }) {
  const describedBy = explain ? `${id}-help` : undefined
  const labelId = `${id}-label`
  return (
    <div
      className={`field${disabled ? ' is-disabled' : ''}${inline ? ' field--inline' : ''}`}
      title={disabled ? reason : undefined}
    >
      <div className="field__head">
        {labelFor ? (
          <label className="field__label" htmlFor={id} id={labelId}>
            {label}
          </label>
        ) : (
          // Radio groups and composite controls are not labelable elements, so
          // they reference this by id instead of being wrapped by a <label>.
          <span className="field__label" id={labelId}>
            {label}
          </span>
        )}
        {value != null && <span className="field__value num">{value}</span>}
      </div>
      <div className="field__control">{children({ describedBy, labelId })}</div>
      {explain && (
        <p className="field__help" id={describedBy}>
          {disabled && reason ? reason : explain}
        </p>
      )}
    </div>
  )
}

/** A named group of related controls inside a section. */
export function FieldGroup({ title, children }) {
  return (
    <div className="fieldgroup">
      {title && <h4 className="fieldgroup__title">{title}</h4>}
      {children}
    </div>
  )
}
