/**
 * Standalone dev page for the cabin view.
 *
 *   npm run dev  ->  http://localhost:5173/src/cabin/dev/index.html
 *
 * Runs entirely off `__fixtures__/makeReplay.js`, so it needs no engine and no
 * app shell. Use it to eyeball both aircraft, both orientations and both
 * themes before wiring the real simulation in.
 */

import { useEffect, useMemo, useState } from 'react'
import './dev.css'
import CabinView from '../CabinView.jsx'
import CabinLegend from '../CabinLegend.jsx'
import PlaybackControls from '../PlaybackControls.jsx'
import { usePlayback } from '../usePlayback.js'
import { replayDuration, stateTally, frameIntervalOf } from '../playback.js'
import { makeReplay } from '../__fixtures__/makeReplay.js'

const AIRCRAFT = [
  ['single', 'A320neo · 3-3'],
  ['twin', '777-300ER · 3-4-3'],
]
const STRATEGIES = [
  ['back_to_front', 'Back-to-front'],
  ['wilma', 'WilMA'],
  ['random', 'Random'],
]

export default function DevHarness() {
  const [aircraft, setAircraft] = useState('single')
  const [strategy, setStrategy] = useState('back_to_front')
  const [loadFactor, setLoadFactor] = useState(0.92)
  const [showQueue, setShowQueue] = useState(true)
  const [showHeat, setShowHeat] = useState(true)
  const [orientation, setOrientation] = useState('auto')
  const [theme, setTheme] = useState('dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const replay = useMemo(
    () => makeReplay({ aircraft, strategy, loadFactor, seed: 20240101 }),
    [aircraft, strategy, loadFactor],
  )

  const duration = replayDuration(replay)
  const clock = usePlayback({ duration, frameInterval: frameIntervalOf(replay) })

  const counts = useMemo(
    () => stateTally(replay, Math.round(clock.t / frameIntervalOf(replay))),
    [replay, clock.t],
  )

  return (
    <div className="dev">
      <header className="dev__bar">
        <strong className="dev__title">Cabin view</strong>
        <Select label="Aircraft" value={aircraft} onChange={setAircraft} options={AIRCRAFT} />
        <Select label="Strategy" value={strategy} onChange={setStrategy} options={STRATEGIES} />
        <Select
          label="Orientation"
          value={orientation}
          onChange={setOrientation}
          options={[['auto', 'Auto'], ['horizontal', 'Horizontal'], ['vertical', 'Vertical']]}
        />
        <label className="dev__field">
          Load {Math.round(loadFactor * 100)}%
          <input
            type="range"
            min="0.4"
            max="1"
            step="0.02"
            value={loadFactor}
            onChange={(e) => setLoadFactor(Number(e.target.value))}
          />
        </label>
        <Toggle label="Queue" value={showQueue} onChange={setShowQueue} />
        <Toggle label="Heat" value={showHeat} onChange={setShowHeat} />
        <button
          type="button"
          className="dev__btn"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        >
          {theme === 'dark' ? 'Light' : 'Dark'} theme
        </button>
      </header>

      <main className="dev__stage">
        <CabinView
          replay={replay}
          tSeconds={clock.t}
          speed={clock.speed}
          playing={clock.playing}
          showQueue={showQueue}
          showHeat={showHeat}
          orientation={orientation}
          showLegend={false}
        />
      </main>

      <footer className="dev__foot">
        <PlaybackControls
          replay={replay}
          t={clock.t}
          playing={clock.playing}
          speed={clock.speed}
          onSeek={clock.setT}
          onTogglePlay={clock.toggle}
          onStep={clock.step}
          onReset={clock.reset}
          onSpeedChange={clock.setSpeed}
          enableKeyboard
        />
        <CabinLegend replay={replay} counts={counts} />
      </footer>
    </div>
  )
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="dev__field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([key, name]) => (
          <option key={key} value={key}>{name}</option>
        ))}
      </select>
    </label>
  )
}

function Toggle({ label, value, onChange }) {
  return (
    <label className="dev__field dev__field--check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}
