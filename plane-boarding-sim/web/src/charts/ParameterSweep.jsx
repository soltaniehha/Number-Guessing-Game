import { useMemo, useState } from 'react'
import { ChartFrame, emptyCopy } from './primitives/ChartFrame.jsx'
import { AxisBottom, AxisLeft, GridY } from './primitives/Axis.jsx'
import { ChartTooltip, useTooltip, localPoint } from './primitives/Tooltip.jsx'
import { Legend } from './primitives/Legend.jsx'
import { linearScale } from './primitives/scales.js'
import { linePath } from './primitives/shapes.js'
import { niceDomain } from './primitives/ticks.js'
import { formatDuration, formatDurationTick, formatDurationLong, formatPercent, formatTick } from './primitives/format.js'
import { shapePath } from './primitives/palette.js'
import { useSeries, legendItems } from './selectors.js'

const pct = (v) => formatPercent(v)
const dec = (v) => (Number.isInteger(v) ? `${v}` : `${Number(v.toFixed(2))}`)
const int = (v) => `${Math.round(v)}`

/**
 * How each sweepable axis is written.
 *
 * The set is closed: it mirrors `SWEEPABLE` in `src/sim/batch.js`, which is the
 * engine's own whitelist and the same list the panel offers. Only the
 * PRESENTATION lives here — which words and which unit — because that is the
 * part the chart owns; the points and the data come from the batch.
 *
 * A parameter with no entry still plots correctly: it falls back to a plain
 * number and its own key, rather than to load factor's percent, which is how
 * a zone-count sweep came to be labelled "200% … 600% full".
 */
const AXES = {
  loadFactor: {
    name: 'Load factor',
    axis: 'Load factor (% of seats sold)',
    blurb: 'how full the aircraft is',
    format: pct,
    point: (v) => `${pct(v)} full`,
    note: 'A ranking that only holds at 100% load is not a ranking — check that your winner still wins on a two-thirds-full Tuesday.',
  },
  preboardRate: {
    name: 'Preboarding rate',
    axis: 'Preboards (% of the cabin)',
    blurb: 'how much of the cabin preboards',
    format: pct,
    point: (v) => `${pct(v)} preboarding`,
    note: 'Watch for the knee: past roughly 15% the preboard block, not the boarding order, is what sets the time.',
  },
  nonComplianceRate: {
    name: 'Non-compliance',
    axis: 'Passengers ignoring their group (%)',
    blurb: 'how many passengers ignore their called group',
    format: pct,
    point: (v) => `${pct(v)} non-compliant`,
    note: 'Strategy differences narrow as compliance falls — a scheme nobody follows is a free-for-all.',
  },
  lateRate: {
    name: 'Late arrivals',
    axis: 'Passengers arriving late (%)',
    blurb: 'how many passengers arrive after their group',
    format: pct,
    point: (v) => `${pct(v)} arriving late`,
    note: 'Late arrivals board last whatever their group says, so they cost about the same under every strategy.',
  },
  stowPassSpeedFactor: {
    name: 'Squeeze-past speed',
    axis: 'Squeeze-past speed (× free flow)',
    blurb: 'how easily people squeeze past someone stowing',
    format: dec,
    point: (v) => `squeeze-past ×${dec(v)}`,
    note: '0 is strict blocking, where a stowing passenger closes the aisle. The gap between 0 and 0.2 is how much of a strategy’s advantage is really "avoiding a stow-block".',
  },
  binCongestionWeight: {
    name: 'Bin-congestion penalty',
    axis: 'Bin-congestion stow penalty',
    blurb: 'how much a nearly-full bin slows a stow',
    format: dec,
    point: (v) => `penalty ${dec(v)}`,
    note: 'How much a nearly-full bin slows a stow — the main reason the same passenger takes different times under different strategies.',
  },
  eliteForwardBias: {
    name: 'Status forward bias',
    axis: 'Forward concentration of status (0 = even, 1 = all forward)',
    blurb: 'how far forward status sits in the cabin',
    format: dec,
    point: (v) => `bias ${dec(v)}`,
    note: 'The curve that answers "does selling priority boarding cost time?" — status-ordered strategies climb as status concentrates forward; everything else stays flat.',
  },
  zoneCount: {
    name: 'Zone count',
    axis: 'Number of boarding zones',
    blurb: 'how many boarding zones are called',
    format: int,
    point: (v) => `${int(v)} zone${Math.round(v) === 1 ? '' : 's'}`,
    note: 'Only the zone strategies move. More zones is finer spatial control and more announcements.',
  },
}

/** Presentation for a swept parameter; a plain numeric axis for anything new. */
export function sweepAxisCopy(param) {
  const known = AXES[param]
  if (known) return known
  const name = param ? String(param).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()) : 'Swept value'
  return {
    name,
    axis: name,
    blurb: `the swept ${name.toLowerCase()}`,
    // A plain number: `dec` up to four figures, then formatTick's `k` form.
    format: (v) => (Math.abs(v) >= 1000 ? formatTick(v) : dec(v)),
    point: (v) => (Math.abs(v) >= 1000 ? formatTick(v) : dec(v)),
    note: 'Where lines cross, the ranking flips — check that your winner still wins at the setting you actually fly.',
  }
}

