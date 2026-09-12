import { useStore } from '../state/StoreProvider.jsx'

const MODES = [
  { id: 'cabin', label: 'Cabin', key: '1' },
  { id: 'analytics', label: 'Analytics', key: '2' },
  { id: 'compare', label: 'Compare', key: '3' },
]

export function Header() {
  const { mode, setMode, run, busy, batch, theme, toggleTheme, setDrawerOpen, setModal, isMockEngine } = useStore()
  const running = busy || batch.running

  return (
    <header className="header">
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
        <h1 className="header__title">
          Boarding&nbsp;Lab
          {isMockEngine && (
            <span className="tag" title="The real engine is not wired in yet; results come from the fixture engine.">
              mock engine
            </span>
          )}
        </h1>
      </div>

      <nav className="tabs" aria-label="View mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`tab${mode === m.id ? ' is-active' : ''}`}
            aria-current={mode === m.id ? 'page' : undefined}
            onClick={() => setMode(m.id)}
            title={`${m.label} (${m.key})`}
          >
            {m.label}
            <span className="tab__key num" aria-hidden="true">{m.key}</span>
          </button>
        ))}
      </nav>

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
        <button type="button" className="btn btn--run" onClick={run} disabled={running}>
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
