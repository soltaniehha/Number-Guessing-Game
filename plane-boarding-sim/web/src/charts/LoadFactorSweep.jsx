import { useMemo, useState } from 'react'
import { ChartFrame, emptyCopy } from './primitives/ChartFrame.jsx'
import { AxisBottom, AxisLeft, GridY } from './primitives/Axis.jsx'
import { ChartTooltip, useTooltip, localPoint } from './primitives/Tooltip.jsx'
import { Legend } from './primitives/Legend.jsx'
import { linearScale } from './primitives/scales.js'
import { linePath } from './primitives/shapes.js'
import { niceDomain } from './primitives/ticks.js'
import { formatDuration, formatDurationTick, formatDurationLong } from './primitives/format.js'
import { shapePath } from './primitives/palette.js'
import { useSeries, legendItems } from './selectors.js'

/**
 * Chart 7 — Load-factor sweep.
 *
 * Boarding time against how full the aircraft is, one line per strategy.
 * Renders only when the batch carries `sweep`; otherwise it explains, in the
 * empty state, exactly how to produce one instead of showing a blank box.
 */
export function LoadFactorSweep({ batch, hidden, height = 300 }) {
  const { all, visible } = useSeries(batch, hidden)
  const { tip, show, hide } = useTooltip()
  // All series hidden is a different problem from no data — say which.
  const blank = all.length > 0 && visible.length === 0 ? emptyCopy('noStrategies') : emptyCopy('noSweep')
  const [crosshair, setCrosshair] = useState(null)

  const model = useMemo(() => {
    const sweep = batch?.sweep
    if (!sweep || !Array.isArray(sweep.loadFactors) || sweep.loadFactors.length === 0) return null
    const rows = visible
      .map((s) => {
        const values = sweep.byStrategy?.[s.key]
        if (!Array.isArray(values) || values.length === 0) return null
        const points = sweep.loadFactors
          .map((lf, i) => ({ lf, seconds: values[i] }))
          .filter((p) => Number.isFinite(p.seconds))
        return points.length ? { ...s, points } : null
      })
      .filter(Boolean)
    if (rows.length === 0) return null
    const all = rows.flatMap((r) => r.points.map((p) => p.seconds))
    return {
      rows,
      loadFactors: sweep.loadFactors,
      yDomain: niceDomain(Math.min(...all) * 0.96, Math.max(...all), 5),
      xDomain: [Math.min(...sweep.loadFactors), Math.max(...sweep.loadFactors)],
    }
  }, [batch, visible])

  const empty = model == null

  const ariaLabel = empty
    ? 'Load-factor sweep — no sweep data in this batch.'
    : `Mean boarding time against load factor for ${model.rows.length} strategies, from ` +
      `${Math.round(model.xDomain[0] * 100)}% to ${Math.round(model.xDomain[1] * 100)}% full. ` +
      'Where lines cross, the ranking flips at that load factor.'

  const table = model
    ? {
        caption: 'Mean boarding time at each load factor.',
        columns: [
          { key: 'label', label: 'Strategy' },
          ...model.loadFactors.map((lf) => ({ key: `lf${lf}`, label: `${Math.round(lf * 100)}%`, align: 'right' })),
        ],
        rows: model.rows.map((r) => {
          const cells = { key: r.key, label: r.label }
          for (const p of r.points) cells[`lf${p.lf}`] = formatDuration(p.seconds)
          return cells
        }),
      }
    : null

  return (
    <ChartFrame
      title="Load-factor sweep"
      subtitle={empty ? 'no sweep in this batch' : 'mean boarding time vs how full the aircraft is'}
      ariaLabel={ariaLabel}
      height={height}
      margin={{ top: 12, right: 20, bottom: 46, left: 56 }}
      empty={empty}
      emptyTitle={blank.title}
      emptyHint={blank.hint}
      table={table}
      legend={model && <Legend items={legendItems(model.rows, 'line')} kind="line" label="Strategies" dense />}
      onPointerLeave={() => { hide(); setCrosshair(null) }}
      footnote={model ? 'A ranking that only holds at 100% load is not a ranking — check that your winner still wins on a two-thirds-full Tuesday.' : null}
      tooltip={({ width, height: h }) => <ChartTooltip tip={tip} width={width} height={h} />}
    >
      {({ innerWidth, innerHeight, margin }) => {
        if (!model) return null
        const x = linearScale({ domain: model.xDomain, range: [0, innerWidth] })
        const y = linearScale({ domain: model.yDomain, range: [innerHeight, 0] })
        const yTicks = y.ticks(5)

        return (
          <>
            <GridY scale={y} width={innerWidth} values={yTicks} />
            <AxisLeft scale={y} height={innerHeight} values={yTicks} format={formatDurationTick} />
            <AxisBottom
              scale={x}
              y={innerHeight}
              width={innerWidth}
              values={model.loadFactors}
              format={(v) => `${Math.round(v * 100)}%`}
              label="Load factor (% of seats sold)"
              anchorFirst
            />
            <text
              transform={`translate(${-42},${innerHeight / 2}) rotate(-90)`}
              textAnchor="middle"
              style={{ fill: 'var(--text-2)', fontSize: 11, fontWeight: 500 }}
            >
              Boarding time (m:ss)
            </text>

            {model.rows.map((r) => (
              <g key={r.key}>
                <path
                  d={linePath(r.points.map((p) => [x(p.lf), y(p.seconds)]))}
                  fill="none"
                  stroke={r.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {r.points.map((p) => (
                  <path
                    key={p.lf}
                    d={shapePath(r.shape, x(p.lf), y(p.seconds), 4)}
                    fill={r.color}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                ))}
              </g>
            ))}

            {crosshair != null && (
              <line
                x1={x(crosshair)}
                x2={x(crosshair)}
                y1={0}
                y2={innerHeight}
                stroke="var(--border-strong)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
            )}

            <rect
              className="ch-hit"
              x={0}
              y={0}
              width={innerWidth}
              height={innerHeight}
              tabIndex={0}
              role="button"
              aria-label="Load-factor read-out"
              onPointerMove={(e) => {
                const pt = localPoint(e)
                const lf = x.invert(pt.x - margin.left)
                const snap = model.loadFactors.reduce(
                  (best, v) => (Math.abs(v - lf) < Math.abs(best - lf) ? v : best),
                  model.loadFactors[0],
                )
                setCrosshair(snap)
                show(x(snap) + margin.left, margin.top + 6, {
                  title: `${Math.round(snap * 100)}% full`,
                  rows: model.rows
                    .map((r) => ({ r, p: r.points.find((pp) => pp.lf === snap) }))
                    .filter((d) => d.p)
                    .sort((a, b) => a.p.seconds - b.p.seconds)
                    .map(({ r, p }) => ({
                      label: r.label,
                      value: formatDuration(p.seconds),
                      color: r.color,
                      shape: r.shape,
                      kind: 'shape',
                    })),
                })
              }}
              onFocus={() => {
                const snap = model.loadFactors[model.loadFactors.length - 1]
                setCrosshair(snap)
                show(x(snap) + margin.left, margin.top + 6, {
                  title: `${Math.round(snap * 100)}% full`,
                  rows: model.rows
                    .map((r) => ({ r, p: r.points.find((pp) => pp.lf === snap) }))
                    .filter((d) => d.p)
                    .map(({ r, p }) => ({
                      label: r.label,
                      value: formatDurationLong(p.seconds),
                      color: r.color,
                      shape: r.shape,
                      kind: 'shape',
                    })),
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
