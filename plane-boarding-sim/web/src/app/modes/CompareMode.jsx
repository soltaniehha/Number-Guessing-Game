/**
 * Compare mode: every enabled strategy, N replications each, ranked with
 * confidence intervals so the answer is honest.
 */
import { Suspense } from 'react'
import { ChartGrid, hasChartGrid } from '../../lib/engineBridge.js'
import { useStore } from '../../state/StoreProvider.jsx'
import { EmptyState, ChartGlyph } from './EmptyState.jsx'
import { BatchToolbar } from './BatchToolbar.jsx'
import { ErrorBoundary } from '../ErrorBoundary.jsx'
import { RankingTable } from './RankingTable.jsx'

export function CompareMode() {
  const { batch, config, strategies, setField, run } = useStore()
  const selected = config.compareStrategies || []

  const toggle = (key) => {
    const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]
    if (next.length === 0) return
    setField('compareStrategies', next)
  }

  return (
    <div className="mode">
      <BatchToolbar
        title="Head to head"
        subtitle={`${selected.length} strategies × ${config.runs} replications`}
      />
      <div className="viewport viewport--scroll">
        <fieldset className="chips">
          <legend className="chips__legend">Strategies in the comparison</legend>
          {Object.values(strategies).map((s) => {
            const on = selected.includes(s.key)
            const isLast = on && selected.length === 1
            return (
              <label key={s.key} className={`chip${on ? ' is-on' : ''}`} title={s.description}>
                <input type="checkbox" checked={on} disabled={isLast} onChange={() => toggle(s.key)} />
                <span>{s.name}</span>
              </label>
            )
          })}
        </fieldset>

        {batch.error && <p className="alert alert--bad">{batch.error}</p>}

        {!batch.result && !batch.running && (
          <EmptyState
            icon={ChartGlyph}
            title="Nothing compared yet"
            body="Every selected strategy is run the same number of times against the same aircraft and passenger mix. Only the boarding order changes."
            action={
              <button type="button" className="btn btn--run" onClick={run}>
                Compare {selected.length} strategies
              </button>
            }
          />
        )}

        {batch.result && <RankingTable batch={batch.result} strategies={strategies} />}

        {batch.result && hasChartGrid && (
          <ErrorBoundary label="The comparison charts">
            <Suspense fallback={<div className="viewport__loading">Loading charts…</div>}>
              <ChartGrid batch={batch.result} running={batch.running} />
            </Suspense>
          </ErrorBoundary>
        )}
        {batch.result && !hasChartGrid && (
          <p className="alert">The comparison charts are not in this build yet. The ranking above is live.</p>
        )}
      </div>
    </div>
  )
}
