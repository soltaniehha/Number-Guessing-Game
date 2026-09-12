import { useMemo } from 'react'
import { ChartFrame, emptyCopy } from './primitives/ChartFrame.jsx'
import { AxisBottom, AxisLeft, GridY, GridX } from './primitives/Axis.jsx'
import { ChartTooltip, useTooltip, localPoint } from './primitives/Tooltip.jsx'
import { linearScale } from './primitives/scales.js'
import { niceDomain } from './primitives/ticks.js'
import { formatDuration, formatDurationTick, formatDurationLong, formatNumber } from './primitives/format.js'
import { shapePath, ALL_PAIRS_SAFE } from './primitives/palette.js'
import { quantile } from './primitives/stats.js'
import { useSeries, runsLabel } from './selectors.js'

const LABEL_GAP = 13

/**
 * Chart 11 — Risk / reward.
 *
 * Mean against standard deviation, one labelled point per strategy.
 *
 * This is an ALL-PAIRS form (any two marks can end up side by side), where
 * the validated hue budget is three. Above that, identity is carried by the
 * per-point direct label and the per-slot marker shape — hue only keeps the
 * point tied to the same strategy in the other eleven charts. The footnote
 * says so, and the table view carries every value.
 */
export function RiskReward({ batch, hidden, height = 320 }) {
  const { all, visible } = useSeries(batch, hidden)
  const { tip, show, hide } = useTooltip()
  // All series hidden is a different problem from no data — say which.
  const blank = all.length > 0 && visible.length === 0 ? emptyCopy('noStrategies') : emptyCopy('noRuns')

  const model = useMemo(() => {
    const points = visible
      .filter((s) => Number.isFinite(s.entry?.totalSeconds?.mean) && Number.isFinite(s.entry?.totalSeconds?.sd))
      .map((s) => ({ ...s, mean: s.entry.totalSeconds.mean, sd: s.entry.totalSeconds.sd }))
    if (points.length === 0) return null
    const means = points.map((p) => p.mean)
    const sds = points.map((p) => p.sd)
    return {
      points,
      xDomain: niceDomain(Math.min(...means) * 0.97, Math.max(...means) * 1.03, 4),
      yDomain: niceDomain(0, Math.max(...sds) * 1.15, 4),
      midX: quantile(means, 0.5),
      midY: quantile(sds, 0.5),
      best: points.reduce((b, p) => (b == null || p.mean + p.sd < b.mean + b.sd ? p : b), null),
    }
  }, [visible])

  const empty = model == null

  const ariaLabel = empty
    ? 'Risk and reward — no replications yet.'
    : `Mean boarding time against its standard deviation for ${model.points.length} strategies. ` +
      `Bottom-left is fast and predictable: ${model.best.label} sits closest to it, averaging ` +
      `${formatDurationLong(model.best.mean)} with a spread of ${formatDurationLong(model.best.sd)}.`

  const table = model
    ? {
        caption: 'Mean boarding time against run-to-run standard deviation.',
        columns: [
          { key: 'label', label: 'Strategy' },
          { key: 'runs', label: 'Runs', align: 'right' },
          { key: 'mean', label: 'Mean', align: 'right' },
          { key: 'sd', label: 'SD', align: 'right' },
          { key: 'cv', label: 'SD / mean', align: 'right' },
        ],
        rows: model.points.map((p) => ({
          key: p.key,
          label: p.label,
          runs: formatNumber(p.runs),
          mean: formatDuration(p.mean),
          sd: formatDuration(p.sd),
          cv: `${((p.sd / p.mean) * 100).toFixed(1)}%`,
        })),
      }
    : null

  return (
    <ChartFrame
      title="Risk vs reward"
      subtitle={empty ? 'waiting for replications' : `mean vs standard deviation · ${runsLabel(batch, model.points)}`}
      ariaLabel={ariaLabel}
      height={height}
      margin={{ top: 20, right: 24, bottom: 46, left: 56 }}
      empty={empty}
      emptyTitle={blank.title}
      emptyHint={blank.hint}
      table={table}
      onPointerLeave={hide}
      footnote={
        model && model.points.length > ALL_PAIRS_SAFE
          ? 'Every point is labelled and shaped as well as coloured: in a scatter any two marks can sit side by side, and only three hues are separable under colour-vision deficiency in that arrangement.'
          : 'Bottom-left wins: a low mean with a low spread is a schedule you can actually plan around.'
      }
      tooltip={({ width, height: h }) => <ChartTooltip tip={tip} width={width} height={h} />}
    >
      {({ innerWidth, innerHeight, margin }) => {
        if (!model) return null
        const x = linearScale({ domain: model.xDomain, range: [0, innerWidth] })
        const y = linearScale({ domain: model.yDomain, range: [innerHeight, 0] })
        const xTicks = x.ticks(innerWidth < 340 ? 3 : 4)
        const yTicks = y.ticks(4)

        // Direct labels, decluttered: sorted top-down, pushed apart, with a
        // leader line whenever a label had to move off its point.
        const placed = [...model.points]
          .map((p) => ({ p, px: x(p.mean), py: y(p.sd) }))
          .sort((a, b) => a.py - b.py)
        let lastY = -Infinity
        for (const item of placed) {
          item.labelY = Math.max(item.py, lastY + LABEL_GAP)
          lastY = item.labelY
        }

        return (
          <>
            <GridY scale={y} width={innerWidth} values={yTicks} />
            <GridX scale={x} height={innerHeight} values={xTicks} />
            <AxisLeft scale={y} height={innerHeight} values={yTicks} format={formatDurationTick} />
            <AxisBottom
              scale={x}
              y={innerHeight}
              width={innerWidth}
              values={xTicks}
              format={formatDurationTick}
              label="Mean boarding time (m:ss)"
            />
            <text
              transform={`translate(${-42},${innerHeight / 2}) rotate(-90)`}
              textAnchor="middle"
              style={{ fill: 'var(--text-2)', fontSize: 11, fontWeight: 500 }}
            >
              Std dev across runs
            </text>

            <line
              x1={x(model.midX)}
              x2={x(model.midX)}
              y1={0}
              y2={innerHeight}
              stroke="var(--border-strong)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <line
              x1={0}
              x2={innerWidth}
              y1={y(model.midY)}
              y2={y(model.midY)}
              stroke="var(--border-strong)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <g style={{ fill: 'var(--text-3)', fontSize: 10 }} aria-hidden="true">
              <text x={4} y={12}>fast but volatile</text>
              <text x={innerWidth - 4} y={12} textAnchor="end">slow &amp; volatile</text>
              <text x={4} y={innerHeight - 6}>fast &amp; predictable</text>
              <text x={innerWidth - 4} y={innerHeight - 6} textAnchor="end">slow &amp; predictable</text>
            </g>

            {placed.map(({ p, px, py, labelY }) => {
              const moved = Math.abs(labelY - py) > 3
              const labelX = Math.min(px + 10, innerWidth - 4)
              return (
                <g key={p.key}>
                  {moved && (
                    <line
                      x1={px + 5}
                      y1={py}
                      x2={labelX - 2}
                      y2={labelY - 3.5}
                      stroke="var(--border-strong)"
                      strokeWidth={1}
                    />
                  )}
                  <path
                    className="ch-animate"
                    d={shapePath(p.shape, px, py, 5)}
                    fill={p.color}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                  <text
                    x={labelX}
                    y={labelY}
                    textAnchor={labelX > innerWidth * 0.72 ? 'end' : 'start'}
                    style={{ fill: 'var(--text-2)', fontSize: 10.5 }}
                  >
                    {p.label}
                  </text>
                  <circle
                    className="ch-hit"
                    cx={px}
                    cy={py}
                    r={14}
                    tabIndex={0}
                    role="button"
                    aria-label={`${p.label}: mean ${formatDurationLong(p.mean)}, standard deviation ${formatDurationLong(p.sd)}`}
                    onPointerMove={(e) => {
                      const pt = localPoint(e, { x: px + margin.left, y: py + margin.top })
                      show(pt.x, pt.y, {
                        title: p.label,
                        subtitle: `${formatNumber(p.runs)} replications`,
                        rows: [
                          { label: 'mean', value: formatDuration(p.mean), color: p.color, shape: p.shape, kind: 'shape', strong: true },
                          { label: 'std dev', value: formatDuration(p.sd) },
                          { label: 'spread / mean', value: `${((p.sd / p.mean) * 100).toFixed(1)}%` },
                        ],
                      })
                    }}
                    onFocus={() =>
                      show(px + margin.left, py + margin.top, {
                        title: p.label,
                        rows: [
                          { label: 'mean', value: formatDuration(p.mean), color: p.color, shape: p.shape, kind: 'shape', strong: true },
                          { label: 'std dev', value: formatDuration(p.sd) },
                        ],
                      })
                    }
                    onBlur={hide}
                  />
                </g>
              )
            })}
          </>
        )
      }}
    </ChartFrame>
  )
}
