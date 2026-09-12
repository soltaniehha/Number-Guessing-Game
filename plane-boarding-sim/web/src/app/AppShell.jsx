/** Layout: header, control panel (a drawer when narrow), viewport, status bar. */
import { useCallback, useEffect, useRef } from 'react'
import { useStore } from '../state/StoreProvider.jsx'
import { useKeyboardShortcuts } from '../state/useKeyboardShortcuts.js'
import { useDialogFocus } from './focusTrap.js'
import { useMediaQuery } from './useMediaQuery.js'
import { Header, TABPANEL_ID, tabId } from './Header.jsx'
import { ControlPanel } from './ControlPanel.jsx'
import { StatusBar } from './StatusBar.jsx'
import { CabinMode } from './modes/CabinMode.jsx'
import { AnalyticsMode } from './modes/AnalyticsMode.jsx'
import { CompareMode } from './modes/CompareMode.jsx'
import { PasteDialog } from './PasteDialog.jsx'
import { HelpDialog } from './HelpDialog.jsx'

/** Below this width the control panel is a drawer, and a drawer is a dialog. */
export const DRAWER_QUERY = '(max-width: 940px)'

export function AppShell() {
  const { mode, drawerOpen, setDrawerOpen, modal, toast } = useStore()
  const isNarrow = useMediaQuery(DRAWER_QUERY)
  const panelRef = useRef(null)
  useKeyboardShortcuts()

  const closeDrawer = useCallback(() => setDrawerOpen(false), [setDrawerOpen])

  // Choosing a mode on a phone should not leave the drawer covering the result.
  useEffect(() => {
    setDrawerOpen(false)
  }, [mode, setDrawerOpen])

  // Defence in depth. The drawer only exists below 940px; if anything ever
  // opens it at desktop width — a stray hamburger, a resize, a restored state —
  // the scrim would cover the page with nothing to dismiss it. Close it.
  useEffect(() => {
    if (!isNarrow && drawerOpen) setDrawerOpen(false)
  }, [isNarrow, drawerOpen, setDrawerOpen])

  // ...and Escape closes it regardless of width, so the keyboard is never stuck.
  useEffect(() => {
    if (!drawerOpen) return undefined
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation()
        setDrawerOpen(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [drawerOpen, setDrawerOpen])

  // While it is a drawer it is a modal dialog: focus moves in, Tab cannot
  // leave, Escape closes, and focus goes back to the button that opened it.
  const drawerIsDialog = drawerOpen && isNarrow
  useDialogFocus({
    containerRef: panelRef,
    onClose: closeDrawer,
    active: drawerIsDialog,
    returnFocusTo: () => document.querySelector('.header__drawer'),
  })

  const behind = drawerIsDialog || undefined

  return (
    <div className="app">
      <Header inert={behind} />
      <div className="app__body">
        {drawerOpen && <div className="scrim" onClick={closeDrawer} aria-hidden="true" />}
        <aside
          className={`app__panel${drawerOpen ? ' is-open' : ''}`}
          ref={panelRef}
          role={drawerIsDialog ? 'dialog' : undefined}
          aria-modal={drawerIsDialog ? 'true' : undefined}
          aria-label="Simulation controls"
        >
          <div className="app__panelhead">
            <span className="app__paneltitle">Controls</span>
            <button type="button" className="btn btn--icon" onClick={closeDrawer} aria-label="Close controls">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path d="M2 2 L12 12 M12 2 L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <ControlPanel />
        </aside>
        <main className="app__main" inert={behind}>
          {/* The viewport is the panel the header's tablist controls. It is a
              child of <main> rather than <main> itself so the page keeps its
              main landmark as well as its tabpanel. */}
          <div className="app__tabpanel" id={TABPANEL_ID} role="tabpanel" aria-labelledby={tabId(mode)}>
            {mode === 'cabin' && <CabinMode />}
            {mode === 'analytics' && <AnalyticsMode />}
            {mode === 'compare' && <CompareMode />}
          </div>
        </main>
      </div>
      <StatusBar inert={behind} />
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
