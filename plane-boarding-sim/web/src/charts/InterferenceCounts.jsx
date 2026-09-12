import { useMemo } from 'react'
import { ChartFrame, emptyCopy } from './primitives/ChartFrame.jsx'
import { AxisBottom, BandAxisLeft, GridX } from './primitives/Axis.jsx'
import { ChartTooltip, useTooltip, localPoint } from './primitives/Tooltip.jsx'
import { Legend } from './primitives/Legend.jsx'
import { bandScale, linearScale } from './primitives/scales.js'
import { roundedRightRect } from './primitives/shapes.js'
import { formatNumber, formatPercentValue } from './primitives/format.js'
import { INTERFERENCE_SERIES } from './primitives/palette.js'
import { useSeries, byMeanAsc, runsLabel, paxCount } from './selectors.js'

const SUB_CAP = 11

/**
 * Chart 6 — Seat interference counts.
 *
 * The four classes are ORDERED by how much they cost (none → same party →
 * one blocker → two blockers), so the colour job is ORDINAL, not categorical:
 * one hue, four monotone lightness steps of `--series-1`. Validated with
 * `--ordinal` in both themes (monotone L, ΔL ≥ 0.06, light end 2.14:1 / 2.69:1).
 */
export function InterferenceCounts({ batch, hidden, height = null }) {
  const { all, visible } = useSeries(batch, hidden)
  const { tip, show, hide } = useTooltip()
  // All series hidden is a different problem from no data — say which.
  const blank = all.length > 0 && visible.length === 0 ? emptyCopy('noStrategies') : emptyCopy('noRuns')

  const rows = useMemo(() => {
    const withData = visible.filter((s) => s.entry?.meanInterference)
    return byMeanAsc(withData).map((s) => {
      const src = s.entry.meanInterference
      const pax = paxCount(batch, s.entry)
      const groups = INTERFERENCE_SERIES.map((g) => ({
        ...g,
        value: Number.isFinite(src[g.key]) ? src[g.key] : 0,
      }))
      const total = groups.reduce((acc, g) => acc + g.value, 0) || pax || 0
      return { ...s, groups: groups.map((g) => ({ ...g, share: total ? (g.value / total) * 100 : 0 })), total }
    })
  }, [visible, batch])

  const empty = rows.length === 0
  const maxValue = rows.reduce((m, r) => Math.max(m, ...r.groups.map((g) => g.value)), 0)
  const plotHeight = height ?? Math.max(190, rows.length * (SUB_CAP * 4 + 16) + 34)

  const cleanest = rows.reduce((best, r) => {
    const shuffles = r.groups.filter((g) => g.key !== 'none').reduce((a, g) => a + g.value, 0)
    return best == null || shuffles < best.shuffles ? { label: r.label, shuffles } : best
  }, null)

  const ariaLabel = empty
    ? 'Seat interference counts — no replications yet.'
    : `Passengers by how many seated neighbours they had to disturb, for ${rows.length} strategies. ` +
      (cleanest ? `${cleanest.label} causes the fewest shuffles, about ${formatNumber(Math.round(cleanest.shuffles))} per flight.` : '')

  const table = {
    caption: 'Mean passengers per flight by interference class.',
    columns: [
      { key: 'label', label: 'Strategy' },
      ...INTERFERENCE_SERIES.map((g) => ({ key: g.key, label: g.label, align: 'right' })),
      { key: 'shuffles', label: 'Any shuffle', align: 'right' },
    ],
    rows: rows.map((r) => {
      const cells = { key: r.key, label: r.label }
      for (const g of r.groups) cells[g.key] = formatNumber(Math.round(g.value))
      cells.shuffles = formatNumber(Math.round(r.groups.filter((g) => g.key !== 'none').reduce((a, g) => a + g.value, 0)))
      return cells
    }),
  }

  return (
    <ChartFrame
      title="Seat interference"
      subtitle={empty ? 'waiting for replications' : `passengers per flight · mean of ${runsLabel(batch, rows)}`}
      ariaLabel={ariaLabel}
      height={plotHeight}
      margin={{ top: 8, right: 50, bottom: 40, left: 132 }}
      empty={empty}
      emptyTitle={blank.title}
      emptyHint={blank.hint}
      table={table}
      legend={
        <Legend
          items={INTERFERENCE_SERIES.map((g) => ({
            key: g.key,
            label: g.label,
            color: 'var(--series-1)',
            opacity: g.opacity,
          }))}
          label="Blockers disturbed"
          dense
        />
      }
      onPointerLeave={hide}
      footnote="Darker means more people disturbed. Outside-in schemes should show almost nothing but the lightest bar — that is the whole point of boarding windows first."
      tooltip={({ width, height: h }) => <ChartTooltip tip={tip} width={width} height={h} />}
    >
      {({ innerWidth, innerHeight, margin }) => {
        const y = bandScale({ domain: rows.map((r) => r.key), range: [0, innerHeight], padding: 0.26 })
        const x = linearScale({ domain: [0, maxValue || 1], range: [0, innerWidth], nice: true })
        const ticks = x.ticks(innerWidth < 340 ? 3 : 5)
        const sub = bandScale({
          domain: INTERFERENCE_SERIES.map((g) => g.key),
          range: [0, y.bandwidth()],
          padding: 0.18,
        })
        const subH = Math.min(SUB_CAP, sub.bandwidth())

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
              format={(v) => formatNumber(v)}
              label="Passengers per flight"
            />

            {rows.map((r) => (
              <g key={r.key}>
                {r.groups.map((g) => {
                  const top = y(r.key) + sub(g.key) + (sub.bandwidth() - subH) / 2
                  const w = Math.max(0, x(g.value))
                  const isWorst = g.key === 'two'
                  return (
                    <g key={g.key}>
                      <path
                        className="ch-animate"
                        d={roundedRightRect(0, top, w, subH, 3)}
                        fill="var(--series-1)"
                        fillOpacity={g.opacity}
                      />
                      {isWorst && (
                        <text
                          x={w + 6}
                          y={top + subH / 2 + 3.5}
                          className="num"
                          style={{ fill: 'var(--text-2)', fontSize: 10.5 }}
                        >
                          {formatNumber(Math.round(g.value))}
                        </text>
                      )}
                      <rect
                        className="ch-hit"
                        x={0}
                        y={top - 2}
                        width={innerWidth}
                        height={Math.max(12, subH + 4)}
                        tabIndex={-1}
                        onPointerMove={(e) => {
                          const pt = localPoint(e, { x: margin.left + w, y: top + margin.top })
                          show(pt.x, top + margin.top, {
                            title: r.label,
                            subtitle: g.label,
                            rows: [
                              {
                                label: 'passengers',
                                value: formatNumber(Math.round(g.value)),
                                color: 'var(--series-1)',
                                opacity: g.opacity,
                                kind: 'rect',
                                strong: true,
                              },
                              { label: 'share of cabin', value: formatPercentValue(g.share, 1) },
                            ],
                          })
                        }}
                      />
                    </g>
                  )
                })}
                <rect
                  className="ch-hit"
                  x={-margin.left}
                  y={y(r.key)}
                  width={margin.left}
                  height={y.bandwidth()}
                  tabIndex={0}
                  role="button"
                  aria-label={`${r.label}: ${r.groups.map((g) => `${g.label} ${Math.round(g.value)}`).join(', ')}`}
                  onFocus={() =>
                    show(innerWidth / 2, y.center(r.key) + margin.top, {
                      title: r.label,
                      rows: r.groups.map((g) => ({
                        label: g.label,
                        value: formatNumber(Math.round(g.value)),
                        color: 'var(--series-1)',
                        opacity: g.opacity,
                        kind: 'rect',
                      })),
                    })
                  }
                  onBlur={hide}
                />
              </g>
            ))}
          </>
        )
      }}
    </ChartFrame>
  )
}
