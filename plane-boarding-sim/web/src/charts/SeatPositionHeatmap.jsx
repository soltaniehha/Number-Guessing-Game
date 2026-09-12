import { useMemo } from 'react'
import { ChartFrame, emptyCopy } from './primitives/ChartFrame.jsx'
import { ChartTooltip, useTooltip, localPoint } from './primitives/Tooltip.jsx'
import { HeatLegend } from './primitives/Legend.jsx'
import { heatColor, heatLevel, heatBins } from './primitives/palette.js'
import { formatDuration, formatDurationLong, formatNumber } from './primitives/format.js'
import { useSeries, seatMapShape } from './selectors.js'

/**
 * Chart 9 — Time-to-seat by seat position.
 *
 * A heatmap shaped like the cabin: rows down, letters across, an aisle gap in
 * the middle. Magnitude ⇒ sequential colour (the `--heat-*` ramp in six bins,
 * with a stepped scale legend); the seat id and the seconds are both in the
 * read-out and the table, so nothing is colour-only.
 */
export function SeatPositionHeatmap({ batch, hidden, height = 380 }) {
  const { all, visible } = useSeries(batch, hidden)
  const { tip, show, hide } = useTooltip()
  // All series hidden is a different problem from no data — say which.
  const blank = all.length > 0 && visible.length === 0 ? emptyCopy('noStrategies') : emptyCopy('noSeatMap')

  const model = useMemo(() => {
    const target = visible.find(
      (s) => s.entry?.seatTimeMean && Object.keys(s.entry.seatTimeMean).length > 0,
    )
    if (!target) return null
    const seats = target.entry.seatTimeMean
    const { rows, letters } = seatMapShape(seats)
    if (rows.length === 0 || letters.length === 0) return null
    const values = Object.values(seats).filter(Number.isFinite)
    const min = Math.min(...values)
    const max = Math.max(...values)
    let worst = { id: null, value: -Infinity }
    let best = { id: null, value: Infinity }
    for (const [id, v] of Object.entries(seats)) {
      if (!Number.isFinite(v)) continue
      if (v > worst.value) worst = { id, value: v }
      if (v < best.value) best = { id, value: v }
    }
    return { target, seats, rows, letters, min, max, worst, best, split: Math.ceil(letters.length / 2) }
  }, [visible])

  const empty = model == null
  const bins = model ? heatBins(model.min, model.max) : []

  const ariaLabel = empty
    ? 'Time-to-seat by seat position — no per-seat data yet.'
    : `Mean seconds from jet-bridge to seated, by seat, for ${model.target.label}. ` +
      `Seat ${model.worst.id} waits longest at ${formatDurationLong(model.worst.value)}; ` +
      `seat ${model.best.id} is quickest at ${formatDurationLong(model.best.value)}.`

  const table = model
    ? {
        caption: `Mean time to seat by row — ${model.target.label}.`,
        columns: [
          { key: 'row', label: 'Row' },
          ...model.letters.map((l) => ({ key: l, label: l, align: 'right' })),
        ],
        rows: model.rows.map((row) => {
          const cells = { key: `r${row}`, row: `${row}` }
          for (const letter of model.letters) {
            const v = model.seats[`${row}${letter}`]
            cells[letter] = Number.isFinite(v) ? formatDuration(v) : '—'
          }
          return cells
        }),
      }
    : null

  const plotHeight = model ? Math.max(240, Math.min(560, model.rows.length * 11 + 44)) : height

  return (
    <ChartFrame
      title="Time to seat by seat position"
      subtitle={model ? `${model.target.label} · mean of ${formatNumber(model.target.runs)} runs` : 'waiting for per-seat data'}
      ariaLabel={ariaLabel}
      height={plotHeight}
      margin={{ top: 22, right: 12, bottom: 14, left: 30 }}
      empty={empty}
      emptyTitle={blank.title}
      emptyHint={blank.hint}
      table={table}
      legend={
        model && (
          <HeatLegend bins={bins} colorFor={heatColor} format={(v) => formatDuration(v)} title="Mean time to seat" />
        )
      }
      onPointerLeave={hide}
      footnote={model ? 'Nose at the top, tail at the bottom, aisle down the middle. A dark rear-window block is the honest cost of boarding people by ticket price. One strategy at a time: the first one left visible in the filter above.' : null}
      tooltip={({ width, height: h }) => <ChartTooltip tip={tip} width={width} height={h} />}
    >
      {({ innerWidth, innerHeight, margin }) => {
        if (!model) return null
        const { rows, letters, seats, min, max, split } = model
        const aisleUnits = 0.6
        const columns = letters.length + aisleUnits
        const cellW = innerWidth / columns
        const cellH = innerHeight / rows.length
        const gap = cellW >= 7 && cellH >= 7 ? 1.5 : 0
        const colX = (i) => (i < split ? i * cellW : (i + aisleUnits) * cellW)

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
            {letters.map((letter, i) => (
              <text
                key={`h-${letter}`}
                x={colX(i) + cellW / 2}
                y={-8}
                textAnchor="middle"
                style={{ fill: 'var(--text-3)', fontSize: 10.5, fontWeight: 600 }}
              >
                {letter}
              </text>
            ))}

            {rows.map((row, r) =>
              row % 5 === 0 || r === 0 ? (
                <text
                  key={`r-${row}`}
                  x={-6}
                  y={r * cellH + cellH / 2 + 3.5}
                  textAnchor="end"
                  className="num"
                  style={{ fill: 'var(--text-3)', fontSize: 9.5 }}
                >
                  {row}
                </text>
              ) : null,
            )}

            {rows.map((row, r) =>
              letters.map((letter, i) => {
                const value = seats[`${row}${letter}`]
                return (
                  <rect
                    key={`${row}${letter}`}
                    className="ch-animate"
                    x={colX(i)}
                    y={r * cellH}
                    width={Math.max(1, cellW - gap)}
                    height={Math.max(1, cellH - gap)}
                    rx={cellW > 9 ? 1.5 : 0}
                    fill={Number.isFinite(value) ? heatColor(heatLevel(value, min, max)) : 'var(--surface-3)'}
                  />
                )
              }),
            )}

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
                const localX = pt.x - margin.left
                const r = Math.max(0, Math.min(rows.length - 1, Math.floor((pt.y - margin.top) / cellH)))
                let col = null
                for (let i = 0; i < letters.length; i++) {
                  if (localX >= colX(i) && localX < colX(i) + cellW) { col = i; break }
                }
                if (col == null) return
                const id = `${rows[r]}${letters[col]}`
                const value = seats[id]
                show(pt.x, pt.y, {
                  title: `Seat ${id}`,
                  rows: [
                    {
                      label: 'mean time to seat',
                      value: Number.isFinite(value) ? formatDuration(value) : '—',
                      color: heatColor(heatLevel(value, min, max)),
                      kind: 'rect',
                      strong: true,
                    },
                  ],
                })
              }}
              onFocus={() =>
                show(innerWidth / 2, margin.top + 8, {
                  title: `Worst seat — ${model.worst.id}`,
                  rows: [
                    { label: 'mean time to seat', value: formatDuration(model.worst.value), color: heatColor(5), kind: 'rect', strong: true },
                    { label: `best — ${model.best.id}`, value: formatDuration(model.best.value) },
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
