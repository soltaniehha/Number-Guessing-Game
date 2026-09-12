/** The considered blank state every mode shows before its first result. */
export function EmptyState({ title, body, action, icon }) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden="true">{icon}</div>
      <h2 className="empty__title">{title}</h2>
      <p className="empty__body">{body}</p>
      {action}
    </div>
  )
}

export const CabinGlyph = (
  <svg width="52" height="52" viewBox="0 0 52 52" fill="none" aria-hidden="true">
    <rect x="6" y="14" width="40" height="24" rx="11" stroke="currentColor" strokeWidth="1.4" />
    <path d="M6 26h40" stroke="currentColor" strokeWidth="1" strokeDasharray="2 3" />
    <circle cx="16" cy="20.5" r="2" fill="currentColor" />
    <circle cx="24" cy="20.5" r="2" fill="currentColor" opacity=".55" />
    <circle cx="32" cy="31.5" r="2" fill="currentColor" opacity=".35" />
  </svg>
)

export const ChartGlyph = (
  <svg width="52" height="52" viewBox="0 0 52 52" fill="none" aria-hidden="true">
    <path d="M9 43V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M9 43h34" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <rect x="15" y="27" width="6" height="12" fill="currentColor" opacity=".8" />
    <rect x="25" y="20" width="6" height="19" fill="currentColor" opacity=".55" />
    <rect x="35" y="31" width="6" height="8" fill="currentColor" opacity=".35" />
  </svg>
)
