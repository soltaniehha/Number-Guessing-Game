import { useMemo } from 'react'
import { ChartFrame, emptyCopy } from './primitives/ChartFrame.jsx'
import { AxisBottom, BandAxisLeft, GridX } from './primitives/Axis.jsx'
import { ChartTooltip, useTooltip, localPoint } from './primitives/Tooltip.jsx'
import { Legend } from './primitives/Legend.jsx'
import { bandScale, cappedBand, bandInset, linearScale } from './primitives/scales.js'
import { roundedRightRect } from './primitives/shapes.js'
import { formatPercentValue, formatDurationLong, formatNumber } from './primitives/format.js'
import { ACTIVITY_SERIES } from './primitives/palette.js'
import { labelInkVar, resolveColor } from './primitives/ink.js'
import { useThemeVersion } from './primitives/useTheme.js'
import { useSeries, byMeanAsc, runsLabel, paxCount } from './selectors.js'

const BAR_CAP = 24
const SEGMENT_GAP = 2 // dataviz: surface does the separating, never a stroke

/**
 * Chart 5 — Time breakdown.
 *
 * Part-to-whole across categories, so: stacked horizontal bar, normalised to
 * % of passenger-seconds. Segments wear the cabin-view state tokens, so blue
 * still means walking and red still means blocked wherever you are in the app.
 */
