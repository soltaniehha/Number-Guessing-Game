/**
 * Monte Carlo driver.
 *
 * Prefers the engine agent's Web Worker (`src/sim/batchWorker.js?worker`) and
 * falls back to a chunked main-thread loop so Analytics and Compare work even
 * before the worker exists. Both paths emit the same events.
 *
 * Worker protocol (per the agreed interface):
 *   post   {type:'start', config, strategies:[...], runs:N,
 *           sweep?:{param:'loadFactor', values:[...], loadFactors:[...], runs:N}}
 *   recv   {type:'progress', done, total, partial:BatchResult}
 *          {type:'done', result:BatchResult}
 *          {type:'error', message}
 *
 * The BatchResult it produces is assembled by `state/aggregate.js`, in the
 * shape `src/charts/ChartGrid.jsx` consumes.
 */
import { createBatchWorker } from '../lib/engineBridge.js'
import { aggregateBatch } from './aggregate.js'
import { DEFAULT_SWEEP_PARAM, autoSweepRuns, specValues } from './sweep.js'

/**
 * Start a batch. Returns a handle with `stop()`.
 *
 * @param {object} opts
 * @param {object} opts.engine   resolved engine module
 * @param {object} opts.config   SimConfig
 * @param {string[]} opts.strategies
 * @param {number} opts.runs     replications per strategy
 * @param {?{param:string, values:number[], runs:number}} [opts.sweep] parameter
 *        sweep (chart 7). `runs` is the replications PER POINT and is always
 *        explicit here, so the count the panel showed is the count that runs.
 *        `values` may also arrive as `loadFactors`, which is what the axis was
 *        called when it was the only one; both are sent on, so a consumer
 *        written against either name keeps working.
 * @param {object} [opts.names]  STRATEGIES metadata, so series carry real names
 * @param {(e:{done:number,total:number,partial:object})=>void} opts.onProgress
 * @param {(result:object)=>void} opts.onDone
 * @param {(message:string)=>void} opts.onError
 */
export function startBatch({ engine, config, strategies, runs, sweep, names, onProgress, onDone, onError }) {
  const list = strategies && strategies.length ? strategies : [config.strategy]
  const spec = sweep && specValues(sweep).length ? sweep : null
  const points = specValues(spec)
  const param = spec?.param || DEFAULT_SWEEP_PARAM
  const sweepRuns = spec ? Math.max(1, Math.trunc(spec.runs ?? autoSweepRuns(runs))) : 0
  const sweepTotal = spec ? list.length * points.length * sweepRuns : 0
  // The sweep is part of the same job list, so it is part of the same total:
  // a progress bar that stops at 100% and keeps running is a bar that lies.
  const total = list.length * runs + sweepTotal

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
    worker.postMessage({
      type: 'start',
      config,
      strategies: list,
      runs,
      ...(spec
        ? { sweep: { param, values: [...points], loadFactors: [...points], runs: sweepRuns } }
        : {}),
    })
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

  // The same flat job list the worker plans, so the two paths produce the same
  // BatchResult — the main runs first, then the sweep points.
  const jobs = []
  for (const key of list) for (let r = 0; r < runs; r++) jobs.push({ kind: 'main', key, run: r })
  if (spec) {
    for (const key of list) {
      for (let li = 0; li < points.length; li++) {
        for (let r = 0; r < sweepRuns; r++) {
          jobs.push({ kind: 'sweep', key, li, param, value: points[li], run: r })
        }
      }
    }
  }

  // Running means, so a stopped or partial sweep still plots honestly.
  const sweepAcc = new Map()
  const sweepBlock = spec
    ? {
        param,
        values: [...points],
        // Emitted under both names, exactly as the worker does it.
        loadFactors: [...points],
        byStrategy: Object.fromEntries(list.map((k) => [k, points.map(() => null)])),
      }
    : null

  const assemble = (complete) => {
    const partial = aggregateBatch({ byStrategy, names, config, done, total, complete })
    if (sweepBlock) partial.sweep = sweepBlock
    return partial
  }

  const schedule = (fn) => setTimeout(fn, 0)

  function chunk() {
    if (cancelled) return
    const started = Date.now()
    while (i < jobs.length && Date.now() - started < 24) {
      const job = jobs[i]
      try {
        const result = engine.runSimulation({
          ...config,
          strategy: job.key,
          seed: (config.seed | 0) + job.run,
          ...(job.kind === 'sweep' ? { [job.param]: job.value } : {}),
        })
        if (job.kind === 'main') byStrategy[job.key].push(result)
        else {
          const cell = `${job.key}|${job.li}`
          const acc = sweepAcc.get(cell) || { sum: 0, n: 0 }
          acc.sum += result.totalSeconds
          acc.n += 1
          sweepAcc.set(cell, acc)
          sweepBlock.byStrategy[job.key][job.li] = acc.sum / acc.n
        }
      } catch (err) {
        onError?.(err?.message || String(err))
        return
      }
      i += 1
      done += 1
    }
    const partial = assemble(i >= jobs.length)
    if (i >= jobs.length) onDone?.(partial)
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
