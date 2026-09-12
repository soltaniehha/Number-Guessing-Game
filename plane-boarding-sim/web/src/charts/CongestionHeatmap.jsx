import { useMemo } from 'react'
import { ChartFrame, emptyCopy } from './primitives/ChartFrame.jsx'
import { AxisBottom } from './primitives/Axis.jsx'
import { ChartTooltip, useTooltip, localPoint } from './primitives/Tooltip.jsx'
import { HeatLegend } from './primitives/Legend.jsx'
import { timeScale } from './primitives/scales.js'
import { heatColor, heatLevel, heatBins } from './primitives/palette.js'
import { formatDuration, formatDurationTick, formatNumber } from './primitives/format.js'
import { thinTicks } from './primitives/ticks.js'
import { useSeries, matrixExtent } from './selectors.js'

/**
 * Chart 4 — Aisle congestion heatmap (row × time).
 *
 * Magnitude, so the colour job is SEQUENTIAL: the frozen `--heat-*` ramp,
 * quantised into six bins with a stepped scale legend. Colour is never the
 * only channel — the read-out and the table view both carry the number.
 *
 * One matrix at a time; the chart follows the first strategy left visible in
 * the dashboard filter rather than growing a filter of its own.
 */
export function CongestionHeatmap({ batch, hidden, height = 320 }) {
  const { all, visible } = useSeries(batch, hidden)
  const { tip, show, hide } = useTooltip()
  // All series hidden is a different problem from no data — say which.
  const blank = all.length > 0 && visible.length === 0 ? emptyCopy('noStrategies') : emptyCopy('noCongestion')

  const model = useMemo(() => {
    const target = visible.find((s) => Array.isArray(s.entry?.congestionMean) && s.entry.congestionMean.length > 0)
    if (!target) return null
    const matrix = target.entry.congestionMean
    const buckets = matrix.reduce((m, row) => Math.max(m, row?.length ?? 0), 0)
    if (buckets === 0) return null
    const [min, max] = matrixExtent(matrix)
    const totalSeconds = target.entry?.totalSeconds?.mean ?? buckets * 30
    const bucketSeconds = totalSeconds / buckets

    let peak = { value: -Infinity, row: 0, bucket: 0 }
    matrix.forEach((row, r) =>
      (row ?? []).forEach((v, b) => {
        if (Number.isFinite(v) && v > peak.value) peak = { value: v, row: r, bucket: b }
      }),
    )
    return { target, matrix, buckets, rows: matrix.length, min, max, bucketSeconds, totalSeconds, peak }
  }, [visible])

  const empty = model == null
  const bins = model ? heatBins(model.min, model.max) : []

  const ariaLabel = empty
    ? 'Aisle congestion heatmap — no matrix yet.'
    : `Aisle congestion for ${model.target.label}: mean bodies standing in the aisle by cabin row and time. ` +
      `The worst jam is ${model.peak.value.toFixed(1)} people at row ${model.peak.row + 1}, around ` +
      `${formatDuration(model.peak.bucket * model.bucketSeconds)} into boarding.`

  const table = model
    ? {
        caption: `Mean bodies in the aisle by row, sampled every ${Math.round(model.bucketSeconds)}s — ${model.target.label}.`,
        columns: [
          { key: 'row', label: 'Row' },
          { key: 'peak', label: 'Peak bodies', align: 'right' },
          { key: 'at', label: 'Peak at', align: 'right' },
          { key: 'mean', label: 'Mean bodies', align: 'right' },
        ],
        rows: model.matrix.map((row, r) => {
          const cells = (row ?? []).filter(Number.isFinite)
          const peak = cells.length ? Math.max(...cells) : 0
          const at = (row ?? []).indexOf(peak)
          return {
            key: `row-${r}`,
            row: `Row ${r + 1}`,
            peak: peak.toFixed(2),
            at: formatDuration(at * model.bucketSeconds),
            mean: cells.length ? (cells.reduce((a, b) => a + b, 0) / cells.length).toFixed(2) : '—',
          }
        }),
      }
    : null

  const plotHeight = model ? Math.max(240, Math.min(520, model.rows * 9 + 56)) : height

  return (
    <ChartFrame
      title="Aisle congestion"
      subtitle={model ? `${model.target.label} · mean of ${formatNumber(model.target.runs)} runs` : 'waiting for a matrix'}
      ariaLabel={ariaLabel}
      height={plotHeight}
      margin={{ top: 8, right: 12, bottom: 40, left: 40 }}
      empty={empty}
      emptyTitle={blank.title}
      emptyHint={blank.hint}
      table={table}
      legend={
        model && (
          <HeatLegend
            bins={bins}
            colorFor={heatColor}
            format={(v) => v.toFixed(1)}
            title="Bodies in the aisle"
          />
        )
      }
      onPointerLeave={hide}
      footnote={
        model
          ? 'Rows run front (top) to rear (bottom); time runs left to right. A bright horizontal streak is a queue parked at one row — that is a jam, not traffic. One strategy at a time: the first one left visible in the filter above.'
          : null
      }
      tooltip={({ width, height: h }) => <ChartTooltip tip={tip} width={width} height={h} />}
    >
      {({ innerWidth, innerHeight, margin }) => {
        if (!model) return null
        const { matrix, buckets, rows, bucketSeconds, min, max } = model
        const cellW = innerWidth / buckets
        const cellH = innerHeight / rows
        const gap = cellW >= 6 && cellH >= 6 ? 1 : 0
        const x = timeScale({ domain: [0, buckets * bucketSeconds], range: [0, innerWidth] })
        const xTicks = thinTicks(x.ticks(innerWidth < 340 ? 3 : 6), 6)
        const rowTicks = [1, Math.ceil(rows / 2), rows]

        return (
          <>
            <rect
              x={-0.5}
              y={-0.5}
              width={innerWidth + 1}
              height={innerHeight + 1}
              fill="none"
              stroke="var(--border)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            {matrix.map((row, r) =>
              (row ?? []).map((v, b) => (
                <rect
                  key={`${r}-${b}`}
                  className="ch-animate"
                  x={b * cellW}
                  y={r * cellH}
                  width={Math.max(0.5, cellW - gap)}
                  height={Math.max(0.5, cellH - gap)}
                  fill={heatColor(heatLevel(v, min, max))}
                  shapeRendering="crispEdges"
                />
              )),
            )}

            {rowTicks.map((r) => (
              <text
                key={`rt-${r}`}
                x={-8}
                y={(r - 0.5) * cellH + 4}
                textAnchor="end"
                className="num"
                style={{ fill: 'var(--text-3)', fontSize: 10 }}
              >
                {r}
              </text>
            ))}
            <text
              transform={`translate(${-30},${innerHeight / 2}) rotate(-90)`}
              textAnchor="middle"
              style={{ fill: 'var(--text-2)', fontSize: 11, fontWeight: 500 }}
            >
              Cabin row
            </text>

            <AxisBottom
              scale={x}
              y={innerHeight}
              width={innerWidth}
              values={xTicks}
              format={formatDurationTick}
              label="Time since boarding started (m:ss)"
            />

            <rect
              className="ch-hit"
              x={0}
              y={0}
              width={innerWidth}
              height={innerHeight}
              tabIndex={0}
              role="button"
              aria-label={ariaLabel}
              onPointerMove={(e) => {
                const pt = localPoint(e)
                const b = Math.max(0, Math.min(buckets - 1, Math.floor((pt.x - margin.left) / cellW)))
                const r = Math.max(0, Math.min(rows - 1, Math.floor((pt.y - margin.top) / cellH)))
                const value = matrix[r]?.[b]
                show(pt.x, pt.y, {
                  title: `Row ${r + 1}`,
                  subtitle: `${formatDuration(b * bucketSeconds)} – ${formatDuration((b + 1) * bucketSeconds)}`,
                  rows: [
                    {
                      label: 'bodies in aisle',
                      value: Number.isFinite(value) ? value.toFixed(2) : '—',
                      color: heatColor(heatLevel(value, min, max)),
                      kind: 'rect',
                      strong: true,
                    },
                  ],
                })
              }}
              onFocus={() =>
                show(x(model.peak.bucket * bucketSeconds) + margin.left, model.peak.row * cellH + margin.top, {
                  title: `Worst jam — row ${model.peak.row + 1}`,
                  subtitle: formatDuration(model.peak.bucket * bucketSeconds),
                  rows: [
                    {
                      label: 'bodies in aisle',
                      value: model.peak.value.toFixed(2),
                      color: heatColor(5),
                      kind: 'rect',
                      strong: true,
                    },
                  ],
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
