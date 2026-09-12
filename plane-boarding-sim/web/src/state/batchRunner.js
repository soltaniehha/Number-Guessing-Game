/**
 * Monte Carlo driver.
 *
 * Prefers the engine agent's Web Worker (`src/sim/batchWorker.js?worker`) and
 * falls back to a chunked main-thread loop so Analytics and Compare work even
 * before the worker exists. Both paths emit the same events.
 *
 * Worker protocol (per the agreed interface):
 *   post   {type:'start', config, strategies:[...], runs:N, sweep?}
 *   recv   {type:'progress', done, total, partial:BatchResult}
 *          {type:'done', result:BatchResult}
 *          {type:'error', message}
 *
 * The BatchResult it produces is assembled by `state/aggregate.js`, in the
 * shape `src/charts/ChartGrid.jsx` consumes.
 */
import { createBatchWorker } from '../lib/engineBridge.js'
import { aggregateBatch } from './aggregate.js'

/**
 * Start a batch. Returns a handle with `stop()`.
 *
 * @param {object} opts
 * @param {object} opts.engine   resolved engine module
 * @param {object} opts.config   SimConfig
 * @param {string[]} opts.strategies
 * @param {number} opts.runs     replications per strategy
 * @param {object} [opts.names]  STRATEGIES metadata, so series carry real names
 * @param {(e:{done:number,total:number,partial:object})=>void} opts.onProgress
 * @param {(result:object)=>void} opts.onDone
 * @param {(message:string)=>void} opts.onError
 */
export function startBatch({ engine, config, strategies, runs, names, onProgress, onDone, onError }) {
  const list = strategies && strategies.length ? strategies : [config.strategy]
  const total = list.length * runs

  const worker = createBatchWorker()
  if (worker) {
    let stopped = false
    worker.onmessage = (ev) => {
      if (stopped) return
      const msg = ev.data || {}
      if (msg.type === 'progress') onProgress?.({ done: msg.done, total: msg.total ?? total, partial: msg.partial })
      else if (msg.type === 'done') {
        onDone?.(msg.result)
        worker.terminate()
      } else if (msg.type === 'error') {
        onError?.(msg.message || 'Worker error')
        worker.terminate()
      }
    }
    worker.onerror = (err) => {
      if (!stopped) onError?.(err?.message || 'Worker failed to start')
    }
    worker.postMessage({ type: 'start', config, strategies: list, runs })
    return {
      stop() {
        stopped = true
        worker.terminate()
      },
      viaWorker: true,
    }
  }

  // ---- main-thread fallback: chunked so the UI keeps breathing -------------
  let cancelled = false
  const byStrategy = Object.fromEntries(list.map((k) => [k, []]))
  let done = 0
  let i = 0

  const schedule = (fn) => setTimeout(fn, 0)

  function chunk() {
    if (cancelled) return
    const started = Date.now()
    while (i < total && Date.now() - started < 24) {
      const strategyIndex = Math.floor(i / runs)
      const runIndex = i % runs
      const key = list[strategyIndex]
      try {
        byStrategy[key].push(engine.runSimulation({ ...config, strategy: key, seed: (config.seed | 0) + runIndex }))
      } catch (err) {
        onError?.(err?.message || String(err))
        return
      }
      i += 1
      done += 1
    }
    const partial = aggregateBatch({ byStrategy, names, config, done, total, complete: i >= total })
    if (i >= total) onDone?.(partial)
    else {
      onProgress?.({ done, total, partial })
      schedule(chunk)
    }
  }

  schedule(chunk)
  return {
    stop() {
      cancelled = true
    },
    viaWorker: false,
  }
}