/**
 * Chart 7 — Parameter sweep.
 *
 * Boarding time against ONE swept scenario parameter, one line per strategy.
 * Renders only when the batch carries `sweep`; otherwise it explains, in the
 * empty state, exactly how to produce one instead of showing a blank box.
 *
 * The axis is whatever `sweep.param` says it is. Load factor is the classic
 * one and the one the spec is written around, but the engine's `SWEEPABLE`
 * list has eight — and reading the points as load factors regardless printed
 * a zone-count sweep as "200% … 600% full", which is the kind of wrong that
 * looks authoritative.
 */
export function ParameterSweep({ batch, hidden, height = 300 }) {
  const { all, visible } = useSeries(batch, hidden)
  const { tip, show, hide } = useTooltip()
  // All series hidden is a different problem from no data — say which.
  const blank = all.length > 0 && visible.length === 0 ? emptyCopy('noStrategies') : emptyCopy('noSweep')
  const [crosshair, setCrosshair] = useState(null)

  const model = useMemo(() => {
    const sweep = batch?.sweep
    // `values` is the general name; `loadFactors` is the alias the worker and
    // the runner both still emit for the classic axis.
    const points = Array.isArray(sweep?.values) && sweep.values.length
      ? sweep.values
      : Array.isArray(sweep?.loadFactors)
        ? sweep.loadFactors
        : null
    if (!points || points.length === 0) return null
    const rows = visible
      .map((s) => {
        const values = sweep.byStrategy?.[s.key]
        if (!Array.isArray(values) || values.length === 0) return null
        const series = points
          .map((v, i) => ({ v, seconds: values[i] }))
          .filter((p) => Number.isFinite(p.seconds))
        return series.length ? { ...s, points: series } : null
      })
      .filter(Boolean)
    if (rows.length === 0) return null
    const seconds = rows.flatMap((r) => r.points.map((p) => p.seconds))
    return {
      rows,
      values: points,
      copy: sweepAxisCopy(sweep.param),
      yDomain: niceDomain(Math.min(...seconds) * 0.96, Math.max(...seconds), 5),
      xDomain: [Math.min(...points), Math.max(...points)],
    }
  }, [batch, visible])

  const empty = model == null
  const copy = model?.copy

  const ariaLabel = empty
    ? 'Parameter sweep — no sweep data in this batch.'
    : `Mean boarding time against ${copy.name.toLowerCase()} for ${model.rows.length} strategies, from ` +
      `${copy.format(model.xDomain[0])} to ${copy.format(model.xDomain[1])}. ` +
      `Where lines cross, the ranking flips at that ${copy.name.toLowerCase()}.`

  const table = model
    ? {
        caption: `Mean boarding time at each ${copy.name.toLowerCase()}.`,
        columns: [
          { key: 'label', label: 'Strategy' },
          ...model.values.map((v) => ({ key: `v${v}`, label: copy.format(v), align: 'right' })),
        ],
        rows: model.rows.map((r) => {
          const cells = { key: r.key, label: r.label }
          for (const p of r.points) cells[`v${p.v}`] = formatDuration(p.seconds)
          return cells
        }),
      }
    : null

  return (
    <ChartFrame
      title="Parameter sweep"
      subtitle={empty ? 'no sweep in this batch' : `${copy.name} · mean boarding time vs ${copy.blurb}`}
      ariaLabel={ariaLabel}
      height={height}
      // `left` clears both the m:ss tick labels (which end 8px off the plot
      // and run ~34px wide) and the rotated axis title outboard of them — the
      // same collision Convergence fixed at 64.
      margin={{ top: 12, right: 20, bottom: 46, left: 64 }}
      empty={empty}
      emptyTitle={blank.title}
      emptyHint={blank.hint}
      table={table}
      legend={model && <Legend items={legendItems(model.rows, 'line')} kind="line" label="Strategies" dense />}
      onPointerLeave={() => { hide(); setCrosshair(null) }}
      footnote={model ? copy.note : null}
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
              values={model.values}
              format={copy.format}
              label={copy.axis}
              anchorFirst
            />
            <text
              transform={`translate(${-(margin.left - 12)},${innerHeight / 2}) rotate(-90)`}
              textAnchor="middle"
              style={{ fill: 'var(--text-2)', fontSize: 11, fontWeight: 500 }}
            >
              Boarding time (m:ss)
            </text>

            {model.rows.map((r) => (
              <g key={r.key}>
                <path
                  d={linePath(r.points.map((p) => [x(p.v), y(p.seconds)]))}
                  fill="none"
                  stroke={r.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {r.points.map((p) => (
                  <path
                    key={p.v}
                    d={shapePath(r.shape, x(p.v), y(p.seconds), 4)}
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
              aria-label={`${copy.name} read-out`}
              onPointerMove={(e) => {
                const pt = localPoint(e)
                const at = x.invert(pt.x - margin.left)
                const snap = model.values.reduce(
                  (best, v) => (Math.abs(v - at) < Math.abs(best - at) ? v : best),
                  model.values[0],
                )
                setCrosshair(snap)
                show(x(snap) + margin.left, margin.top + 6, {
                  title: copy.point(snap),
                  rows: model.rows
                    .map((r) => ({ r, p: r.points.find((pp) => pp.v === snap) }))
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
                const snap = model.values[model.values.length - 1]
                setCrosshair(snap)
                show(x(snap) + margin.left, margin.top + 6, {
                  title: copy.point(snap),
                  rows: model.rows
                    .map((r) => ({ r, p: r.points.find((pp) => pp.v === snap) }))
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
