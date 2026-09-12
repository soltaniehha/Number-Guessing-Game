import { shapePath } from './palette.js'

/**
 * Legend / series filter.
 *
 * dataviz: a legend is ALWAYS present for two or more series (identity is
 * never colour-alone), and never for a single series — the title names it.
 * Swatches mirror the mark: a rect for bars and areas, a stroke for lines, a
 * shape glyph where the chart uses composite hue × shape encoding.
 */

export function LegendSwatch({ color, shape = 'circle', kind = 'rect', size = 14, opacity = 1 }) {
  if (kind === 'line') {
    return (
      <svg className="ch-legend-swatch" width={size} height={size} aria-hidden="true">
        <line x1="0" y1={size / 2} x2={size} y2={size / 2} stroke={color} strokeOpacity={opacity} strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'shape') {
    return (
      <svg className="ch-legend-swatch" width={size} height={size} aria-hidden="true">
        <path d={shapePath(shape, size / 2, size / 2, size * 0.3)} fill={color} fillOpacity={opacity} />
      </svg>
    )
  }
  return (
    <svg className="ch-legend-swatch" width={size} height={size} aria-hidden="true">
      <rect x="0" y={size * 0.25} width={size} height={size * 0.5} rx="2" fill={color} fillOpacity={opacity} />
    </svg>
  )
}

/**
 * @param items  [{ key, label, color, shape, kind }]
 * @param hidden Set of keys currently toggled off (interactive legends only)
 */
export function Legend({ items, hidden, onToggle, kind = 'rect', label = 'Series', dense = false }) {
  const list = items ?? []
  if (list.length < 2) return null
  const interactive = typeof onToggle === 'function'

  return (
    <div className={`ch-legend${dense ? ' is-dense' : ''}`} role="group" aria-label={label}>
      {list.map((item) => {
        const off = hidden?.has(item.key) ?? false
        const swatch = (
          <LegendSwatch
            color={off ? 'var(--text-3)' : item.color}
            shape={item.shape}
            kind={item.kind ?? kind}
            opacity={off ? 1 : item.opacity ?? 1}
          />
        )
        if (!interactive) {
          return (
            <span key={item.key} className="ch-legend-item">
              {swatch}
              <span>{item.label}</span>
            </span>
          )
        }
        return (
          <button
            key={item.key}
            type="button"
            className={`ch-legend-item is-button${off ? ' is-off' : ''}`}
            aria-pressed={!off}
            onClick={() => onToggle(item.key)}
          >
            {swatch}
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Stepped scale legend for the heat ramp. A continuous colour scale must
 * always ship one of these — magnitude is never colour-only.
 */
export function HeatLegend({ bins, format = (v) => v, title = null, colorFor }) {
  if (!bins || bins.length === 0) return null
  return (
    <div className="ch-heatlegend" role="group" aria-label={title ?? 'Colour scale'}>
      {title && <span className="ch-heatlegend-title">{title}</span>}
      <div className="ch-heatlegend-steps">
        {bins.map((bin) => (
          <span key={bin.level} className="ch-heatlegend-step">
            <span className="ch-heatlegend-chip" style={{ background: colorFor(bin.level) }} aria-hidden="true" />
            <span className="ch-heatlegend-tick num">{format(bin.x1)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
