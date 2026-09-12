import { formatTick } from './format.js'

/**
 * Axes and gridlines.
 *
 * dataviz: grid and axis rules are hairline (1px), SOLID, one step off the
 * surface, and stay recessive — they are chrome, not data. Tick text wears
 * text tokens, never a series colour.
 */

const TICK_TEXT = { fill: 'var(--text-3)', fontSize: 11 }
const LABEL_TEXT = { fill: 'var(--text-2)', fontSize: 11, fontWeight: 500 }

export function GridY({ scale, width, values, x0 = 0 }) {
  const ticks = values ?? scale.ticks(5)
  return (
    <g className="ch-grid" aria-hidden="true">
      {ticks.map((v) => (
        <line
          key={v}
          x1={x0}
          x2={width}
          y1={scale(v)}
          y2={scale(v)}
          stroke="var(--border)"
          strokeWidth={1}
          shapeRendering="crispEdges"
        />
      ))}
    </g>
  )
}

export function GridX({ scale, height, values, y0 = 0 }) {
  const ticks = values ?? scale.ticks(5)
  return (
    <g className="ch-grid" aria-hidden="true">
      {ticks.map((v) => (
        <line
          key={v}
          y1={y0}
          y2={height}
          x1={scale(v)}
          x2={scale(v)}
          stroke="var(--border)"
          strokeWidth={1}
          shapeRendering="crispEdges"
        />
      ))}
    </g>
  )
}

export function AxisBottom({
  scale,
  y,
  width,
  values,
  format = formatTick,
  label = null,
  tickCount = 5,
  showDomain = true,
  anchorFirst = false,
}) {
  const ticks = values ?? scale.ticks(tickCount)
  return (
    <g className="ch-axis" aria-hidden="true">
      {showDomain && (
        <line x1={0} x2={width} y1={y} y2={y} stroke="var(--border-strong)" strokeWidth={1} shapeRendering="crispEdges" />
      )}
      {ticks.map((v, i) => {
        const px = scale(v)
        if (!Number.isFinite(px)) return null
        const anchor = anchorFirst && i === 0 ? 'start' : anchorFirst && i === ticks.length - 1 ? 'end' : 'middle'
        return (
          <g key={`${v}-${i}`} transform={`translate(${px},${y})`}>
            <line y2={4} stroke="var(--border-strong)" strokeWidth={1} shapeRendering="crispEdges" />
            <text y={16} textAnchor={anchor} style={TICK_TEXT} className="num">
              {format(v)}
            </text>
          </g>
        )
      })}
      {label && (
        <text x={width / 2} y={y + 32} textAnchor="middle" style={LABEL_TEXT}>
          {label}
        </text>
      )}
    </g>
  )
}

export function AxisLeft({
  scale,
  height,
  values,
  format = formatTick,
  label = null,
  tickCount = 5,
  width = 0,
  showDomain = false,
}) {
  const ticks = values ?? scale.ticks(tickCount)
  return (
    <g className="ch-axis" aria-hidden="true">
      {showDomain && (
        <line x1={0} x2={0} y1={0} y2={height} stroke="var(--border-strong)" strokeWidth={1} shapeRendering="crispEdges" />
      )}
      {ticks.map((v, i) => {
        const py = scale(v)
        if (!Number.isFinite(py)) return null
        return (
          <text key={`${v}-${i}`} x={-8} y={py + 4} textAnchor="end" style={TICK_TEXT} className="num">
            {format(v)}
          </text>
        )
      })}
      {label && (
        <text
          transform={`translate(${-width + 12},${height / 2}) rotate(-90)`}
          textAnchor="middle"
          style={LABEL_TEXT}
        >
          {label}
        </text>
      )}
    </g>
  )
}

/** Category labels down the left edge of a band scale (horizontal bars). */
export function BandAxisLeft({ scale, format = (d) => d, maxChars = 22 }) {
  return (
    <g className="ch-axis" aria-hidden="true">
      {scale.domain().map((key) => {
        const text = String(format(key))
        const shown = text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
        return (
          <text
            key={key}
            x={-10}
            y={scale.center(key) + 4}
            textAnchor="end"
            style={{ fill: 'var(--text-2)', fontSize: 12 }}
          >
            {shown}
          </text>
        )
      })}
    </g>
  )
}

/** Category labels along the bottom of a band scale (columns). */
export function BandAxisBottom({ scale, y, format = (d) => d, rotate = false, maxChars = 14 }) {
  return (
    <g className="ch-axis" aria-hidden="true">
      {scale.domain().map((key) => {
        const text = String(format(key))
        const shown = text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
        const cx = scale.center(key)
        return rotate ? (
          <text
            key={key}
            transform={`translate(${cx},${y + 10}) rotate(-35)`}
            textAnchor="end"
            style={{ fill: 'var(--text-3)', fontSize: 11 }}
          >
            {shown}
          </text>
        ) : (
          <text key={key} x={cx} y={y + 15} textAnchor="middle" style={{ fill: 'var(--text-3)', fontSize: 11 }}>
            {shown}
          </text>
        )
      })}
    </g>
  )
}
