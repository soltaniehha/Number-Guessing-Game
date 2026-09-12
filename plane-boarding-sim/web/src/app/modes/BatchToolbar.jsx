import { useStore } from '../../state/StoreProvider.jsx'
import { fmtInt } from '../../lib/format.js'

/** Run / stop and progress for the two headless modes. */
export function BatchToolbar({ title, subtitle }) {
  const { batch, run, stopBatch } = useStore()
  const total = batch.total || 0
  const pct = total > 0 ? Math.round((batch.done / total) * 100) : 0

  return (
    <div className="toolbar">
      <div className="toolbar__titles">
        <h2 className="toolbar__title">{title}</h2>
        <p className="toolbar__subtitle num">{subtitle}</p>
      </div>
      <div className="toolbar__progress">
        {batch.running && (
          <>
            <span className="num toolbar__count">
              {fmtInt(batch.done)}/{fmtInt(total)} · {pct}%
            </span>
            <div
              className="progress progress--slim"
              role="progressbar"
              aria-label="Replication progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <span className="progress__fill" style={{ width: `${pct}%` }} />
            </div>
          </>
        )}
      </div>
      {batch.running ? (
        <button type="button" className="btn" onClick={stopBatch}>
          Stop
        </button>
      ) : (
        <button type="button" className="btn btn--run" onClick={run}>
          Run
        </button>
      )}
    </div>
  )
}
