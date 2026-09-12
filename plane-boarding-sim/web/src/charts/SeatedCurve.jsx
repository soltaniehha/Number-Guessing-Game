import { useMemo, useState } from 'react'
import { ChartFrame, emptyCopy } from './primitives/ChartFrame.jsx'
import { AxisBottom, AxisLeft, GridY } from './primitives/Axis.jsx'
import { ChartTooltip, useTooltip, localPoint } from './primitives/Tooltip.jsx'
import { Legend } from './primitives/Legend.jsx'
import { linearScale, timeScale } from './primitives/scales.js'
import { linePath, bandPath } from './primitives/shapes.js'
import { formatDuration, formatDurationTick, formatDurationLong, formatPercentValue } from './primitives/format.js'
import { useSeries, legendItems, runsLabel, paxCount } from './selectors.js'

/**
 * Chart 3 — Seated S-curve.
 *
 * % seated against time, one 2px line per strategy with the inter-quartile
 * band as a 10% wash. A crosshair snaps to the nearest sample and the readout
 * lists EVERY series at that instant, so the reader never has to land on a
 * line to get a number.
 */
export function SeatedCurve({ batch, hidden, height = 300 }) {
  const { all, visible } = useSeries(batch, hidden)
  const { tip, show, hide } = useTooltip()
  // All series hidden is a different problem from no data — say which.
  const blank = all.length > 0 && visible.length === 0 ? emptyCopy('noStrategies') : emptyCopy('noRuns')
  const [crosshair, setCrosshair] = useState(null)

  const model = useMemo(() => {
    const rows = visible
      .map((s) => {
        const curve = s.entry?.seatedCurveMean
        if (!Array.isArray(curve) || curve.length === 0) return null
        const pax = paxCount(batch, s.entry) || curve.reduce((m, p) => Math.max(m, p.seated ?? 0), 0)
        if (!pax) return null
        const points = curve
          .filter((p) => Number.isFinite(p?.t))
          .map((p) => ({
            t: p.t,
            pct: ((p.seated ?? 0) / pax) * 100,
            lo: Number.isFinite(p.p25) ? (p.p25 / pax) * 100 : null,
            hi: Number.isFinite(p.p75) ? (p.p75 / pax) * 100 : null,
          }))
        return { ...s, points, pax, hasBand: points.some((p) => p.lo != null && p.hi != null) }
      })
      .filter(Boolean)
    const maxT = rows.reduce((m, r) => Math.max(m, r.points[r.points.length - 1]?.t ?? 0), 0)
    return { rows, maxT }
  }, [visible, batch])

  const { rows, maxT } = model
  const empty = rows.length === 0
  const anyBand = rows.some((r) => r.hasBand)

  const ariaLabel = empty
    ? 'Seated S-curve — no replications yet.'
    : `Percentage of passengers seated over time for ${rows.length} strategies, over ` +
      `${formatDurationLong(maxT)}. Steeper is faster; a flat shoulder near the end is the last few passengers ` +
      'fighting for bin space.'

  const table = {
    caption: 'Percentage seated at each sampled time.',
    columns: [
      { key: 'label', label: 'Strategy' },
      { key: 'q25', label: '25% seated', align: 'right' },
      { key: 'q50', label: '50% seated', align: 'right' },
      { key: 'q90', label: '90% seated', align: 'right' },
      { key: 'q100', label: 'Last seat', align: 'right' },
    ],
    rows: rows.map((r) => {
      const at = (target) => {
        const hit = r.points.find((p) => p.pct >= target)
        return hit ? formatDuration(hit.t) : '—'
      }
      return { key: r.key, label: r.label, q25: at(25), q50: at(50), q90: at(90), q100: at(99.5) }
    }),
  }

  return (
    <ChartFrame
      title="Seated S-curve"
      subtitle={empty ? 'waiting for replications' : `mean of ${runsLabel(batch, rows)}${anyBand ? ' · IQR band' : ''}`}
      ariaLabel={ariaLabel}
      height={height}
      margin={{ top: 12, right: 18, bottom: 44, left: 46 }}
      empty={empty}
      emptyTitle={blank.title}
      emptyHint={blank.hint}
      table={table}
      legend={<Legend items={legendItems(rows, 'line')} kind="line" label="Strategies" dense />}
      onPointerLeave={() => { hide(); setCrosshair(null) }}
      footnote="Shaded band is the inter-quartile range across replications. Lines converge at 100%, so they are keyed by the legend and the crosshair read-out rather than by end labels."
      tooltip={({ width, height: h }) => <ChartTooltip tip={tip} width={width} height={h} />}
    >
      {({ innerWidth, innerHeight, margin }) => {
        const x = timeScale({ domain: [0, maxT || 1], range: [0, innerWidth] })
        const y = linearScale({ domain: [0, 100], range: [innerHeight, 0] })
        const yTicks = [0, 25, 50, 75, 100]
        const xTicks = x.ticks(innerWidth < 340 ? 3 : 5)

        const onMove = (event) => {
          const pt = localPoint(event)
          const px = pt.x - margin.left
          const t = x.invert(px)
          const readings = rows
            .map((r) => {
              let best = null
              for (const p of r.points) {
                if (best == null || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p
              }
              return best ? { ...r, point: best } : null
            })
            .filter(Boolean)
          if (readings.length === 0) return
          const snapT = readings[0].point.t
          setCrosshair(snapT)
          show(x(snapT) + margin.left, margin.top + 8, {
            title: formatDuration(snapT),
            subtitle: 'seated',
            rows: readings
              .sort((a, b) => b.point.pct - a.point.pct)
              .map((r) => ({
                label: r.label,
                value: formatPercentValue(r.point.pct),
                color: r.color,
                kind: 'line',
              })),
          })
        }

        return (
          <>
            <GridY scale={y} width={innerWidth} values={yTicks} />
            <AxisLeft scale={y} height={innerHeight} values={yTicks} format={(v) => `${v}%`} />
            <AxisBottom
              scale={x}
              y={innerHeight}
              width={innerWidth}
              values={xTicks}
              format={formatDurationTick}
              label="Time since boarding started (m:ss)"
            />
            <text
              transform={`translate(${-34},${innerHeight / 2}) rotate(-90)`}
              textAnchor="middle"
              style={{ fill: 'var(--text-2)', fontSize: 11, fontWeight: 500 }}
            >
              % seated
            </text>

            {rows.map((r) =>
              r.hasBand ? (
                <path
                  key={`band-${r.key}`}
                  d={bandPath(
                    r.points.filter((p) => p.hi != null).map((p) => [x(p.t), y(p.hi)]),
                    r.points.filter((p) => p.lo != null).map((p) => [x(p.t), y(p.lo)]),
                  )}
                  fill={r.color}
                  fillOpacity={0.1}
                />
              ) : null,
            )}

            {rows.map((r) => (
              <path
                key={`line-${r.key}`}
                d={linePath(r.points.map((p) => [x(p.t), y(p.pct)]))}
                fill="none"
                stroke={r.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}

            {crosshair != null && (
              <g>
                <line
                  x1={x(crosshair)}
                  x2={x(crosshair)}
                  y1={0}
                  y2={innerHeight}
                  stroke="var(--border-strong)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                {rows.map((r) => {
                  const point = r.points.reduce(
                    (best, p) => (best == null || Math.abs(p.t - crosshair) < Math.abs(best.t - crosshair) ? p : best),
                    null,
                  )
                  if (!point) return null
                  return (
                    <circle
                      key={`dot-${r.key}`}
                      cx={x(point.t)}
                      cy={y(point.pct)}
                      r={4.5}
                      fill={r.color}
                      stroke="var(--surface)"
                      strokeWidth={2}
                    />
                  )
                })}
              </g>
            )}

            <rect
              className="ch-hit"
              x={0}
              y={0}
              width={innerWidth}
              height={innerHeight}
              tabIndex={0}
              role="button"
              aria-label="Seated curve read-out. Move the pointer or focus to inspect a moment in the boarding run."
              onPointerMove={onMove}
              onFocus={() => {
                const mid = maxT / 2
                setCrosshair(mid)
                show(x(mid) + margin.left, margin.top + 8, {
                  title: formatDuration(mid),
                  rows: rows.map((r) => {
                    const point = r.points.reduce(
                      (best, p) => (best == null || Math.abs(p.t - mid) < Math.abs(best.t - mid) ? p : best),
                      null,
                    )
                    return { label: r.label, value: formatPercentValue(point?.pct ?? 0), color: r.color, kind: 'line' }
                  }),
                })
              }}
              onBlur={() => { hide(); setCrosshair(null) }}
            />
          </>
        )
      }}
    </ChartFrame>
  )
}
