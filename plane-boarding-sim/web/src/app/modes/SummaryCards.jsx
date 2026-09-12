import { fmtClock, fmtNum } from '../../lib/format.js'

/** Aggregate read-out for one strategy's replications. */
export function SummaryCards({ summary }) {
  const cards = [
    { label: 'Mean boarding time', value: fmtClock(summary.mean), note: `±${fmtNum(summary.ci95, 1)}s at 95%` },
    { label: 'Median', value: fmtClock(summary.p50), note: `p05 ${fmtClock(summary.p05)} · p95 ${fmtClock(summary.p95)}` },
    { label: 'Spread', value: `${fmtNum(summary.sd, 1)}s`, note: `${fmtNum((summary.sd / (summary.mean || 1)) * 100, 1)}% of the mean` },
    { label: 'Best / worst', value: `${fmtClock(summary.min)} / ${fmtClock(summary.max)}`, note: `${summary.n} runs` },
  ]
  return (
    <div className="cards cards--summary">
      {cards.map((c) => (
        <div className="summary" key={c.label}>
          <span className="summary__label">{c.label}</span>
          <span className="summary__value num">{c.value}</span>
          <span className="summary__note num">{c.note}</span>
        </div>
      ))}
    </div>
  )
}
