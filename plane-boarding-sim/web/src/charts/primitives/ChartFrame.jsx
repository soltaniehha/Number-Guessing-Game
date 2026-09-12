import { useId, useState } from 'react'
import '../charts.css'
import { useMeasure } from './useMeasure.js'
import { DataTable } from './DataTable.jsx'

const DEFAULT_MARGIN = { top: 12, right: 16, bottom: 36, left: 46 }

/**
 * The shared chart shell: measure, margins, title/subtitle, legend slot,
 * empty state, table view, accessible description.
 *
 * Sizing follows the anti-pattern rule about axis bands: `height` is the
 * height of the whole SVG *including* the x-axis label band, so a card never
 * grows a tiny nested scrollbar to reveal its axis.
 */
export function ChartFrame({
  title,
  subtitle = null,
  ariaLabel,
  legend = null,
  footnote = null,
  height = 300,
  minHeight = 160,
  margin: marginProp,
  empty = false,
  emptyTitle = 'Nothing to plot yet',
  emptyHint = 'Start a Monte Carlo run — this chart fills in as replications stream back.',
  table = null,
  tooltip = null,
  /**
   * Optional layer painted *under* the SVG, in the body's own pixel space —
   * for a chart whose marks are too many to be DOM nodes (see `HeatCanvas`).
   * Called with the same geometry the children get, and only while the chart
   * is actually showing (not empty, not flipped to the table view).
   */
  overlay = null,
  onPointerLeave,
  children,
}) {
  const [ref, size] = useMeasure(640)
  const [showTable, setShowTable] = useState(false)
  const titleId = useId()

  const margin = { ...DEFAULT_MARGIN, ...(marginProp ?? {}) }
  const width = Math.max(200, size.width)
  const svgHeight = Math.max(minHeight, height)
  const innerWidth = Math.max(10, width - margin.left - margin.right)
  const innerHeight = Math.max(10, svgHeight - margin.top - margin.bottom)
  const compact = width < 520

  return (
    <figure className="ch-frame" aria-labelledby={titleId}>
      <div className="ch-head">
        <div className="ch-head-text">
          <h3 className="ch-title" id={titleId}>{title}</h3>
          {subtitle && <p className="ch-sub">{subtitle}</p>}
        </div>
        {table && !empty && (
          <button
            type="button"
            className="ch-tablebtn"
            aria-pressed={showTable}
            onClick={() => setShowTable((v) => !v)}
          >
            {showTable ? 'Chart' : 'Table'}
          </button>
        )}
      </div>

      {legend && !showTable && <div className="ch-legend-slot">{legend}</div>}

      <div className="ch-body" ref={ref} onPointerLeave={onPointerLeave}>
        {empty ? (
          <div className="ch-empty" style={{ minHeight: Math.min(svgHeight, 220) }}>
            <p className="ch-empty-title">{emptyTitle}</p>
            <p className="ch-empty-hint">{emptyHint}</p>
          </div>
        ) : showTable ? (
          <DataTable columns={table.columns} rows={table.rows} caption={table.caption ?? ariaLabel} />
        ) : (
          <>
            {typeof overlay === 'function' &&
              overlay({ width, height: svgHeight, innerWidth, innerHeight, margin, compact })}
            <svg
              className="ch-svg"
              width="100%"
              height={svgHeight}
              viewBox={`0 0 ${width} ${svgHeight}`}
              preserveAspectRatio="xMinYMin meet"
              role="img"
              aria-label={ariaLabel}
            >
              <title>{title}</title>
              <desc>{ariaLabel}</desc>
              <g transform={`translate(${margin.left},${margin.top})`}>
                {typeof children === 'function'
                  ? children({ width, height: svgHeight, innerWidth, innerHeight, margin, compact })
                  : children}
              </g>
            </svg>
            {typeof tooltip === 'function' ? tooltip({ width, height: svgHeight }) : tooltip}
          </>
        )}
      </div>

      {footnote && <figcaption className="ch-foot">{footnote}</figcaption>}
    </figure>
  )
}

/** Shared "not enough data yet" copy builder, so empty states stay informative. */
export function emptyCopy(kind, extra = null) {
  const base = {
    noRuns: {
      title: 'No replications yet',
      hint: 'Press Run in the control panel. Charts fill in progressively — the first replication draws immediately.',
    },
    noStrategies: {
      title: 'Every strategy is hidden',
      hint: 'Re-enable at least one strategy in the filter above to plot it.',
    },
    noSweep: {
      title: 'No parameter sweep in this batch',
      hint: 'Enable the sweep in the Scenario section, pick the parameter to vary, and re-run. A sweep re-runs every selected strategy at every point on that axis, so it costs roughly the batch × the number of points.',
    },
    noSeatMap: {
      title: 'No per-seat timings yet',
      hint: 'Per-seat means need at least one completed replication of the selected strategy.',
    },
    noCongestion: {
      title: 'No congestion matrix yet',
      hint: 'The row × time matrix is averaged across replications and appears with the first completed run.',
    },
  }[kind] ?? { title: 'Nothing to plot yet', hint: 'Run the simulation to populate this chart.' }
  return extra ? { ...base, ...extra } : base
}
