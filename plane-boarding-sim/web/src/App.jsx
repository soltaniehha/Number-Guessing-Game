/**
 * Boots the engine (real or fixture — see lib/engineBridge.js) and mounts the
 * store around the shell. Nothing else lives here on purpose.
 */
import { useEffect, useState } from 'react'
import { loadEngine } from './lib/engineBridge.js'
import { StoreProvider } from './state/StoreProvider.jsx'
import { AppShell } from './app/AppShell.jsx'
import './App.css'

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
    <StoreProvider engine={engine}>
      <AppShell />
    </StoreProvider>
  )
}
