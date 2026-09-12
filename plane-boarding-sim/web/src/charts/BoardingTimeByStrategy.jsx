import { useMemo } from 'react'
import { ChartFrame, emptyCopy } from './primitives/ChartFrame.jsx'
import { AxisBottom, BandAxisLeft, GridX } from './primitives/Axis.jsx'
import { ChartTooltip, useTooltip, localPoint } from './primitives/Tooltip.jsx'
import { bandScale, cappedBand, bandInset, linearScale } from './primitives/scales.js'
import { roundedRightRect } from './primitives/shapes.js'
import { formatDuration, formatDurationTick, formatDurationLong, formatNumber } from './primitives/format.js'
import { meanCI } from './primitives/stats.js'
import { useSeries, byMeanAsc, runsLabel } from './selectors.js'

const BAR_CAP = 22

/**
 * Chart 1 — Boarding time by strategy. The headline chart.
 *
 * Horizontal bars sorted fastest first, 95% CI whiskers, value labels in m:ss.
 * Sorting is by value; COLOUR is by entity, so re-sorting as results stream in
 * never repaints a strategy into someone else's hue.
 */
export function BoardingTimeByStrategy({ batch, hidden, height = null }) {
  const { all, visible } = useSeries(batch, hidden)
  const { tip, show, hide } = useTooltip()
  // All series hidden is a different problem from no data — say which.
  const blank = all.length > 0 && visible.length === 0 ? emptyCopy('noStrategies') : emptyCopy('noRuns')

  const rows = useMemo(() => {
    const withData = visible.filter((s) => Number.isFinite(s.entry?.totalSeconds?.mean))
    return byMeanAsc(withData).map((s) => {
      const ts = s.entry.totalSeconds
      const ci = meanCI({ mean: ts.mean, sd: ts.sd, n: s.runs, values: ts.values })
      return { ...s, ts, ci }
    })
  }, [visible])

  const empty = rows.length === 0
  const plotHeight = height ?? Math.max(150, rows.length * 34 + 26)

  const maxX = rows.reduce((m, r) => Math.max(m, r.ci?.hi ?? r.ts.mean, r.ts.mean), 0)
  const fastest = rows[0]
  const slowest = rows[rows.length - 1]
  const gap = fastest && slowest ? slowest.ts.mean - fastest.ts.mean : 0

  const ariaLabel = empty
    ? 'Boarding time by strategy — no replications yet.'
    : `Boarding time by strategy, ${rows.length} strategies, fastest first. ` +
      `${fastest.label} is fastest at ${formatDurationLong(fastest.ts.mean)}; ` +
      `${slowest.label} is slowest at ${formatDurationLong(slowest.ts.mean)}, ` +
      `a spread of ${formatDurationLong(gap)}. Whiskers are 95% confidence intervals of the mean.`

  const table = {
    caption: 'Mean boarding time per strategy with 95% confidence interval.',
    columns: [
      { key: 'label', label: 'Strategy' },
      { key: 'runs', label: 'Runs', align: 'right' },
      { key: 'mean', label: 'Mean', align: 'right' },
      { key: 'ci', label: '95% CI', align: 'right' },
      { key: 'sd', label: 'SD', align: 'right' },
      { key: 'p05', label: 'p05', align: 'right' },
      { key: 'p95', label: 'p95', align: 'right' },
    ],
    rows: rows.map((r) => ({
      key: r.key,
      label: r.label,
      runs: formatNumber(r.runs),
      mean: formatDuration(r.ts.mean),
      ci: r.ci && !r.ci.wide ? `${formatDuration(r.ci.lo)} – ${formatDuration(r.ci.hi)}` : '—',
      sd: formatDuration(r.ts.sd),
      p05: formatDuration(r.ts.p05),
      p95: formatDuration(r.ts.p95),
    })),
  }

  return (
    <ChartFrame
      title="Boarding time by strategy"
      subtitle={empty ? 'waiting for the first replication' : `mean of ${runsLabel(batch, rows)} · 95% CI`}
      ariaLabel={ariaLabel}
      height={plotHeight}
      margin={{ top: 6, right: 68, bottom: 40, left: 132 }}
      empty={empty}
      emptyTitle={blank.title}
      emptyHint={blank.hint}
      table={table}
      onPointerLeave={hide}
      footnote="Whiskers show the 95% confidence interval of the mean — where two intervals overlap, the ranking between those two strategies is not yet established."
      tooltip={({ width, height: h }) => <ChartTooltip tip={tip} width={width} height={h} />}
    >
      {({ innerWidth, innerHeight, margin }) => {
        const y = bandScale({ domain: rows.map((r) => r.key), range: [0, innerHeight], padding: 0.34 })
        const x = linearScale({ domain: [0, maxX], range: [0, innerWidth], nice: true })
        const ticks = x.ticks(innerWidth < 320 ? 3 : 5)
        const barH = cappedBand(y.bandwidth(), BAR_CAP)
        const inset = bandInset(y.bandwidth(), BAR_CAP)

        return (
          <>
            <GridX scale={x} height={innerHeight} values={ticks} />
            <BandAxisLeft
              scale={y}
              format={(key) => rows.find((r) => r.key === key)?.label ?? key}
              maxChars={Math.max(8, Math.floor((margin.left - 12) / 6.6))}
            />
            <AxisBottom
              scale={x}
              y={innerHeight}
              width={innerWidth}
              values={ticks}
              format={formatDurationTick}
              label="Boarding time (m:ss)"
            />

            {rows.map((r) => {
              const top = y(r.key) + inset
              const w = Math.max(1, x(r.ts.mean))
              const hasCI = r.ci && !r.ci.wide
              const centre = top + barH / 2
              const labelX = Math.min(innerWidth + 60, Math.max(w, hasCI ? x(r.ci.hi) : w) + 7)
              return (
                <g key={r.key}>
                  <path
                    className="ch-animate"
                    d={roundedRightRect(0, top, w, barH, 4)}
                    fill={r.color}
                  />
                  {hasCI && (
                    <g stroke="var(--text-2)" strokeWidth={1.5} strokeLinecap="round" fill="none">
                      <line x1={x(r.ci.lo)} x2={x(r.ci.hi)} y1={centre} y2={centre} />
                      <line x1={x(r.ci.lo)} x2={x(r.ci.lo)} y1={centre - 4} y2={centre + 4} />
                      <line x1={x(r.ci.hi)} x2={x(r.ci.hi)} y1={centre - 4} y2={centre + 4} />
                    </g>
                  )}
                  <text
                    x={labelX}
                    y={centre + 4}
                    className="num"
                    style={{ fill: 'var(--text)', fontSize: 12, fontWeight: 600 }}
                  >
                    {formatDuration(r.ts.mean)}
                  </text>
                  <rect
                    className="ch-hit"
                    x={-6}
                    y={y(r.key)}
                    width={innerWidth + 12}
                    height={Math.max(24, y.bandwidth())}
                    tabIndex={0}
                    role="button"
                    aria-label={`${r.label}: mean ${formatDurationLong(r.ts.mean)} over ${r.runs} runs`}
                    onPointerMove={(e) => {
                      const pt = localPoint(e, { x: margin.left + w, y: centre + margin.top })
                      show(pt.x, centre + margin.top, {
                        title: r.label,
                        subtitle: `${formatNumber(r.runs)} replication${r.runs === 1 ? '' : 's'}`,
                        rows: [
                          { label: 'mean', value: formatDuration(r.ts.mean), color: r.color, kind: 'rect', strong: true },
                          hasCI
                            ? { label: '95% CI', value: `${formatDuration(r.ci.lo)} – ${formatDuration(r.ci.hi)}` }
                            : { label: '95% CI', value: 'needs ≥ 2 runs' },
                          { label: 'std dev', value: formatDuration(r.ts.sd) },
                          { label: 'p05 – p95', value: `${formatDuration(r.ts.p05)} – ${formatDuration(r.ts.p95)}` },
                        ],
                      })
                    }}
                    onFocus={() =>
                      show(innerWidth * 0.5, centre + margin.top, {
                        title: r.label,
                        rows: [
                          { label: 'mean', value: formatDuration(r.ts.mean), color: r.color, kind: 'rect', strong: true },
                          { label: 'runs', value: formatNumber(r.runs) },
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
