import { useMemo } from 'react'
import { ChartFrame, emptyCopy } from './primitives/ChartFrame.jsx'
import { AxisBottom, AxisLeft, GridY } from './primitives/Axis.jsx'
import { ChartTooltip, useTooltip, localPoint } from './primitives/Tooltip.jsx'
import { Legend } from './primitives/Legend.jsx'
import { linearScale } from './primitives/scales.js'
import { linePath, bandPath } from './primitives/shapes.js'
import { niceDomain } from './primitives/ticks.js'
import { formatDuration, formatDurationTick, formatDurationLong, formatNumber } from './primitives/format.js'
import { convergenceSeries } from './primitives/stats.js'
import { useSeries, legendItems } from './selectors.js'

const BAND_LIMIT = 4

/**
 * `left` has to clear BOTH the m:ss tick labels — which end 8px off the plot
 * and run about 34px wide — and the rotated axis title sitting outboard of
 * them. At 56 the title box overlapped the "33:20" and "41:40" ticks by 2px,
 * measured; 64 leaves ~5px of air.
 */
const MARGIN = { top: 12, right: 18, bottom: 46, left: 64 }

/**
 * Chart 10 — Convergence.
 *
 * Running mean with a shrinking 95% band against replication count: the
 * chart that says whether the answer above is trustworthy yet. Falls back to
 * recomputing the running statistics from the raw values when a partial
 * batch has not shipped a `convergence` array.
 */
