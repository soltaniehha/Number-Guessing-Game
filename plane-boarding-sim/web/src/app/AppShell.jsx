/** Layout: header, control panel (a drawer when narrow), viewport, status bar. */
import { useEffect } from 'react'
import { useStore } from '../state/StoreProvider.jsx'
import { useKeyboardShortcuts } from '../state/useKeyboardShortcuts.js'
import { Header } from './Header.jsx'
import { ControlPanel } from './ControlPanel.jsx'
import { StatusBar } from './StatusBar.jsx'
import { CabinMode } from './modes/CabinMode.jsx'
import { AnalyticsMode } from './modes/AnalyticsMode.jsx'
import { CompareMode } from './modes/CompareMode.jsx'
import { PasteDialog } from './PasteDialog.jsx'
import { HelpDialog } from './HelpDialog.jsx'

export function AppShell() {
  const { mode, drawerOpen, setDrawerOpen, modal, toast } = useStore()
  useKeyboardShortcuts()

  // Choosing a mode on a phone should not leave the drawer covering the result.
  useEffect(() => {
    setDrawerOpen(false)
  }, [mode, setDrawerOpen])

  return (
    <div className="app">
      <Header />
      <div className="app__body">
        {drawerOpen && <div className="scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
        <aside className={`app__panel${drawerOpen ? ' is-open' : ''}`} aria-label="Simulation controls">
          <div className="app__panelhead">
            <span className="app__paneltitle">Controls</span>
            <button type="button" className="btn btn--icon" onClick={() => setDrawerOpen(false)} aria-label="Close controls">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path d="M2 2 L12 12 M12 2 L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <ControlPanel />
        </aside>
        <main className="app__main">
          {mode === 'cabin' && <CabinMode />}
          {mode === 'analytics' && <AnalyticsMode />}
          {mode === 'compare' && <CompareMode />}
        </main>
      </div>
      <StatusBar />
      {modal?.kind === 'paste' && <PasteDialog initial={modal.initial} />}
      {modal?.kind === 'help' && <HelpDialog />}
      {toast && (
        <div className={`toast toast--${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  )
}
