/**
 * Head-to-head ranking (UI_SPEC section 1.3). Not a chart — a table — so it
 * lives with the shell rather than in src/charts. Confidence intervals are
 * shown because a ranking without them is a lie.
 *
 * ## Ties, and why the ranks come from the paired test
 *
 * Every strategy in a comparison is run over the same seed sequence, so
 * replication `i` of each faces an identical passenger manifest. The
 * per-replication difference cancels that manifest out, which makes the paired
 * interval both the correct test (the samples are correlated, so overlapping
 * marginal bars prove nothing either way) and usually the tighter one. Two
 * strategies share a rank — shown `=3` — when the interval on their paired
 * difference contains zero.
 *
 * The table used to number rows `1, 2, 3, …` unconditionally, which crowned a
 * winner out of a statistical dead heat: two byte-identical rows were ranked 3
 * and 4, and on the default set Steffen-modified was highlighted as best over
 * WilMA on a gap of "+0.0m". Nothing in a tied set is highlighted as best now.
 *
 * The wording matches `python/plane_boarding/cli.py`, which reports the same
 * comparison at the command line.
 */
import { fmtClock, fmtNum } from '../../lib/format.js'
import { readSummaries } from '../../state/aggregate.js'
import { pairedDifference, rankRows } from '../../state/paired.js'

/** "-1:07" / "+0:12" — a signed difference in minutes and seconds. */
function fmtDelta(seconds) {
  if (!Number.isFinite(seconds)) return '—'
  const sign = seconds < 0 ? '-' : '+'
  const whole = Math.round(Math.abs(seconds))
  return `${sign}${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export function RankingTable({ batch, strategies }) {
  const rows = readSummaries(batch).sort((a, b) => a.mean - b.mean)
  if (rows.length === 0) return null

  const { ranks, tied, paired } = rankRows(rows)
  const best = rows[0]
  const worst = rows[rows.length - 1]
  const span = Math.max(1, worst.mean + worst.ci95)
  // The baseline for the paired column is free-for-all boarding where it is in
  // the comparison — "is this ordering worth the trouble" is the question it
  // answers — and the fastest strategy otherwise.
  const baseline = rows.find((r) => r.key === 'random') || best
  const jointBest = rows.filter((_, i) => ranks[i] === ranks[0])
  const anyIncomplete = rows.some((r) => r.incomplete > 0)

  return (
    <div className="tablewrap" tabIndex={0} role="region" aria-label="Strategy ranking, scrollable">
      <table className="rank">
        <caption className="rank__caption">
          Mean boarding time over {best.timedRuns} replications per strategy, with 95% confidence intervals.
          {paired ? ' Ranked by the paired comparison on matched seeds.' : ' Ranked by overlapping intervals.'}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="rank__num">#</th>
            <th scope="col">Strategy</th>
            <th scope="col" className="rank__num">Mean</th>
            <th scope="col" className="rank__num">95% CI</th>
            <th scope="col" className="rank__num">SD</th>
            <th scope="col" className="rank__num">p05 – p95</th>
            <th scope="col" className="rank__num">vs best</th>
            <th scope="col" className="rank__num">
              Paired vs {baseline.key === 'random' ? 'free-for-all' : baseline.name || baseline.key} (95% CI)
            </th>
            <th scope="col" className="rank__bar">Distribution</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const meta = strategies?.[row.key]
            const rank = ranks[i]
            const isTied = tied.has(rank)
            const isBest = rank === ranks[0]
            const tiedWithBest = isBest && jointBest.length > 1
            const delta = row.mean - best.mean
            const pd = row.key === baseline.key ? null : pairedDifference(row.values, baseline.values)
            return (
              <tr key={row.key} className={isBest ? 'is-best' : undefined}>
                <td className="rank__num num">
                  {isTied ? (
                    <>
                      <abbr title="Shared rank: the paired test cannot separate these strategies.">=</abbr>
                      {rank}
                    </>
                  ) : (
                    rank
                  )}
                </td>
                <th scope="row" className="rank__name">
                  {meta?.name || row.name || row.key}
                  {row.incomplete > 0 && (
                    <span className="rank__flag" title={`${row.incomplete} of ${row.n} replications hit the simulation cap and are excluded from these figures.`}>
                      {' '}
                      ⚠ {row.incomplete} cut off
                    </span>
                  )}
                </th>
                <td className="rank__num num">{fmtClock(row.mean)}</td>
                <td className="rank__num num">±{fmtNum(row.ci95, 1)}s</td>
                <td className="rank__num num">{fmtNum(row.sd, 1)}s</td>
                <td className="rank__num num">
                  {fmtClock(row.p05)} – {fmtClock(row.p95)}
                </td>
                <td className="rank__num num">
                  {i === 0 ? '—' : tiedWithBest ? 'tie' : `+${fmtNum(delta / 60, 1)}m`}
                </td>
                <td className="rank__num num">
                  {pd ? (
                    <>
                      {fmtDelta(pd.mean)} [{fmtDelta(pd.lo)}, {fmtDelta(pd.hi)}]
                      {!pd.significant && <span className="rank__ns" title="The interval contains zero: not a real difference."> ns</span>}
                    </>
                  ) : (
                    <span className="rank__ns">{row.key === baseline.key ? '(baseline)' : '—'}</span>
                  )}
                </td>
                <td className="rank__bar">
                  <span className="rankbar" aria-hidden="true">
                    <span
                      className="rankbar__range"
                      style={{ left: `${(row.p05 / span) * 100}%`, width: `${((row.p95 - row.p05) / span) * 100}%` }}
                    />
                    <span className="rankbar__mean" style={{ left: `${(row.mean / span) * 100}%` }} />
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="rank__legend">
        <p>
          <b>Mean ±95%</b> is the marginal interval: how long this strategy takes on its own.{' '}
          <b>Paired</b> is the per-replication difference on matched seeds — every strategy sees the identical
          passenger manifest, so the difference cancels it out. That makes it the correct test and usually the
          tighter one; <b>ns</b> means the interval contains zero. The ranks use it.
        </p>
        {tied.size > 0 && (
          <p>
            <b>=</b> marks a shared rank: the paired test cannot separate those strategies at this many
            replications. Treat them as equal, not as ordered.
            {jointBest.length > 1 &&
              ` ${jointBest.length} strategies tie for first (${jointBest.map((r) => strategies?.[r.key]?.name || r.key).join(', ')}).`}
          </p>
        )}
        {anyIncomplete && (
          <p>
            <b>⚠</b> Replications that hit the simulation cap are excluded from the times above: their length is the
            cap, not a boarding time.
          </p>
        )}
      </div>
    </div>
  )
}
