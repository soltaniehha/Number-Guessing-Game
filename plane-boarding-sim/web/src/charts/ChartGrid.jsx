import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './charts.css'

import { BoardingTimeByStrategy } from './BoardingTimeByStrategy.jsx'
import { TimeDistribution } from './TimeDistribution.jsx'
import { SeatedCurve } from './SeatedCurve.jsx'
import { CongestionHeatmap } from './CongestionHeatmap.jsx'
import { TimeBreakdown } from './TimeBreakdown.jsx'
import { InterferenceCounts } from './InterferenceCounts.jsx'
import { LoadFactorSweep } from './LoadFactorSweep.jsx'
import { WaitTimeBoxes } from './WaitTimeBoxes.jsx'
import { SeatPositionHeatmap } from './SeatPositionHeatmap.jsx'
import { Convergence } from './Convergence.jsx'
import { RiskReward } from './RiskReward.jsx'
import { AisleThroughput } from './AisleThroughput.jsx'

import { Legend } from './primitives/Legend.jsx'
import { MAX_SERIES } from './primitives/palette.js'
import { formatNumber } from './primitives/format.js'
import { useSeries, legendItems, totalRuns } from './selectors.js'

/**
 * The twelve charts of UI_SPEC §2, in reading order: the answer first, then
 * why, then whether to believe it.
 *
 * `note` is the plain-English "what this tells you" line printed on the card;
 * `hint` is the longer version behind the card's own hover title.
 */
const CHART_DEFS = [
  {
    id: 'boarding-time',
    Component: BoardingTimeByStrategy,
    note: 'Which strategy actually finishes first — and whether the gap is bigger than the noise.',
    hint: 'Bars are the mean over completed replications; whiskers are the 95% confidence interval of that mean. Overlapping whiskers mean the two strategies are not yet distinguishable.',
    legendKind: 'rect',
  },
  {
    id: 'risk-reward',
    Component: RiskReward,
    note: 'Fast on average is not the same as reliable — this splits the two.',
    hint: 'Each point is one strategy: mean boarding time across, run-to-run standard deviation up. Bottom-left is a strategy you can build a schedule around.',
    legendKind: 'shape',
  },
  {
    id: 'time-distribution',
    Component: TimeDistribution,
    note: 'How much a single flight can differ from the average.',
    hint: 'One ridge per strategy over shared bins. Tall and narrow is consistent; low and wide means the same strategy can hand you a very bad day.',
    legendKind: 'rect',
  },
  {
    id: 'wait-time',
    Component: WaitTimeBoxes,
    note: 'What boarding feels like for a passenger, not for the airline.',
    hint: 'Box plots of individual time-to-seat pooled across replications. A fast average can still leave one passenger in ten standing far longer than the rest.',
    legendKind: 'rect',
  },
  {
    id: 'seated-curve',
    Component: SeatedCurve,
    note: 'Where in the process each strategy loses its time.',
    hint: 'Percentage seated against the clock. A shallow start is a slow jet-bridge; a long flat shoulder at the end is the last passengers hunting for bin space.',
    legendKind: 'line',
  },
  {
    id: 'time-breakdown',
    Component: TimeBreakdown,
    note: 'Why a strategy is slow: walking, stowing, shuffling, or standing blocked.',
    hint: 'Share of total passenger-seconds by activity. Blocked time is pure waste; stow time is physics you can only reduce with smaller bags or bigger bins.',
    legendKind: 'rect',
  },
  {
    id: 'interference',
    Component: InterferenceCounts,
    note: 'How many people have to stand up so someone else can sit down.',
    hint: 'Passengers grouped by how many seated neighbours they disturbed. Outside-in schemes should show almost nothing but the "no blocker" bar.',
    legendKind: 'rect',
  },
  {
    id: 'congestion',
    Component: CongestionHeatmap,
    note: 'Where jams form in the cabin, and when.',
    hint: 'Mean bodies in the aisle by row and time for the first selected strategy. A bright horizontal streak is a queue parked at one row.',
    legendKind: 'rect',
  },
  {
    id: 'aisle-throughput',
    Component: AisleThroughput,
    note: 'Whether the aisle is saturated or starved.',
    hint: 'Total bodies in the aisle over time, split by cabin third. A flat plateau means the aisle is full and the door no longer matters.',
    legendKind: 'rect',
  },
  {
    id: 'seat-position',
    Component: SeatPositionHeatmap,
    note: 'Who pays for the strategy — window seats, the rear, or nobody in particular.',
    hint: 'Mean seconds to seat by seat, laid out like the cabin. Rows run nose to tail, the gap is the aisle.',
    legendKind: 'rect',
  },
  {
    id: 'load-sweep',
    Component: LoadFactorSweep,
    note: 'Whether the ranking survives a half-empty flight.',
    hint: 'Boarding time against load factor. Crossing lines mean the best strategy depends on how full the aircraft is.',
    legendKind: 'line',
  },
  {
    id: 'convergence',
    Component: Convergence,
    note: 'Whether you have run enough replications to believe any of the above.',
    hint: 'Running mean with a shrinking 95% interval. When the band stops moving, more replications will not change the answer.',
    legendKind: 'line',
  },
]

