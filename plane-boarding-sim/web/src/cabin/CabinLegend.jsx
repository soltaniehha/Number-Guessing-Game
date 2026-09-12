/**
 * The key that makes the cabin readable at a glance.
 *
 * The state glyphs are the same four shapes the canvas paints, so the legend
 * is a literal sample rather than an approximation — which is what makes the
 * view colour-blind safe: shape carries the meaning, colour reinforces it.
 */

import './cabin.css'
import { STATE } from './playback.js'
import { classToken, stateToken } from './tokens.js'

const STATE_ITEMS = [
  { state: STATE.QUEUED, label: 'Queued', glyph: 'hollow' },
  { state: STATE.WALKING, label: 'Walking', glyph: 'trail' },
  { state: STATE.STOWING, label: 'Stowing', glyph: 'ring' },
  { state: STATE.SEATED, label: 'Seated', glyph: 'filled' },
]

export default function CabinLegend({
  replay,
  counts = null,
  showCounts = true,
  showClasses = true,
  className = '',
}) {
  const cabins = replay && showClasses ? dedupeClasses(replay.aircraft.cabins) : []

  return (
    <div className={`cab-legend ${className}`.trim()}>
      <div className="cab-legend__group">
        <span className="cab-legend__label">State</span>
        {STATE_ITEMS.map((item) => (
          <span className="cab-legend__item" key={item.label}>
            <StateGlyph glyph={item.glyph} state={item.state} />
            {item.label}
            {showCounts && counts ? (
              <span className="cab-legend__count">
                {item.state === STATE.STOWING
                  ? counts[STATE.STOWING] + counts[STATE.SHUFFLING]
                  : counts[item.state]}
              </span>
            ) : null}
          </span>
        ))}
      </div>

      {cabins.length ? (
        <div className="cab-legend__group">
          <span className="cab-legend__label">Cabin</span>
          {cabins.map((cabin) => (
            <span className="cab-legend__item" key={cabin.classKey}>
              <i
                className="cab-legend__chip"
                style={{ background: `var(--${classToken(cabin.classKey)})` }}
              />
              {cabin.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** The exact four marks used on the canvas, at legend scale. */
function StateGlyph({ glyph, state }) {
  const color = `var(--${stateToken(state)})`
  return (
    <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true" style={{ flex: 'none' }}>
      {glyph === 'trail' ? (
        <line
          x1="4"
          y1="6"
          x2="13"
          y2="6"
          stroke={color}
          strokeWidth="3.2"
          strokeLinecap="round"
          opacity="0.3"
        />
      ) : null}
      {glyph === 'ring' ? (
        <circle cx="14" cy="6" r="5" fill="none" stroke={color} strokeWidth="1.3" />
      ) : null}
      <circle
        cx="14"
        cy="6"
        r={glyph === 'hollow' ? 3.2 : 3.4}
        fill={glyph === 'hollow' ? 'none' : color}
        stroke={color}
        strokeWidth={glyph === 'hollow' ? 1.6 : 0}
      />
    </svg>
  )
}

function dedupeClasses(cabins) {
  const seen = new Set()
  const out = []
  for (const cabin of cabins || []) {
    if (seen.has(cabin.classKey)) continue
    seen.add(cabin.classKey)
    out.push(cabin)
  }
  return out
}
