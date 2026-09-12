/**
 * Analytics mode: N replications of the selected strategy, streamed back from
 * the worker so the charts fill in while the run proceeds.
 */
import { Suspense } from 'react'
import { ChartGrid, hasChartGrid } from '../../lib/engineBridge.js'
import { useStore } from '../../state/StoreProvider.jsx'
import { EmptyState, ChartGlyph } from './EmptyState.jsx'
import { BatchToolbar } from './BatchToolbar.jsx'
import { ErrorBoundary } from '../ErrorBoundary.jsx'
import { SummaryCards } from './SummaryCards.jsx'
import { readSummaries } from '../../state/aggregate.js'

export function AnalyticsMode() {
  const { batch, config, strategies, run } = useStore()
  const summary = readSummaries(batch.result).find((s) => s.key === config.strategy)

  return (
    <div className="mode">
      <BatchToolbar
        title={strategies[config.strategy]?.name || config.strategy}
        subtitle={`${config.runs} replications`}
      />
      <div className="viewport viewport--scroll">
        {batch.error && <p className="alert alert--bad">{batch.error}</p>}
        {!batch.result && !batch.running && (
          <EmptyState
            icon={ChartGlyph}
            title="No replications yet"
            body="Analytics runs the same scenario many times with different seeds, so you can see the spread rather than one lucky flight."
            action={
              <button type="button" className="btn btn--run" onClick={run}>
                Run {config.runs} replications
              </button>
            }
          />
        )}
        {summary && <SummaryCards summary={summary} paxCount={batch.result?.meta?.paxCount} />}
        {batch.result && hasChartGrid && (
          <ErrorBoundary label="The chart grid">
            <Suspense fallback={<div className="viewport__loading">Loading charts…</div>}>
              <ChartGrid batch={batch.result} running={batch.running} />
            </Suspense>
          </ErrorBoundary>
        )}
        {batch.result && !hasChartGrid && (
          <p className="alert">The chart grid is not in this build yet. The aggregate figures above are live.</p>
        )}
      </div>
    </div>
  )
}