export function Convergence({ batch, hidden, height = 300 }) {
  const { all, visible } = useSeries(batch, hidden)
  const { tip, show, hide } = useTooltip()
  // All series hidden is a different problem from no data — say which.
  const blank = all.length > 0 && visible.length === 0 ? emptyCopy('noStrategies') : emptyCopy('noRuns')

  const model = useMemo(() => {
    const rows = visible
      .map((s) => {
        const supplied = s.entry?.convergence
        const points = Array.isArray(supplied) && supplied.length
          ? supplied.filter((p) => Number.isFinite(p?.n) && Number.isFinite(p?.mean))
          : convergenceSeries(s.entry?.totalSeconds?.values)
        return points.length ? { ...s, points } : null
      })
      .filter(Boolean)
    if (rows.length === 0) return null
    const maxN = rows.reduce((m, r) => Math.max(m, r.points[r.points.length - 1].n), 1)
    const lo = Math.min(...rows.flatMap((r) => r.points.slice(Math.min(2, r.points.length - 1)).map((p) => p.ciLow ?? p.mean)))
    const hi = Math.max(...rows.flatMap((r) => r.points.slice(Math.min(2, r.points.length - 1)).map((p) => p.ciHigh ?? p.mean)))
    return { rows, maxN, yDomain: niceDomain(lo, hi, 5) }
  }, [visible])

  const empty = model == null
  const showBands = model ? model.rows.length <= BAND_LIMIT : false

  const settled = model
    ? model.rows.filter((r) => {
        const last = r.points[r.points.length - 1]
        const width = (last.ciHigh ?? last.mean) - (last.ciLow ?? last.mean)
        return last.n >= 5 && width / last.mean < 0.02
      }).length
    : 0

  const ariaLabel = empty
    ? 'Convergence — no replications yet.'
    : `Running mean boarding time against replication count for ${model.rows.length} strategies, up to ` +
      `${model.maxN} replications. ${settled} of ${model.rows.length} have a 95% interval narrower than 2% of the mean, ` +
      'which is the point where the ranking stops moving.'

  const table = model
    ? {
        caption: 'Running mean and 95% interval at the latest replication count.',
        columns: [
          { key: 'label', label: 'Strategy' },
          { key: 'n', label: 'Runs', align: 'right' },
          { key: 'mean', label: 'Running mean', align: 'right' },
          { key: 'ci', label: '95% CI', align: 'right' },
          { key: 'width', label: 'CI width', align: 'right' },
        ],
        rows: model.rows.map((r) => {
          const last = r.points[r.points.length - 1]
          const width = (last.ciHigh ?? last.mean) - (last.ciLow ?? last.mean)
          return {
            key: r.key,
            label: r.label,
            n: formatNumber(last.n),
            mean: formatDuration(last.mean),
            ci: last.ciLow != null ? `${formatDuration(last.ciLow)} – ${formatDuration(last.ciHigh)}` : '—',
            width: width > 0 ? `±${formatDuration(width / 2)}` : '—',
          }
        }),
      }
    : null

  return (
    <ChartFrame
      title="Convergence"
      subtitle={empty ? 'waiting for replications' : `running mean ± 95% · up to ${model.maxN} replications`}
      ariaLabel={ariaLabel}
      height={height}
      margin={MARGIN}
      empty={empty}
      emptyTitle={blank.title}
      emptyHint={blank.hint}
      table={table}
      legend={model && <Legend items={legendItems(model.rows, 'line')} kind="line" label="Strategies" dense />}
      onPointerLeave={hide}
      footnote={
        showBands
          ? 'When a band stops shrinking and no longer overlaps its neighbour, more replications will not change the answer.'
          : 'Bands are hidden above four visible strategies to keep the lines readable — hide a strategy in the filter to see its interval.'
      }
      tooltip={({ width, height: h }) => <ChartTooltip tip={tip} width={width} height={h} />}
    >
      {({ innerWidth, innerHeight, margin }) => {
        if (!model) return null
        const x = linearScale({ domain: [1, Math.max(2, model.maxN)], range: [0, innerWidth] })
        const y = linearScale({ domain: model.yDomain, range: [innerHeight, 0] })
        const yTicks = y.ticks(5)
        const xTicks = x.ticks(innerWidth < 340 ? 3 : 5).filter((v) => v >= 1)

        return (
          <>
            <GridY scale={y} width={innerWidth} values={yTicks} />
            <AxisLeft scale={y} height={innerHeight} values={yTicks} format={formatDurationTick} />
            <AxisBottom
              scale={x}
              y={innerHeight}
              width={innerWidth}
              values={xTicks}
              format={(v) => formatNumber(v)}
              label="Replications completed"
            />
            <text
              transform={`translate(${-(margin.left - 12)},${innerHeight / 2}) rotate(-90)`}
              textAnchor="middle"
              style={{ fill: 'var(--text-2)', fontSize: 11, fontWeight: 500 }}
            >
              Running mean (m:ss)
            </text>

            {showBands &&
              model.rows.map((r) => (
                <path
                  key={`band-${r.key}`}
                  d={bandPath(
                    r.points.filter((p) => Number.isFinite(p.ciHigh)).map((p) => [x(p.n), y(p.ciHigh)]),
                    r.points.filter((p) => Number.isFinite(p.ciLow)).map((p) => [x(p.n), y(p.ciLow)]),
                  )}
                  fill={r.color}
                  fillOpacity={0.1}
                />
              ))}

            {model.rows.map((r) => (
              <g key={`line-${r.key}`}>
                <path
                  d={linePath(r.points.map((p) => [x(p.n), y(p.mean)]))}
                  fill="none"
                  stroke={r.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle
                  cx={x(r.points[r.points.length - 1].n)}
                  cy={y(r.points[r.points.length - 1].mean)}
                  r={4.5}
                  fill={r.color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              </g>
            ))}

            <rect
              className="ch-hit"
              x={0}
              y={0}
              width={innerWidth}
              height={innerHeight}
              tabIndex={0}
              role="button"
              aria-label="Convergence read-out"
              onPointerMove={(e) => {
                const pt = localPoint(e)
                const n = Math.round(x.invert(pt.x - margin.left))
                show(pt.x, margin.top + 6, {
                  title: `After ${formatNumber(Math.max(1, n))} runs`,
                  rows: model.rows.map((r) => {
                    const point = r.points.reduce(
                      (best, p) => (best == null || Math.abs(p.n - n) < Math.abs(best.n - n) ? p : best),
                      null,
                    )
                    return {
                      label: r.label,
                      value: formatDuration(point?.mean),
                      color: r.color,
                      kind: 'line',
                    }
                  }),
                })
              }}
              onFocus={() =>
                show(innerWidth * 0.5, margin.top + 6, {
                  title: 'Latest running means',
                  rows: model.rows.map((r) => ({
                    label: r.label,
                    value: formatDurationLong(r.points[r.points.length - 1].mean),
                    color: r.color,
                    kind: 'line',
                  })),
                })
              }
              onBlur={hide}
            />
          </>
        )
      }}
    </ChartFrame>
  )
}