/**
 * The analytics grid.
 *
 * The strategy filter sits in ONE row above every chart and scopes all of
 * them at once — no per-chart filters. Colour is assigned per strategy, not
 * per row of the current selection, so hiding a strategy never repaints the
 * survivors.
 */
export function ChartGrid({ batch, running = false, className = '' }) {
  const [hidden, setHidden] = useState(() => new Set())
  const [maximised, setMaximised] = useState(null)

  const { all, overflowCount } = useSeries(batch, hidden)

  const toggle = useCallback((key) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const showAll = useCallback(() => setHidden(new Set()), [])
  const showOnlyFastest = useCallback(() => {
    const ranked = [...all].sort(
      (a, b) => (a.entry?.totalSeconds?.mean ?? Infinity) - (b.entry?.totalSeconds?.mean ?? Infinity),
    )
    setHidden(new Set(ranked.slice(3).map((s) => s.key)))
  }, [all])

  const runs = totalRuns(batch)
  const requested = batch?.meta?.runsRequested
  const complete = batch?.meta?.complete

  /**
   * The precise, continuously-updating figure. It is ordinary on-screen text,
   * NOT a live region: during a batch it changes several times a second, and
   * a polite queue fed at that rate never drains. Anyone can read it on
   * demand; the milestones below are what gets announced.
   */
  const status = useMemo(() => {
    if (all.length === 0) return 'No batch loaded yet.'
    const perStrategy = requested ? ` of ${formatNumber(requested)} each` : ''
    if (running) return `Streaming — ${formatNumber(runs)} replications${perStrategy}.`
    if (complete) return `Complete — ${formatNumber(runs)} replications across ${all.length} strategies.`
    return `Paused — ${formatNumber(runs)} replications so far${perStrategy}.`
  }, [all.length, complete, requested, running, runs])

  const visibleCount = all.length - hidden.size

  const notices = useMemo(() => {
    const out = []
    if (visibleCount === 0 && all.length > 0) out.push('Every strategy is hidden.')
    if (overflowCount > 0) {
      out.push(
        `${formatNumber(overflowCount)} strategies past the ${MAX_SERIES}-colour limit share a muted key — hide ` +
          'some to give them their own colour.',
      )
    }
    return out
  }, [all.length, overflowCount, visibleCount])

  const announcement = useMilestoneStatus({
    strategies: all.length,
    runs,
    requested,
    running,
    complete,
    notices,
  })

  return (
    <div className={`cg-root ${className}`.trim()}>
      <div className="cg-filterbar">
        <span className="cg-filterbar-label" id="cg-filter-label">
          Strategies
        </span>
        {all.length >= 2 ? (
          <Legend
            items={legendItems(all, 'shape')}
            hidden={hidden}
            onToggle={toggle}
            label="Toggle strategies across every chart"
          />
        ) : (
          <span className="cg-status">{all.length === 1 ? all[0].label : '—'}</span>
        )}
        <div className="cg-filterbar-actions">
          <button type="button" className="cg-btn" onClick={showAll} disabled={hidden.size === 0}>
            Show all
          </button>
          <button type="button" className="cg-btn" onClick={showOnlyFastest} disabled={all.length < 4}>
            Top 3 only
          </button>
        </div>
        <p className="cg-status" style={{ flexBasis: '100%', margin: 0 }}>
          {status}
          {notices.map((notice) => (
            <strong key={notice}> {notice}</strong>
          ))}
        </p>
        <p className="cg-sr" role="status" aria-live="polite">
          {announcement}
        </p>
      </div>

      <div className="cg-grid">
        {CHART_DEFS.map((def) => {
          const isMax = maximised === def.id
          const Chart = def.Component
          return (
            <section key={def.id} className={`cg-card${isMax ? ' is-wide' : ''}`} aria-label={def.note}>
              <Chart batch={batch} hidden={hidden} height={isMax ? 440 : undefined} />
              <p className="cg-card-note" title={def.hint}>
                {def.note}
              </p>
              <div className="cg-card-tools">
                <button
                  type="button"
                  className="cg-btn"
                  aria-pressed={isMax}
                  onClick={() => setMaximised((current) => (current === def.id ? null : def.id))}
                >
                  {isMax ? 'Restore' : 'Maximise'}
                </button>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Batch progress as MILESTONES, not as a running total.
 *
 * A streaming batch updates the run counter several times a second. Pushed
 * into a polite live region that is roughly four announcements a second — the
 * queue never drains and the screen-reader user hears nothing else for the
 * rest of the session (measured: 39 mutations in 10.5 s). So the live region
 * only ever carries: the start, each quarter of the way through, the finish,
 * a stop — and the filter notices, which only change on a click.
 *
 * Returns the text to put in the live region, '' before anything has happened.
 */
function useMilestoneStatus({ strategies, runs, requested, running, complete, notices }) {
  const [announcement, setAnnouncement] = useState('')
  const lastKey = useRef(null)

  const expected = requested && strategies ? requested * strategies : 0
  const quarter = expected > 0 ? Math.min(3, Math.max(0, Math.floor((runs / expected) * 4))) : 0
  const noticeText = notices.join(' ')

  const phase = complete ? 'complete' : running ? 'running' : strategies > 0 ? 'paused' : 'idle'
  const key = `${phase}:${phase === 'running' ? quarter : ''}:${noticeText}`

  useEffect(() => {
    if (lastKey.current === key) return
    lastKey.current = key
    const total = expected ? ` of ${formatNumber(expected)}` : ''
    let line = ''
    if (phase === 'running' && quarter === 0) {
      line = expected
        ? `Run started — streaming ${formatNumber(expected)} replications across ${formatNumber(strategies)} ` +
          `${strategies === 1 ? 'strategy' : 'strategies'}.`
        : `Run started — streaming replications across ${formatNumber(strategies)} strategies.`
    } else if (phase === 'running') {
      const words = ['', 'A quarter of the way', 'Halfway', 'Three quarters of the way']
      line = `${words[quarter]} — ${formatNumber(runs)}${total} replications.`
    } else if (phase === 'complete') {
      line =
        `Run complete — ${formatNumber(runs)} replications across ${formatNumber(strategies)} ` +
        `${strategies === 1 ? 'strategy' : 'strategies'}.`
    } else if (phase === 'paused') {
      line = `Run stopped — ${formatNumber(runs)}${total} replications completed.`
    }
    setAnnouncement([line, noticeText].filter(Boolean).join(' '))
  }, [expected, key, noticeText, phase, quarter, runs, strategies])

  return announcement
}

export default ChartGrid
