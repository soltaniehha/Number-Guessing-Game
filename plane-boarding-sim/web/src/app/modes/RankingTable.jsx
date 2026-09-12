/**
 * Head-to-head ranking (UI_SPEC section 1.3). Not a chart — a table — so it
 * lives with the shell rather than in src/charts. Confidence intervals are
 * shown because a ranking without them is a lie.
 */
import { fmtClock, fmtNum } from '../../lib/format.js'
import { readSummaries } from '../../state/aggregate.js'

export function RankingTable({ batch, strategies }) {
  const rows = readSummaries(batch).sort((a, b) => a.mean - b.mean)
  if (rows.length === 0) return null

  const best = rows[0]
  const worst = rows[rows.length - 1]
  const span = Math.max(1, worst.mean + worst.ci95)

  return (
    <div className="tablewrap">
      <table className="rank">
        <caption className="rank__caption">
          Mean boarding time over {best.n} replications per strategy, with 95% confidence intervals.
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
            <th scope="col" className="rank__bar">Distribution</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const meta = strategies?.[row.key]
            const delta = row.mean - best.mean
            return (
              <tr key={row.key} className={i === 0 ? 'is-best' : undefined}>
                <td className="rank__num num">{i + 1}</td>
                <th scope="row" className="rank__name">
                  {meta?.name || row.name || row.key}
                </th>
                <td className="rank__num num">{fmtClock(row.mean)}</td>
                <td className="rank__num num">±{fmtNum(row.ci95, 1)}s</td>
                <td className="rank__num num">{fmtNum(row.sd, 1)}s</td>
                <td className="rank__num num">
                  {fmtClock(row.p05)} – {fmtClock(row.p95)}
                </td>
                <td className="rank__num num">{i === 0 ? '—' : `+${fmtNum(delta / 60, 1)}m`}</td>
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
    </div>
  )
}
