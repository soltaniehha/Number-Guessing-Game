import { useMemo } from 'react'
import { ChartFrame, emptyCopy } from './primitives/ChartFrame.jsx'
import { AxisBottom, BandAxisLeft, GridX } from './primitives/Axis.jsx'
import { ChartTooltip, useTooltip, localPoint } from './primitives/Tooltip.jsx'
import { bandScale, cappedBand, bandInset, linearScale } from './primitives/scales.js'
import { niceDomain } from './primitives/ticks.js'
import { formatDuration, formatDurationTick, formatDurationLong, formatNumber } from './primitives/format.js'
import { boxFromPooled } from './primitives/stats.js'
import { useSeries, byMeanAsc, runsLabel } from './selectors.js'

const BOX_CAP = 18

/**
 * Chart 8 — Passenger wait time.
 *
 * Box plots of individual time-to-seat, so a fast mean cannot hide a
 * miserable tail. The p90 is direct-labelled — that is the number the
 * chart exists to show, and it is the one a mean-only bar chart buries.
 */
export function WaitTimeBoxes({ batch, hidden, height = null }) {
  const { all, visible } = useSeries(batch, hidden)
  const { tip, show, hide } = useTooltip()
  // All series hidden is a different problem from no data — say which.
  const blank = all.length > 0 && visible.length === 0 ? emptyCopy('noStrategies') : emptyCopy('noRuns')

  const rows = useMemo(() => {
    const withData = visible
      .map((s) => ({ ...s, box: boxFromPooled(s.entry?.perPassengerPooled) }))
      .filter((s) => s.box && Number.isFinite(s.box.median))
    return byMeanAsc(withData)
  }, [visible])

  const empty = rows.length === 0
  const plotHeight = height ?? Math.max(170, rows.length * 34 + 34)

  const domain = useMemo(() => {
    if (rows.length === 0) return [0, 1]
    const lo = Math.min(...rows.map((r) => r.box.whiskerLow ?? r.box.min ?? 0))
    const hi = Math.max(...rows.map((r) => r.box.whiskerHigh ?? r.box.max ?? 1))
    return niceDomain(Math.max(0, lo * 0.92), hi * 1.02, 5)
  }, [rows])

  const worstTail = rows.reduce(
    (best, r) => (best == null || (r.box.p90 ?? r.box.whiskerHigh) > (best.box.p90 ?? best.box.whiskerHigh) ? r : best),
    null,
  )
  const bestMedian = rows.reduce((best, r) => (best == null || r.box.median < best.box.median ? r : best), null)

  const ariaLabel = empty
    ? 'Passenger wait time — no pooled passenger data yet.'
    : `Distribution of individual time-to-seat for ${rows.length} strategies. ` +
      (bestMedian ? `${bestMedian.label} has the best median at ${formatDurationLong(bestMedian.box.median)}. ` : '') +
      (worstTail ? `${worstTail.label} has the worst tail: one passenger in ten waits over ${formatDurationLong(worstTail.box.p90 ?? worstTail.box.whiskerHigh)}.` : '')

  const table = {
    caption: 'Individual time-to-seat, pooled across replications.',
    columns: [
      { key: 'label', label: 'Strategy' },
      { key: 'p05', label: 'p05', align: 'right' },
      { key: 'q1', label: 'q1', align: 'right' },
      { key: 'median', label: 'Median', align: 'right' },
      { key: 'q3', label: 'q3', align: 'right' },
      { key: 'p90', label: 'p90', align: 'right' },
      { key: 'max', label: 'Worst', align: 'right' },
    ],
    rows: rows.map((r) => ({
      key: r.key,
      label: r.label,
      p05: formatDuration(r.box.whiskerLow),
      q1: formatDuration(r.box.q1),
      median: formatDuration(r.box.median),
      q3: formatDuration(r.box.q3),
      p90: formatDuration(r.box.p90 ?? r.box.whiskerHigh),
      max: formatDuration(r.box.max),
    })),
  }

  return (
    <ChartFrame
      title="Passenger wait time"
      subtitle={empty ? 'waiting for pooled passenger data' : `time from jet-bridge to seated · ${runsLabel(batch, rows)}`}
      ariaLabel={ariaLabel}
      height={plotHeight}
      margin={{ top: 8, right: 62, bottom: 42, left: 132 }}
      empty={empty}
      emptyTitle={blank.title}
      emptyHint={blank.hint}
      table={table}
      onPointerLeave={hide}
      footnote="Box spans the middle half of passengers, the line inside is the median, whiskers reach p05 and p95, and the labelled tick is the p90 — the “unlucky one in ten” a mean never shows."
      tooltip={({ width, height: h }) => <ChartTooltip tip={tip} width={width} height={h} />}
    >
      {({ innerWidth, innerHeight, margin }) => {
        const y = bandScale({ domain: rows.map((r) => r.key), range: [0, innerHeight], padding: 0.38 })
        const x = linearScale({ domain, range: [0, innerWidth] })
        const ticks = x.ticks(innerWidth < 340 ? 3 : 5)
        const boxH = cappedBand(y.bandwidth(), BOX_CAP)
        const inset = bandInset(y.bandwidth(), BOX_CAP)

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
              label="Time to seat (m:ss)"
            />

            {rows.map((r) => {
              const top = y(r.key) + inset
              const centre = top + boxH / 2
              const b = r.box
              const p90 = b.p90 ?? b.whiskerHigh
              return (
                <g key={r.key}>
                  <line
                    x1={x(b.whiskerLow)}
                    x2={x(b.whiskerHigh)}
                    y1={centre}
                    y2={centre}
                    stroke={r.color}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                  />
                  <line x1={x(b.whiskerLow)} x2={x(b.whiskerLow)} y1={centre - 5} y2={centre + 5} stroke={r.color} strokeWidth={1.5} />
                  <line x1={x(b.whiskerHigh)} x2={x(b.whiskerHigh)} y1={centre - 5} y2={centre + 5} stroke={r.color} strokeWidth={1.5} />
                  <rect
                    className="ch-animate"
                    x={x(b.q1)}
                    y={top}
                    width={Math.max(2, x(b.q3) - x(b.q1))}
                    height={boxH}
                    rx={3}
                    fill={r.color}
                    fillOpacity={0.22}
                    stroke={r.color}
                    strokeWidth={1.5}
                  />
                  <line
                    x1={x(b.median)}
                    x2={x(b.median)}
                    y1={top}
                    y2={top + boxH}
                    stroke={r.color}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                  />
                  {Number.isFinite(p90) && (
                    <>
                      <line
                        x1={x(p90)}
                        x2={x(p90)}
                        y1={top - 3}
                        y2={top + boxH + 3}
                        stroke="var(--text-2)"
                        strokeWidth={1}
                      />
                      <text
                        x={Math.min(innerWidth + 56, x(p90) + 6)}
                        y={centre + 4}
                        className="num"
                        style={{ fill: 'var(--text-2)', fontSize: 10.5 }}
                      >
                        {formatDuration(p90)}
                      </text>
                    </>
                  )}
                  <rect
                    className="ch-hit"
                    x={0}
                    y={y(r.key)}
                    width={innerWidth}
                    height={Math.max(24, y.bandwidth())}
                    tabIndex={0}
                    role="button"
                    aria-label={`${r.label}: median ${formatDurationLong(b.median)}, p90 ${formatDurationLong(p90)}`}
                    onPointerMove={(e) => {
                      const pt = localPoint(e, { x: margin.left + x(b.median), y: centre + margin.top })
                      show(pt.x, centre + margin.top, {
                        title: r.label,
                        subtitle: `${formatNumber(b.n)} passengers pooled`,
                        rows: [
                          { label: 'median', value: formatDuration(b.median), color: r.color, kind: 'rect', strong: true },
                          { label: 'middle half', value: `${formatDuration(b.q1)} – ${formatDuration(b.q3)}` },
                          { label: 'p90', value: formatDuration(p90) },
                          { label: 'worst seen', value: formatDuration(b.max) },
                        ],
                      })
                    }}
                    onFocus={() =>
                      show(x(b.median) + margin.left, centre + margin.top, {
                        title: r.label,
                        rows: [
                          { label: 'median', value: formatDuration(b.median), color: r.color, kind: 'rect', strong: true },
                          { label: 'p90', value: formatDuration(p90) },
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
