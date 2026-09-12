import { useMemo } from 'react'
import { ChartFrame, emptyCopy } from './primitives/ChartFrame.jsx'
import { AxisBottom, GridX } from './primitives/Axis.jsx'
import { ChartTooltip, useTooltip, localPoint } from './primitives/Tooltip.jsx'
import { Legend } from './primitives/Legend.jsx'
import { linearScale } from './primitives/scales.js'
import { stepPath } from './primitives/shapes.js'
import { niceDomain } from './primitives/ticks.js'
import { formatDuration, formatDurationTick, formatDurationLong, formatNumber } from './primitives/format.js'
import { histogram, binCount, quantile } from './primitives/stats.js'
import { useSeries, legendItems, runsLabel } from './selectors.js'

const ROW_HEIGHT = 46
const RIDGE_SCALE = 1.5

/**
 * Chart 2 — Time distribution, as a ridgeline.
 *
 * A ridgeline rather than overlaid histograms: with more than three
 * strategies overlaid outlines cross-hatch into noise, and a ridgeline still
 * reads at 400px. Every ridge shares one x domain AND one density scale, so
 * a tall narrow ridge really does mean "more consistent".
 */
export function TimeDistribution({ batch, hidden, height = null }) {
  const { all, visible } = useSeries(batch, hidden)
  const { tip, show, hide } = useTooltip()
  // All series hidden is a different problem from no data — say which.
  const blank = all.length > 0 && visible.length === 0 ? emptyCopy('noStrategies') : emptyCopy('noRuns')

  const model = useMemo(() => {
    const rows = visible
      .map((s) => ({ ...s, values: (s.entry?.totalSeconds?.values ?? []).filter(Number.isFinite) }))
      .filter((s) => s.values.length > 0)
    if (rows.length === 0) return { rows: [], domain: [0, 1], maxDensity: 1, bins: 1, sparse: true }

    const pooled = rows.flatMap((r) => r.values)
    const domain = niceDomain(Math.min(...pooled), Math.max(...pooled), 6)
    const bins = Math.max(8, Math.min(24, binCount(pooled)))
    const sparse = rows.every((r) => r.values.length < 4)

    const withHist = rows.map((r) => ({
      ...r,
      hist: histogram(r.values, { domain, bins }),
      median: quantile(r.values, 0.5),
    }))
    const maxDensity = withHist.reduce((m, r) => Math.max(m, r.hist.maxDensity || 0), 0) || 1
    return { rows: withHist, domain, maxDensity, bins, sparse }
  }, [visible])

  const { rows, domain, maxDensity, sparse } = model
  const empty = rows.length === 0
  const plotHeight = height ?? Math.max(180, rows.length * ROW_HEIGHT + 54)

  const tightest = rows.reduce(
    (best, r) => (best == null || (r.entry?.totalSeconds?.sd ?? Infinity) < (best.entry?.totalSeconds?.sd ?? Infinity) ? r : best),
    null,
  )

  const ariaLabel = empty
    ? 'Time distribution — no replications yet.'
    : `Distribution of total boarding time for ${rows.length} strategies, plotted as a ridgeline over ` +
      `${formatDurationLong(domain[0])} to ${formatDurationLong(domain[1])}. ` +
      (tightest ? `${tightest.label} is the most consistent, with a standard deviation of ${formatDurationLong(tightest.entry.totalSeconds.sd)}.` : '')

  const table = {
    caption: 'Spread of total boarding time across replications.',
    columns: [
      { key: 'label', label: 'Strategy' },
      { key: 'runs', label: 'Runs', align: 'right' },
      { key: 'min', label: 'Fastest', align: 'right' },
      { key: 'p50', label: 'Median', align: 'right' },
      { key: 'max', label: 'Slowest', align: 'right' },
      { key: 'sd', label: 'SD', align: 'right' },
    ],
    rows: rows.map((r) => ({
      key: r.key,
      label: r.label,
      runs: formatNumber(r.values.length),
      min: formatDuration(Math.min(...r.values)),
      p50: formatDuration(r.median),
      max: formatDuration(Math.max(...r.values)),
      sd: formatDuration(r.entry?.totalSeconds?.sd),
    })),
  }

  return (
    <ChartFrame
      title="Time distribution"
      subtitle={empty ? 'waiting for replications' : `${runsLabel(batch, rows)} per strategy · shared bins`}
      ariaLabel={ariaLabel}
      height={plotHeight}
      margin={{ top: 10, right: 58, bottom: 42, left: 124 }}
      empty={empty}
      emptyTitle={blank.title}
      emptyHint={blank.hint}
      table={table}
      legend={<Legend items={legendItems(rows, 'rect')} label="Strategies" dense />}
      onPointerLeave={hide}
      footnote={
        sparse
          ? 'Fewer than four replications per strategy — each stem is one run. The ridges appear once there is a distribution to draw.'
          : 'All ridges share one bin width and one height scale: a tall narrow ridge is a consistent strategy, a low wide one is a gamble. The tick marks the median.'
      }
      tooltip={({ width, height: h }) => <ChartTooltip tip={tip} width={width} height={h} />}
    >
      {({ innerWidth, innerHeight, margin }) => {
        const x = linearScale({ domain, range: [0, innerWidth] })
        const ticks = x.ticks(innerWidth < 340 ? 3 : 5)
        const rowH = rows.length ? innerHeight / rows.length : innerHeight
        const density = linearScale({ domain: [0, maxDensity], range: [0, rowH * RIDGE_SCALE] })

        return (
          <>
            <GridX scale={x} height={innerHeight} values={ticks} />
            <AxisBottom
              scale={x}
              y={innerHeight}
              width={innerWidth}
              values={ticks}
              format={formatDurationTick}
              label="Total boarding time (m:ss)"
            />

            {rows.map((r, i) => {
              const baseline = (i + 1) * rowH - 4
              const yFor = (d) => baseline - density(d)
              const nRuns = r.values.length
              return (
                <g key={r.key}>
                  <line
                    x1={0}
                    x2={innerWidth}
                    y1={baseline}
                    y2={baseline}
                    stroke="var(--border)"
                    strokeWidth={1}
                    shapeRendering="crispEdges"
                  />
                  <text
                    x={-10}
                    y={baseline - 4}
                    textAnchor="end"
                    style={{ fill: 'var(--text-2)', fontSize: 11.5 }}
                  >
                    {r.label.length > Math.floor((margin.left - 14) / 6.4)
                      ? `${r.label.slice(0, Math.floor((margin.left - 14) / 6.4) - 1)}…`
                      : r.label}
                  </text>

                  {nRuns < 4 ? (
                    r.values.map((v, vi) => (
                      <line
                        key={`${v}-${vi}`}
                        x1={x(v)}
                        x2={x(v)}
                        y1={baseline}
                        y2={baseline - rowH * 0.7}
                        stroke={r.color}
                        strokeWidth={2}
                        strokeLinecap="round"
                      />
                    ))
                  ) : (
                    <path
                      d={stepPath(r.hist.bins, x, yFor, baseline)}
                      fill={r.color}
                      fillOpacity={0.16}
                      stroke={r.color}
                      strokeWidth={2}
                      strokeLinejoin="round"
                    />
                  )}

                  {Number.isFinite(r.median) && (
                    <line
                      x1={x(r.median)}
                      x2={x(r.median)}
                      y1={baseline + 4}
                      y2={baseline - 12}
                      stroke="var(--text-2)"
                      strokeWidth={1.5}
                    />
                  )}
                  <text
                    x={innerWidth + 6}
                    y={baseline - 1}
                    className="num"
                    style={{ fill: 'var(--text-2)', fontSize: 11 }}
                  >
                    {formatDuration(r.median)}
                  </text>

                  <rect
                    className="ch-hit"
                    x={0}
                    y={baseline - rowH + 2}
                    width={innerWidth}
                    height={Math.max(24, rowH)}
                    tabIndex={0}
                    role="button"
                    aria-label={`${r.label}: median ${formatDurationLong(r.median)} across ${nRuns} runs`}
                    onPointerMove={(e) => {
                      const pt = localPoint(e, { x: margin.left + innerWidth / 2, y: baseline })
                      const value = x.invert(pt.x - margin.left)
                      const bin = r.hist.bins.find((b) => value >= b.x0 && value <= b.x1)
                      show(pt.x, baseline + margin.top - 8, {
                        title: r.label,
                        subtitle: bin
                          ? `${formatDuration(bin.x0)} – ${formatDuration(bin.x1)}`
                          : `${formatNumber(nRuns)} runs`,
                        rows: [
                          bin
                            ? { label: 'runs in bin', value: formatNumber(bin.count), color: r.color, kind: 'rect', strong: true }
                            : { label: 'runs', value: formatNumber(nRuns), color: r.color, kind: 'rect', strong: true },
                          { label: 'median', value: formatDuration(r.median) },
                          { label: 'std dev', value: formatDuration(r.entry?.totalSeconds?.sd) },
                        ],
                      })
                    }}
                    onFocus={() =>
                      show(innerWidth / 2, baseline + margin.top - 8, {
                        title: r.label,
                        rows: [
                          { label: 'median', value: formatDuration(r.median), color: r.color, kind: 'rect', strong: true },
                          { label: 'runs', value: formatNumber(nRuns) },
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
