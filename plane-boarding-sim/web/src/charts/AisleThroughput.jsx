import { useMemo, useState } from 'react'
import { ChartFrame, emptyCopy } from './primitives/ChartFrame.jsx'
import { AxisBottom, AxisLeft, GridY } from './primitives/Axis.jsx'
import { ChartTooltip, useTooltip, localPoint } from './primitives/Tooltip.jsx'
import { Legend } from './primitives/Legend.jsx'
import { linearScale, timeScale } from './primitives/scales.js'
import { linePath } from './primitives/shapes.js'
import { niceDomain } from './primitives/ticks.js'
import { formatDuration, formatDurationTick, formatNumber } from './primitives/format.js'
import { ORDINAL_STEPS_3 } from './primitives/palette.js'
import { useSeries } from './selectors.js'

const SECTIONS = [
  { key: 'fwd', label: 'Forward third', opacity: ORDINAL_STEPS_3[0] },
  { key: 'mid', label: 'Mid cabin', opacity: ORDINAL_STEPS_3[1] },
  { key: 'aft', label: 'Aft third', opacity: ORDINAL_STEPS_3[2] },
]

/**
 * Chart 12 — Aisle throughput.
 *
 * Bodies standing in the aisle over time, as a stacked area split by cabin
 * third. The split comes straight out of the congestion matrix (rows summed
 * within each third), so the stack is real data rather than an apportionment.
 *
 * Cabin thirds are an ORDERED category (nose → tail), so the colour job is
 * ordinal: one hue, three monotone steps of `--series-1`, validated with
 * `--ordinal` in both themes. Bands are separated by a 2px surface gap, never
 * an outline.
 */
