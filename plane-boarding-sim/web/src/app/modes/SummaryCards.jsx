import { fmtClock, fmtInt, fmtNum } from '../../lib/format.js'

/**
 * "N of M replications hit the simulation cap."
 *
 * ENGINE_SPEC §7: a run that hits `MAX_SIM_SECONDS` comes back with
 * `completed: false`, and any consumer averaging `totalSeconds` has to check
 * it. Nothing outside `src/sim` did, so the shipped "nightmare" preset reported
 * a mean of 1:57:48 with median, p95 and max all exactly 2:00:00 — a
 * distribution piled on the cap, presented as boarding times.
 */
export function IncompleteNotice({ summary }) {
  if (!summary || !summary.incomplete) return null
  const { incomplete, n, allTruncated } = summary
  return (
    <p className={`alert ${allTruncated ? 'alert--bad' : 'alert--stale'}`} role="status">
      <b>
        {fmtInt(incomplete)} of {fmtInt(n)} replications did not finish boarding
      </b>{' '}
      — they were cut off at the two-hour simulation limit with passengers still standing.{' '}
      {allTruncated
        ? 'Every replication was cut off, so the times below are the limit itself, not boarding times. Ease the scenario — fewer bags, bigger bins, more doors — to get a real answer.'
        : 'Their length is the limit, not a boarding time, so they are excluded from the figures below. The real distribution is worse than what is shown.'}
    </p>
  )
}

/** Aggregate read-out for one strategy's replications. */
export function SummaryCards({ summary, paxCount }) {
  // `gateChecks` counts BAGS, not passengers, and a cabin where most people
  // carry two of them routinely gate-checks more bags than there are bodies —
  // the old "163.7% of the cabin" caption was measuring one thing and naming
  // another. Per passenger is the ratio that is actually true.
  const perPax = paxCount ? `${fmtNum(summary.gateChecks / paxCount, 2)} bags per passenger` : 'bags per flight'
  const cards = [
    { label: 'Mean boarding time', value: fmtClock(summary.mean), note: `±${fmtNum(summary.ci95, 1)}s at 95%` },
    { label: 'Median', value: fmtClock(summary.p50), note: `p05 ${fmtClock(summary.p05)} · p95 ${fmtClock(summary.p95)}` },
    { label: 'Spread', value: `${fmtNum(summary.sd, 1)}s`, note: `${fmtNum((summary.sd / (summary.mean || 1)) * 100, 1)}% of the mean` },
    {
      label: 'Best / worst',
      value: `${fmtClock(summary.min)} / ${fmtClock(summary.max)}`,
      note: summary.incomplete
        ? `${summary.timedRuns} of ${summary.n} runs finished`
        : `${summary.n} runs`,
    },
    { label: 'Gate-checked bags', value: fmtNum(summary.gateChecks, 1), note: perPax },
  ]
  return (
    <>
      <IncompleteNotice summary={summary} />
      <div className="cards cards--summary">
        {cards.map((c) => (
          <div className="summary" key={c.label}>
            <span className="summary__label">{c.label}</span>
            <span className="summary__value num">{c.value}</span>
            <span className="summary__note num">{c.note}</span>
          </div>
        ))}
      </div>
    </>
  )
}
