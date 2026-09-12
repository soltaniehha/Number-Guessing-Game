import { useMemo } from 'react'
import { ChartFrame, emptyCopy } from './primitives/ChartFrame.jsx'
import { AxisBottom } from './primitives/Axis.jsx'
import { ChartTooltip, useTooltip, localPoint } from './primitives/Tooltip.jsx'
import { HeatLegend } from './primitives/Legend.jsx'
import { HeatCanvas } from './primitives/HeatCanvas.jsx'
import { timeScale } from './primitives/scales.js'
import { heatColor, heatLevel, heatBins } from './primitives/palette.js'
import { formatDuration, formatDurationTick, formatNumber } from './primitives/format.js'
import { thinTicks } from './primitives/ticks.js'
import { useSeries, matrixExtent, sampleIntervalOf, rowNumbersOf } from './selectors.js'

/** "2s" / "2.5s" — the sample interval as the caption writes it. */
const everySeconds = (s) => `${Number.isInteger(s) ? s : Number(s.toFixed(2))}s`

/**
 * Chart 4 — Aisle congestion heatmap (row × time).
 *
 * Magnitude, so the colour job is SEQUENTIAL: the frozen `--heat-*` ramp,
 * quantised into six bins with a stepped scale legend. Colour is never the
 * only channel — the read-out and the table view both carry the number.
 *
 * One matrix at a time; the chart follows the first strategy left visible in
 * the dashboard filter rather than growing a filter of its own.
 *
 * Two things this chart must read rather than guess, because guessing them
 * produced confidently wrong numbers:
 *
 * - **Column width is `meta.sampleInterval`** (ENGINE_SPEC §7), not
 *   `totalSeconds.mean / columns`. The matrix is a fixed 2 s grid that stops
 *   when the shortest replication stopped, so the ratio is off by the
 *   truncation — 2.234 s instead of 2.0 on a320neo/random/0.92, an 11.7%
 *   stretch of the x axis and of every "worst jam at N seconds" read-out.
 * - **Rows are row SLOTS, not row numbers** (ENGINE_SPEC §2.1). Labels come
 *   from `meta.rowSlots[].number`; without it the chart labels by slot instead
 *   of inventing a row number.
 *
 * The cells are painted on a canvas (`HeatCanvas`) rather than as one `<rect>`
 * each: this matrix is 10,000-20,000 cells and it re-renders on every progress
 * tick of a streaming batch. Axes, frame, hit layer and table view stay in the
 * DOM, so hover, keyboard and screen-reader behaviour are unchanged.
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
    const rows = matrix.length

    // Seconds per column: read from the batch, never divided out of the mean.
    const bucketSeconds = sampleIntervalOf(batch)
    const coveredSeconds = buckets * bucketSeconds
    const meanTotal = target.entry?.totalSeconds?.mean
    // The aggregator averages over the columns every replication has, so a
    // batch whose runs differ in length is cropped to the shortest one — and
    // the tail is where the late jams are. We cannot un-crop it here; we can
    // refuse to pretend the window is the whole run.
    const truncated = Number.isFinite(meanTotal) && meanTotal > coveredSeconds * 1.02

    const { numbers, exact } = rowNumbersOf(batch, rows)
    // Slot index -> printed row number. Without the mapping we say "slot",
    // because `slot + 1` is only the row number on an aircraft that starts at
    // row 1 and skips nothing.
    const rowName = (r) => (exact ? `Row ${numbers[r]}` : `Row slot ${r}`)
    const rowTick = (r) => (exact ? `${numbers[r]}` : `${r}`)

    let peak = { value: -Infinity, row: 0, bucket: 0 }
    matrix.forEach((row, r) =>
      (row ?? []).forEach((v, b) => {
        if (Number.isFinite(v) && v > peak.value) peak = { value: v, row: r, bucket: b }
      }),
    )
    return {
      target,
      matrix,
      buckets,
      rows,
      min,
      max,
      bucketSeconds,
      coveredSeconds,
      meanTotal,
      truncated,
      rowNumbers: numbers,
      rowsExact: exact,
      rowName,
      rowTick,
      peak,
    }
  }, [visible, batch])

  const empty = model == null
  const bins = model ? heatBins(model.min, model.max) : []

  // Said the same way in the caption, the footnote and the description: this
  // window is shorter than the runs it summarises.
  const windowNote = model?.truncated
    ? `Covers the first ${formatDuration(model.coveredSeconds)} of boarding against a mean run of ` +
      `${formatDuration(model.meanTotal)} — the matrix stops where the shortest replication stopped, ` +
      'so any jam later than that is not in this batch.'
    : null

  const ariaLabel = empty
    ? 'Aisle congestion heatmap — no matrix yet.'
    : `Aisle congestion for ${model.target.label}: mean bodies standing in the aisle by cabin ` +
      `${model.rowsExact ? 'row' : 'row slot'} and time, sampled every ${everySeconds(model.bucketSeconds)}. ` +
      `The worst jam is ${model.peak.value.toFixed(1)} people at ${model.rowName(model.peak.row).toLowerCase()}, around ` +
      `${formatDuration(model.peak.bucket * model.bucketSeconds)} into boarding.` +
      (windowNote ? ` ${windowNote}` : '')

  const table = model
    ? {
        caption:
          `Mean bodies in the aisle by ${model.rowsExact ? 'row' : 'row slot'}, sampled every ` +
          `${everySeconds(model.bucketSeconds)} — ${model.target.label}.` +
          (windowNote ? ` ${windowNote}` : ''),
        columns: [
          { key: 'row', label: model.rowsExact ? 'Row' : 'Row slot' },
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
            row: model.rowName(r),
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
          ? 'Rows run front (top) to rear (bottom); time runs left to right. A bright horizontal streak is a queue parked at one row — that is a jam, not traffic. One strategy at a time: the first one left visible in the filter above.' +
            (windowNote ? ` ${windowNote}` : '')
          : null
      }
      overlay={({ innerWidth, innerHeight, margin }) =>
        model ? (
          <HeatCanvas
            matrix={model.matrix}
            rows={model.rows}
            columns={model.buckets}
            min={model.min}
            max={model.max}
            width={innerWidth}
            height={innerHeight}
            left={margin.left}
            top={margin.top}
          />
        ) : null
      }
      tooltip={({ width, height: h }) => <ChartTooltip tip={tip} width={width} height={h} />}
    >
      {({ innerWidth, innerHeight, margin }) => {
        if (!model) return null
        const { matrix, buckets, rows, bucketSeconds, min, max } = model
        const cellW = innerWidth / buckets
        const cellH = innerHeight / rows
        const x = timeScale({ domain: [0, model.coveredSeconds], range: [0, innerWidth] })
        const xTicks = thinTicks(x.ticks(innerWidth < 340 ? 3 : 6), 6)
        // Slot indices, not row numbers: these place the label. The text comes
        // from `rowTick`, which knows the difference.
        const rowTicks = [...new Set([0, Math.floor((rows - 1) / 2), rows - 1])].filter((r) => r >= 0)

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

            {rowTicks.map((r) => (
              <text
                key={`rt-${r}`}
                x={-8}
                y={(r + 0.5) * cellH + 4}
                textAnchor="end"
                className="num"
                style={{ fill: 'var(--text-3)', fontSize: 10 }}
              >
                {model.rowTick(r)}
              </text>
            ))}
            <text
              transform={`translate(${-30},${innerHeight / 2}) rotate(-90)`}
              textAnchor="middle"
              style={{ fill: 'var(--text-2)', fontSize: 11, fontWeight: 500 }}
            >
              {model.rowsExact ? 'Cabin row' : 'Cabin row slot'}
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
                  title: model.rowName(r),
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
                  title: `Worst jam — ${model.rowName(model.peak.row).toLowerCase()}`,
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