export function TimeBreakdown({ batch, hidden, height = null }) {
  const { all, visible } = useSeries(batch, hidden)
  const { tip, show, hide } = useTooltip()
  const themeVersion = useThemeVersion()
  // All series hidden is a different problem from no data — say which.
  const blank = all.length > 0 && visible.length === 0 ? emptyCopy('noStrategies') : emptyCopy('noRuns')

  /**
   * Value labels sit on the segment fill, so the ink is picked from that
   * fill's measured luminance — per segment, not per theme. Resolved through
   * the computed style so a theme flip re-measures the real painted colour.
   */
  const segmentInk = useMemo(() => {
    void themeVersion
    const map = {}
    for (const activity of ACTIVITY_SERIES) {
      map[activity.key] = labelInkVar(resolveColor(activity.color))
    }
    return map
  }, [themeVersion])

  const rows = useMemo(() => {
    const withData = visible.filter((s) => s.entry?.meanBreakdown)
    return byMeanAsc(withData).map((s) => {
      const b = s.entry.meanBreakdown
      const total = ACTIVITY_SERIES.reduce((acc, a) => acc + (Number.isFinite(b[a.key]) ? b[a.key] : 0), 0)
      const pax = paxCount(batch, s.entry)
      let cursor = 0
      const segments = ACTIVITY_SERIES.map((a) => {
        const value = Number.isFinite(b[a.key]) ? b[a.key] : 0
        const pct = total > 0 ? (value / total) * 100 : 0
        const seg = { ...a, value, pct, start: cursor }
        cursor += pct
        return seg
      })
      return { ...s, total, segments, perPax: pax ? total / pax : null }
    })
  }, [visible, batch])

  const empty = rows.length === 0
  const plotHeight = height ?? Math.max(150, rows.length * 34 + 30)

  const worstBlocked = rows.reduce(
    (best, r) => {
      const blocked = r.segments.find((s) => s.key === 'blocked')?.pct ?? 0
      return best == null || blocked > best.pct ? { label: r.label, pct: blocked } : best
    },
    null,
  )

  const ariaLabel = empty
    ? 'Time breakdown — no replications yet.'
    : `Share of passenger-seconds spent walking, stowing, shuffling and blocked, for ${rows.length} strategies. ` +
      (worstBlocked ? `${worstBlocked.label} loses the most to blocking, at ${formatPercentValue(worstBlocked.pct)} of all passenger time.` : '')

  const table = {
    caption: 'Share of total passenger-seconds by activity.',
    columns: [
      { key: 'label', label: 'Strategy' },
      ...ACTIVITY_SERIES.map((a) => ({ key: a.key, label: a.label, align: 'right' })),
      { key: 'perPax', label: 'Per passenger', align: 'right' },
    ],
    rows: rows.map((r) => {
      const cells = { key: r.key, label: r.label }
      for (const seg of r.segments) cells[seg.key] = formatPercentValue(seg.pct, 1)
      cells.perPax = r.perPax ? formatDurationLong(r.perPax) : '—'
      return cells
    }),
  }

  return (
    <ChartFrame
      title="Where the time goes"
      subtitle={empty ? 'waiting for replications' : `% of passenger-seconds · mean of ${runsLabel(batch, rows)}`}
      ariaLabel={ariaLabel}
      height={plotHeight}
      margin={{ top: 6, right: 74, bottom: 40, left: 132 }}
      empty={empty}
      emptyTitle={blank.title}
      emptyHint={blank.hint}
      table={table}
      legend={
        <Legend
          items={ACTIVITY_SERIES.map((a) => ({ key: a.key, label: a.label, color: a.color }))}
          label="Activity"
          dense
        />
      }
      onPointerLeave={hide}
      footnote="Bars are normalised, so length carries nothing — the segments do. The number at the right is mean active time per passenger, which is what actually differs between strategies."
      tooltip={({ width, height: h }) => <ChartTooltip tip={tip} width={width} height={h} />}
    >
      {({ innerWidth, innerHeight, margin }) => {
        const y = bandScale({ domain: rows.map((r) => r.key), range: [0, innerHeight], padding: 0.34 })
        const x = linearScale({ domain: [0, 100], range: [0, innerWidth] })
        const ticks = [0, 25, 50, 75, 100]
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
              format={(v) => `${v}%`}
              label="Share of passenger-seconds"
            />

            {rows.map((r) => {
              const top = y(r.key) + inset
              const centre = top + barH / 2
              return (
                <g key={r.key}>
                  {r.segments.map((seg, i) => {
                    const x0 = x(seg.start)
                    const raw = x(seg.pct) - x(0)
                    const isLast = i === r.segments.length - 1
                    const w = Math.max(0, raw - (isLast ? 0 : SEGMENT_GAP))
                    if (w <= 0) return null
                    const labelText = `${Math.round(seg.pct)}%`
                    const fits = w > labelText.length * 7.4 + 12 && barH >= 16
                    return (
                      <g key={seg.key}>
                        {isLast ? (
                          <path className="ch-animate" d={roundedRightRect(x0, top, w, barH, 4)} fill={seg.color} />
                        ) : (
                          <rect className="ch-animate" x={x0} y={top} width={w} height={barH} fill={seg.color} />
                        )}
                        {fits && (
                          <text
                            x={x0 + w / 2}
                            y={centre + 4}
                            textAnchor="middle"
                            className="num ch-seg-label"
                            style={{ fill: segmentInk[seg.key] }}
                          >
                            {labelText}
                          </text>
                        )}
                      </g>
                    )
                  })}
                  {r.perPax != null && (
                    <text
                      x={innerWidth + 8}
                      y={centre + 4}
                      className="num"
                      style={{ fill: 'var(--text-2)', fontSize: 11 }}
                    >
                      {formatDurationLong(r.perPax)}
                    </text>
                  )}
                  <rect
                    className="ch-hit"
                    x={0}
                    y={y(r.key)}
                    width={innerWidth}
                    height={Math.max(24, y.bandwidth())}
                    tabIndex={0}
                    role="button"
                    aria-label={`${r.label}: ${r.segments.map((s) => `${s.label} ${Math.round(s.pct)}%`).join(', ')}`}
                    onPointerMove={(e) => {
                      const pt = localPoint(e, { x: margin.left + innerWidth / 2, y: centre + margin.top })
                      show(pt.x, centre + margin.top, {
                        title: r.label,
                        subtitle: `${formatNumber(Math.round(r.total))} passenger-seconds`,
                        rows: r.segments.map((seg) => ({
                          label: seg.label,
                          value: formatPercentValue(seg.pct, 1),
                          color: seg.color,
                          kind: 'rect',
                        })),
                        note: r.perPax ? `${formatDurationLong(r.perPax)} of active time per passenger` : null,
                      })
                    }}
                    onFocus={() =>
                      show(innerWidth / 2, centre + margin.top, {
                        title: r.label,
                        rows: r.segments.map((seg) => ({
                          label: seg.label,
                          value: formatPercentValue(seg.pct, 1),
                          color: seg.color,
                          kind: 'rect',
                        })),
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
