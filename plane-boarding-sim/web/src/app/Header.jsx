import { useStore } from '../state/StoreProvider.jsx'

const MODES = [
  { id: 'cabin', label: 'Cabin', key: '1' },
  { id: 'analytics', label: 'Analytics', key: '2' },
  { id: 'compare', label: 'Compare', key: '3' },
]

/** The id of the tab that controls the viewport, shared with AppShell. */
export const tabId = (mode) => `viewtab-${mode}`
export const TABPANEL_ID = 'app-tabpanel'

export function Header({ inert }) {
  const { mode, setMode, run, busy, batch, theme, toggleTheme, setDrawerOpen, setModal, isMockEngine } = useStore()
  const running = busy || batch.running

  /** A tablist is one tab stop; arrow keys move between the tabs inside it. */
  const onTabKeyDown = (ev) => {
    const step =
      ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0
    const jump = ev.key === 'Home' ? 0 : ev.key === 'End' ? MODES.length - 1 : null
    if (!step && jump == null) return
    ev.preventDefault()
    const at = Math.max(0, MODES.findIndex((m) => m.id === mode))
    const next = jump != null ? MODES[jump] : MODES[(at + step + MODES.length) % MODES.length]
    setMode(next.id)
    ev.currentTarget.querySelector(`[data-mode="${next.id}"]`)?.focus()
  }

  return (
    <header className="header" inert={inert}>
      <div className="header__brand">
        <button
          type="button"
          className="btn btn--icon header__drawer"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open controls"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <PlaneMark />
        {/* The tag is a sibling, not a child: inside the <h1> the page's only
            heading announced as "Boarding Lab MOCK ENGINE". */}
        <h1 className="header__title">Boarding&nbsp;Lab</h1>
        {isMockEngine && (
          <span className="tag" title="The real engine is not wired in yet; results come from the fixture engine.">
            mock engine
          </span>
        )}
      </div>

      <div className="tabs" role="tablist" aria-label="View mode" onKeyDown={onTabKeyDown}>
        {MODES.map((m) => (
          <button
            key={m.id}
            id={tabId(m.id)}
            type="button"
            role="tab"
            data-mode={m.id}
            aria-selected={mode === m.id}
            aria-controls={TABPANEL_ID}
            tabIndex={mode === m.id ? 0 : -1}
            className={`tab${mode === m.id ? ' is-active' : ''}`}
            onClick={() => setMode(m.id)}
            title={`${m.label} (${m.key})`}
          >
            {m.label}
            <span className="tab__key num" aria-hidden="true">{m.key}</span>
          </button>
        ))}
      </div>

      <div className="header__actions">
        <button
          type="button"
          className="btn btn--icon"
          onClick={() => setModal({ kind: 'help' })}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="1.5" y="3.5" width="13" height="9" rx="2" stroke="currentColor" strokeWidth="1.3" fill="none" />
            <path d="M4 6.5h1M7 6.5h1M10 6.5h2M4 9.5h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="btn btn--icon"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        {/* aria-disabled, not disabled: this is the app's primary action, and a
            control that removes itself from the tab order while you are
            standing on it drops focus to <body>. */}
        <button
          type="button"
          className="btn btn--run"
          onClick={running ? undefined : run}
          aria-disabled={running || undefined}
        >
          <span className="btn__glyph" aria-hidden="true">{running ? <Spinner /> : <PlayIcon />}</span>
          {running ? 'Running…' : 'Run'}
        </button>
      </div>
    </header>
  )
}

function PlaneMark() {
  return (
    <svg className="mark" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2c1 0 1.6 1.1 1.6 2.6v4.1l7.4 4.3v2.1l-7.4-2.2v4.4l2.3 1.7v1.6L12 19.6l-3.9 1-.0-1.6 2.3-1.7v-4.4L3 15.1V13l7.4-4.3V4.6C10.4 3.1 11 2 12 2Z"
        fill="currentColor"
      />
    </svg>
  )
}

const PlayIcon = () => (
  <svg width="11" height="12" viewBox="0 0 11 12" aria-hidden="true">
    <path d="M1 1.2 L10 6 L1 10.8 Z" fill="currentColor" />
  </svg>
)

const Spinner = () => (
  <svg className="spinner" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeOpacity=".3" />
    <path d="M6 1.4 A4.6 4.6 0 0 1 10.6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

const SunIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.4" fill="none" />
    <path d="M8 .8v1.8M8 13.4v1.8M.8 8h1.8M13.4 8h1.8M2.9 2.9l1.3 1.3M11.8 11.8l1.3 1.3M13.1 2.9l-1.3 1.3M4.2 11.8l-1.3 1.3"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

const MoonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M13.2 9.6A5.8 5.8 0 0 1 6.4 2.8a5.8 5.8 0 1 0 6.8 6.8Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
)