export function AisleThroughput({ batch, hidden, height = 300 }) {
  const { all, visible } = useSeries(batch, hidden)
  const { tip, show, hide } = useTooltip()
  // All series hidden is a different problem from no data — say which.
  const blank = all.length > 0 && visible.length === 0 ? emptyCopy('noStrategies') : emptyCopy('noCongestion')
  const [crosshair, setCrosshair] = useState(null)

  const model = useMemo(() => {
    const target = visible.find((s) => Array.isArray(s.entry?.congestionMean) && s.entry.congestionMean.length > 0)
    if (!target) return null
    const matrix = target.entry.congestionMean
    const rows = matrix.length
    const buckets = matrix.reduce((m, r) => Math.max(m, r?.length ?? 0), 0)
    if (buckets === 0) return null
    const totalSeconds = target.entry?.totalSeconds?.mean ?? buckets * 30
    const bucketSeconds = totalSeconds / buckets
    const edge = Math.ceil(rows / 3)

    const samples = []
    for (let b = 0; b < buckets; b++) {
      const bucket = { t: b * bucketSeconds, fwd: 0, mid: 0, aft: 0 }
      for (let r = 0; r < rows; r++) {
        const v = matrix[r]?.[b]
        if (!Number.isFinite(v)) continue
        if (r < edge) bucket.fwd += v
        else if (r < edge * 2) bucket.mid += v
        else bucket.aft += v
      }
      bucket.total = bucket.fwd + bucket.mid + bucket.aft
      samples.push(bucket)
    }
    const peak = samples.reduce((best, s) => (best == null || s.total > best.total ? s : best), null)
    const maxTotal = peak?.total ?? 1
    return { target, samples, bucketSeconds, totalSeconds, peak, maxTotal, buckets }
  }, [visible])

  const empty = model == null

  const ariaLabel = empty
    ? 'Aisle throughput — no congestion matrix yet.'
    : `Bodies standing in the aisle over time for ${model.target.label}, split by cabin third. ` +
      `The aisle peaks at ${model.peak.total.toFixed(1)} people around ${formatDuration(model.peak.t)}, ` +
      `mostly in the ${['forward third', 'mid cabin', 'aft third'][[model.peak.fwd, model.peak.mid, model.peak.aft].indexOf(Math.max(model.peak.fwd, model.peak.mid, model.peak.aft))]}.`

  const table = model
    ? {
        caption: `Bodies in the aisle by cabin third — ${model.target.label}.`,
        columns: [
          { key: 'time', label: 'Time' },
          ...SECTIONS.map((s) => ({ key: s.key, label: s.label, align: 'right' })),
          { key: 'total', label: 'Total', align: 'right' },
        ],
        rows: model.samples.map((s, i) => ({
          key: `t${i}`,
          time: formatDuration(s.t),
          fwd: s.fwd.toFixed(2),
          mid: s.mid.toFixed(2),
          aft: s.aft.toFixed(2),
          total: s.total.toFixed(2),
        })),
      }
    : null

  return (
    <ChartFrame
      title="Aisle throughput"
      subtitle={model ? `${model.target.label} · bodies in the aisle, by cabin third` : 'waiting for a congestion matrix'}
      ariaLabel={ariaLabel}
      height={height}
      margin={{ top: 12, right: 18, bottom: 46, left: 46 }}
      empty={empty}
      emptyTitle={blank.title}
      emptyHint={blank.hint}
      table={table}
      legend={
        model && (
          <Legend
            items={SECTIONS.map((s) => ({ key: s.key, label: s.label, color: 'var(--series-1)', opacity: s.opacity }))}
            label="Cabin section"
            dense
          />
        )
      }
      onPointerLeave={() => { hide(); setCrosshair(null) }}
      footnote={model ? 'A flat-topped plateau means the aisle is saturated — extra passengers at the door just queue. A spiky, low profile means the aisle is starved and the door is the bottleneck. One strategy at a time: the first one left visible in the filter above.' : null}
      tooltip={({ width, height: h }) => <ChartTooltip tip={tip} width={width} height={h} />}
    >
      {({ innerWidth, innerHeight, margin }) => {
        if (!model) return null
        const { samples, maxTotal } = model
        const x = timeScale({ domain: [0, samples[samples.length - 1]?.t || 1], range: [0, innerWidth] })
        const y = linearScale({ domain: niceDomain(0, maxTotal * 1.08, 4), range: [innerHeight, 0] })
        const yTicks = y.ticks(4)
        const xTicks = x.ticks(innerWidth < 340 ? 3 : 5)

        // cumulative boundaries, bottom (fwd) upward
        const boundaries = []
        let cumulative = samples.map(() => 0)
        for (const section of SECTIONS) {
          const next = samples.map((s, i) => cumulative[i] + s[section.key])
          boundaries.push({ section, lower: cumulative, upper: next })
          cumulative = next
        }

        return (
          <>
            <GridY scale={y} width={innerWidth} values={yTicks} />
            <AxisLeft scale={y} height={innerHeight} values={yTicks} format={(v) => formatNumber(v, 0)} />
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
              Bodies in aisle
            </text>

            {boundaries.map(({ section, lower, upper }) => {
              const top = samples.map((s, i) => `${x(s.t).toFixed(2)},${y(upper[i]).toFixed(2)}`).join('L')
              const bottom = [...samples]
                .map((s, i) => ({ s, i }))
                .reverse()
                .map(({ s, i }) => `${x(s.t).toFixed(2)},${y(lower[i]).toFixed(2)}`)
                .join('L')
              return (
                <path
                  key={section.key}
                  d={`M${top}L${bottom}Z`}
                  fill="var(--series-1)"
                  fillOpacity={section.opacity}
                />
              )
            })}

            {/* 2px surface gap between touching fills — the spacer, not a border */}
            {boundaries.slice(0, -1).map(({ section, upper }) => (
              <path
                key={`gap-${section.key}`}
                d={linePath(samples.map((s, i) => [x(s.t), y(upper[i])]))}
                fill="none"
                stroke="var(--surface)"
                strokeWidth={2}
              />
            ))}

            {crosshair != null && (
              <line
                x1={x(crosshair.t)}
                x2={x(crosshair.t)}
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
              aria-label={ariaLabel}
              onPointerMove={(e) => {
                const pt = localPoint(e)
                const t = x.invert(pt.x - margin.left)
                const snap = samples.reduce(
                  (best, s) => (best == null || Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best),
                  null,
                )
                if (!snap) return
                setCrosshair(snap)
                show(x(snap.t) + margin.left, margin.top + 6, {
                  title: formatDuration(snap.t),
                  subtitle: 'bodies in the aisle',
                  rows: [
                    { label: 'total', value: snap.total.toFixed(1), strong: true },
                    ...SECTIONS.map((s) => ({
                      label: s.label,
                      value: snap[s.key].toFixed(1),
                      color: 'var(--series-1)',
                      opacity: s.opacity,
                      kind: 'rect',
                    })),
                  ],
                })
              }}
              onFocus={() => {
                setCrosshair(model.peak)
                show(x(model.peak.t) + margin.left, margin.top + 6, {
                  title: `Peak at ${formatDuration(model.peak.t)}`,
                  rows: [
                    { label: 'total', value: model.peak.total.toFixed(1), strong: true },
                    ...SECTIONS.map((s) => ({
                      label: s.label,
                      value: model.peak[s.key].toFixed(1),
                      color: 'var(--series-1)',
                      opacity: s.opacity,
                      kind: 'rect',
                    })),
                  ],
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
