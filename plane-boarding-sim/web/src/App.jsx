/**
 * Boots the engine (real or fixture — see lib/engineBridge.js) and mounts the
 * store around the shell. Nothing else lives here on purpose.
 */
import { useEffect, useState } from 'react'
import { loadEngine } from './lib/engineBridge.js'
import { StoreProvider } from './state/StoreProvider.jsx'
import { AppShell } from './app/AppShell.jsx'
import { ErrorBoundary } from './app/ErrorBoundary.jsx'
import './App.css'

/**
 * Drop whatever the link is carrying and reload with plain defaults.
 *
 * The only state that can survive a reload and keep breaking the app is the
 * hash, so this is the whole recovery: clear it, then reload.
 */
function startClean() {
  try {
    window.location.hash = ''
    window.location.reload()
  } catch {
    /* nothing else to try; the message stays on screen */
  }
}

export default function App() {
  const [engine, setEngine] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    loadEngine()
      .then((mod) => alive && setEngine(mod))
      .catch((err) => alive && setError(err?.message || String(err)))
    return () => {
      alive = false
    }
  }, [])

  if (error) {
    return (
      <div className="boot boot--error">
        <p>Could not load the simulation engine.</p>
        <p className="boot__detail">{error}</p>
      </div>
    )
  }

  if (!engine) {
    return (
      <div className="boot" role="status">
        <span className="boot__mark" aria-hidden="true" />
        <p>Spooling up…</p>
      </div>
    )
  }

  return (
    // Defence in depth. Everything a shared link can say is validated before
    // it is used, but a config arriving from a URL is somebody else's JSON and
    // the failure mode without a boundary here is a blank page.
    <ErrorBoundary
      label="Boarding Lab"
      recovery={
        <p>
          The scenario in this link could not be loaded.{' '}
          <button type="button" className="linkbtn" onClick={startClean}>
            Start from a clean scenario
          </button>
        </p>
      }
    >
      <StoreProvider engine={engine}>
        <AppShell />
      </StoreProvider>
    </ErrorBoundary>
  )
}
