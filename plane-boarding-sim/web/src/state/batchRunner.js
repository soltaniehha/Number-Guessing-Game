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
 * ASSUMED BatchResult shape (ENGINE_SPEC section 7 describes the aggregation
 * but not the object): `{ runs, total, done, strategies: { [key]: Summary } }`
 * with Summary = { key, n, values:number[], mean, sd, min, max, p05, p50, p95,
 * sample: RunResult[] }. The fallback aggregator below produces exactly that;
 * if the real worker differs the charts consume whatever it sends and only
 * this file's fallback needs updating.
 */
import { createBatchWorker } from '../lib/engineBridge.js'

const quantile = (sorted, q) => {
  if (!sorted.length) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function summarise(key, results) {
  const values = results.map((r) => r.totalSeconds)
  const sorted = [...values].sort((a, b) => a - b)
  const n = values.length
  const mean = n ? values.reduce((s, v) => s + v, 0) / n : 0
  const variance = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0
  const sd = Math.sqrt(variance)
  return {
    key,
    n,
    values,
    mean,
    sd,
    ci95: n > 1 ? 1.96 * (sd / Math.sqrt(n)) : 0,
    min: sorted[0] ?? 0,
    max: sorted[n - 1] ?? 0,
    p05: quantile(sorted, 0.05),
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    sample: results.slice(0, 3),
  }
}

function aggregate(byStrategy, done, total) {
  const strategies = {}
  for (const [key, results] of Object.entries(byStrategy)) strategies[key] = summarise(key, results)
  return { strategies, done, total, runs: total, complete: done >= total }
}

/**
 * Start a batch. Returns a handle with `stop()`.
 *
 * @param {object} opts
 * @param {object} opts.engine   resolved engine module
 * @param {object} opts.config   SimConfig
 * @param {string[]} opts.strategies
 * @param {number} opts.runs     replications per strategy
 * @param {(e:{done:number,total:number,partial:object})=>void} opts.onProgress
 * @param {(result:object)=>void} opts.onDone
 * @param {(message:string)=>void} opts.onError
 */
export function startBatch({ engine, config, strategies, runs, onProgress, onDone, onError }) {
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
    if (i >= total) onDone?.(aggregate(byStrategy, done, total))
    else {
      onProgress?.({ done, total, partial: aggregate(byStrategy, done, total) })
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
