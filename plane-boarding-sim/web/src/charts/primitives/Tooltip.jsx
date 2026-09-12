import { useCallback, useState } from 'react'
import { shapePath } from './palette.js'

/**
 * Hover / focus read-out.
 *
 * dataviz: the tooltip ENHANCES, it never gates — every value it shows is also
 * in the table view. Values lead and labels follow, series are keyed with a
 * short stroke rather than a filled box, and all text goes in as React text
 * nodes (never innerHTML), because series names are untrusted data.
 */
export function useTooltip() {
  const [tip, setTip] = useState(null)

  const show = useCallback((x, y, content) => {
    setTip({ x, y, content })
  }, [])

  const hide = useCallback(() => setTip(null), [])

  return { tip, show, hide }
}

function SeriesKey({ color, shape, kind, opacity = 1 }) {
  if (kind === 'line') {
    return (
      <svg className="ch-tip-key" width="14" height="10" aria-hidden="true">
        <line x1="0" y1="5" x2="14" y2="5" stroke={color} strokeOpacity={opacity} strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'shape') {
    return (
      <svg className="ch-tip-key" width="14" height="10" aria-hidden="true">
        <path d={shapePath(shape ?? 'circle', 7, 5, 4)} fill={color} fillOpacity={opacity} />
      </svg>
    )
  }
  return (
    <svg className="ch-tip-key" width="14" height="10" aria-hidden="true">
      <rect x="0" y="2" width="14" height="6" rx="2" fill={color} fillOpacity={opacity} />
    </svg>
  )
}

/**
 * Positioned read-out. Flips to the other side of the pointer near the right
 * or bottom edge so it never leaves the card.
 */
export function ChartTooltip({ tip, width, height }) {
  if (!tip || !tip.content) return null
  const { x, y, content } = tip
  const flipX = width ? x > width * 0.62 : false
  const flipY = height ? y > height * 0.72 : false
  const style = {
    left: `${x}px`,
    top: `${y}px`,
    transform: `translate(${flipX ? 'calc(-100% - 12px)' : '12px'}, ${flipY ? 'calc(-100% - 8px)' : '8px'})`,
  }
  const rows = content.rows ?? []
  return (
    <div className="ch-tip" style={style} role="status" aria-live="polite">
      {content.title && <div className="ch-tip-title">{content.title}</div>}
      {content.subtitle && <div className="ch-tip-sub">{content.subtitle}</div>}
      {rows.length > 0 && (
        <ul className="ch-tip-rows">
          {rows.map((row, i) => (
            <li key={`${row.label}-${i}`} className={row.strong ? 'is-strong' : undefined}>
              {row.color ? (
                <SeriesKey color={row.color} shape={row.shape} kind={row.kind ?? 'line'} opacity={row.opacity ?? 1} />
              ) : (
                <span className="ch-tip-nokey" />
              )}
              <span className="ch-tip-value num">{row.value}</span>
              <span className="ch-tip-label">{row.label}</span>
            </li>
          ))}
        </ul>
      )}
      {content.note && <div className="ch-tip-note">{content.note}</div>}
    </div>
  )
}

/**
 * Pointer position in the chart body's coordinate space (the same space the
 * tooltip is positioned in). Safe when there is no layout — returns the
 * fallback rather than throwing.
 */
export function localPoint(event, fallback = { x: 0, y: 0 }) {
  const target = event?.currentTarget
  if (!target) return fallback
  const svg = target.ownerSVGElement ?? (target.tagName === 'svg' ? target : null)
  const el = svg && typeof svg.getBoundingClientRect === 'function' ? svg : null
  if (!el) return fallback
  const box = el.getBoundingClientRect()
  if (!box || (box.width === 0 && box.height === 0)) return fallback
  return { x: (event.clientX ?? 0) - box.left, y: (event.clientY ?? 0) - box.top }
}
