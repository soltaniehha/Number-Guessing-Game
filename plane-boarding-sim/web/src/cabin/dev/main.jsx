import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../theme.css'
import DevHarness from './DevHarness.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DevHarness />
  </StrictMode>,
)
