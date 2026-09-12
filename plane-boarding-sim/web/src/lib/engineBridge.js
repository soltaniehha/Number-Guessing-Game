/**
 * THE INTEGRATION SEAM.
 * =====================
 *
 * Everything in the app shell talks to the simulation engine, the cabin
 * renderer and the chart grid through this module and nothing else. Each of
 * those three lives in a directory owned by another agent, so this file has to
 * work whether or not those directories exist yet.
 *
 * How it works: `import.meta.glob` with a literal path is a *build-time*
 * lookup. If the file exists, Vite emits a lazy loader for it; if it does not,
 * the glob resolves to an empty object and the build still succeeds. So there
 * is no broken import, no try/catch around a missing module, and no runtime
 * 404 in production.
 *
 * TO INTEGRATE: nothing to do. The moment `src/sim/index.js` exists the app
 * picks it up. To force the fixture engine for debugging, set
 * `?engine=mock` on the URL or `localStorage.boardingLab.engine = 'mock'`.
 *
 * Expected engine surface (docs/ENGINE_SPEC.md):
 *   AIRCRAFT, STRATEGIES, DEFAULTS, runSimulation(config), runReplay(config),
 *   resolveAircraft(id)
 *
 * Expected Replay surface (assumed, since it is defined by src/cabin):
 *   { result: RunResult, duration: number, dt: number, frames: Frame[] }
 * The shell only ever reads `duration` (for the scrub bar) and `result`;
 * everything else is handed straight to <CabinView/>.
 */
import { lazy } from 'react'

/** import.meta.glob is Vite-only; guard so the module can be imported in plain node. */
function safeGlob(fn) {
  try {
    return fn() || {}
  } catch {
    return {}
  }
}

const SIM_PATH = '../sim/index.js'
const WORKER_PATH = '../sim/batchWorker.js'
const CABIN_PATH = '../cabin/CabinView.jsx'
const CHARTS_PATH = '../charts/ChartGrid.jsx'

const simModules = safeGlob(() => import.meta.glob('../sim/index.js'))
const workerModules = safeGlob(() => import.meta.glob('../sim/batchWorker.js', { query: '?worker', import: 'default', eager: true }))
const cabinModules = safeGlob(() => import.meta.glob('../cabin/CabinView.jsx'))
const chartModules = safeGlob(() => import.meta.glob('../charts/ChartGrid.jsx'))

/** True when the real engine module is present in the build. */
export const hasRealEngine = Boolean(simModules[SIM_PATH])
/** True when the real batch worker is present in the build. */
export const hasRealWorker = Boolean(workerModules[WORKER_PATH])
/** True when the cabin agent's renderer is present. */
export const hasCabinView = Boolean(cabinModules[CABIN_PATH])
/** True when the charts agent's grid is present. */
export const hasChartGrid = Boolean(chartModules[CHARTS_PATH])

function mockForced() {
  try {
    if (typeof window === 'undefined') return false
    if (new URLSearchParams(window.location.search).get('engine') === 'mock') return true
    return window.localStorage.getItem('boardingLab.engine') === 'mock'
  } catch {
    return false
  }
}

let enginePromise = null

/**
 * Resolve the engine module: the real one when it exists, otherwise the
 * fixture engine in `src/app/__fixtures__`.
 * @returns {Promise<{AIRCRAFT, STRATEGIES, DEFAULTS, runSimulation, runReplay, resolveAircraft, isMock: boolean}>}
 */
export function loadEngine() {
  if (enginePromise) return enginePromise
  const useReal = hasRealEngine && !mockForced()
  enginePromise = (useReal ? simModules[SIM_PATH]() : import('../app/__fixtures__/index.js'))
    .then((mod) => normaliseEngine(mod, !useReal))
    .catch(() => import('../app/__fixtures__/index.js').then((mod) => normaliseEngine(mod, true)))
  return enginePromise
}

function normaliseEngine(mod, isMock) {
  const AIRCRAFT = mod.AIRCRAFT || {}
  const resolveAircraft = mod.resolveAircraft || ((id) => AIRCRAFT[id])
  return {
    AIRCRAFT,
    STRATEGIES: mod.STRATEGIES || {},
    DEFAULTS: mod.DEFAULTS || {},
    runSimulation: mod.runSimulation,
    runReplay: mod.runReplay || mod.runSimulation,
    resolveAircraft,
    isMock,
  }
}

/**
 * Construct the batch Web Worker, or return null when the engine agent has not
 * shipped it yet (callers then fall back to a chunked main-thread loop).
 * @returns {Worker|null}
 */
export function createBatchWorker() {
  if (!hasRealWorker || mockForced()) return null
  try {
    const WorkerCtor = workerModules[WORKER_PATH]
    return new WorkerCtor()
  } catch {
    return null
  }
}

/** <CabinView replay tSeconds aircraft/>, or null when src/cabin is absent. */
export const CabinView = hasCabinView
  ? lazy(() => cabinModules[CABIN_PATH]().then((m) => ({ default: m.default || m.CabinView })))
  : null

/** <ChartGrid batch runs live/>, or null when src/charts is absent. */
export const ChartGrid = hasChartGrid
  ? lazy(() => chartModules[CHARTS_PATH]().then((m) => ({ default: m.default || m.ChartGrid })))
  : null
