/**
 * Application store: `useReducer` + context, nothing else.
 *
 * Three contexts on purpose:
 *   StoreContext  — config, UI state, run results. Changes rarely.
 *   ClockContext  — the playback time in seconds. Changes 60 times a second,
 *                   so it is isolated and only the status bar and cabin view
 *                   subscribe to it.
 *   PlaybackContext — the transport controls, whose identity is stable.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { deepEqual, makeConfigReducer, pickKnown, sanitizeConfig } from './configReducer.js'
import { aircraftDefaultConfig, airframeChanges, buildDefaultConfig, effectiveDefaults } from './configDefaults.js'
import { specValues, sweepSpecFor } from './sweep.js'
import { labelForKey } from '../app/controlSchema.js'
import { readHashConfig, syncHash } from '../lib/urlConfig.js'
import { PRESET_BY_ID } from '../app/presets.js'
import { startBatch } from './batchRunner.js'

const StoreContext = createContext(null)
const ClockContext = createContext(0)
const PlaybackContext = createContext(null)

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>')
  return ctx
}
export const useClock = () => useContext(ClockContext)
export function usePlayback() {
  const ctx = useContext(PlaybackContext)
  if (!ctx) throw new Error('usePlayback must be used inside <StoreProvider>')
  return ctx
}

export const SPEEDS = [1, 2, 5, 10, 25, 50, 100]

/**
 * How often a running batch is allowed to repaint the twelve charts, in ms.
 * Fast enough to read as live, slow enough that the main thread stays free for
 * the progress counter and the Stop button. See `runBatch`.
 */
export const CHART_REFRESH_MS = 450

/** Monotonic-ish clock; `performance` is absent in some test environments. */
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** True when the OS asks for reduced motion. Read at the moment of the decision. */
export function prefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
  } catch {
    return false
  }
}
const THEME_KEY = 'boardingLab.theme'
const SECTION_KEY = 'boardingLab.sections'

/* ------------------------------------------------------------------ theme */

function readStored(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

function writeStored(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private browsing / storage disabled: the app just forgets the choice */
  }
}

/** The theme the OS asks for, used when the user has not chosen one here. */
export function preferredTheme() {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches === false ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function useTheme() {
  const [theme, setTheme] = useState(() => (readStored(THEME_KEY, preferredTheme()) === 'light' ? 'light' : 'dark'))
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    writeStored(THEME_KEY, theme)
  }, [theme])
  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])
  return { theme, toggleTheme }
}

/* ---------------------------------------------------------------- provider */

/**
 * The first candidate id the engine actually has, else its first airframe.
 *
 * Nothing may hand `resolveAircraft` an id it does not know: the real engine
 * throws for one, and the call sites include the reducer's lazy initialiser,
 * which runs during render where a throw unmounts the tree.
 */
export function knownAircraftId(engine, ...candidates) {
  const registry = engine?.AIRCRAFT || {}
  for (const id of candidates) {
    if (typeof id === 'string' && Object.prototype.hasOwnProperty.call(registry, id)) return id
  }
  return Object.keys(registry)[0]
}

/** `resolveAircraft` for the first candidate that exists; null if none does. */
export function resolveAircraftSafely(engine, ...candidates) {
  const id = knownAircraftId(engine, ...candidates)
  if (id === undefined) return null
  try {
    return engine.resolveAircraft(id) ?? null
  } catch {
    return null
  }
}

export function StoreProvider({ engine, children }) {
  const defaults = useMemo(() => buildDefaultConfig(engine), [engine])
  const reducer = useMemo(() => makeConfigReducer(defaults, engine), [defaults, engine])

  const [config, rawDispatch] = useReducer(reducer, defaults, (base) => {
    // A link is untrusted input like any other: it goes through the same
    // pickKnown gate as LOAD_CONFIG and APPLY_PRESET, or an arbitrary key
    // would survive into the config and be re-encoded into the next link.
    const fromHash = readHashConfig()
    const patch = fromHash ? pickKnown(fromHash, base) : null
    // The airframe is resolved BEFORE anything is layered on it, because it is
    // what decides the door defaults — a link naming an aircraft and no doors
    // must get THAT aircraft's boarding doors, not the default airframe's.
    const id = knownAircraftId(engine, patch?.aircraftId, base.aircraftId)
    const aircraft = resolveAircraftSafely(engine, id)
    const start = effectiveDefaults(base, aircraft)
    const merged = patch ? { ...start, ...patch, aircraftId: id } : start
    return sanitizeConfig(merged, aircraft, base, engine)
  })

  const aircraft = useMemo(() => resolveAircraftSafely(engine, config.aircraftId), [engine, config.aircraftId])
  const strategy = engine.STRATEGIES[config.strategy] || null

  const { theme, toggleTheme } = useTheme()
  const [mode, setMode] = useState('cabin')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [openSections, setOpenSections] = useState(() =>
    readStored(SECTION_KEY, { scenario: true, doors: true, passengers: false, timing: false, bins: false, behaviour: false, presets: true }),
  )
  const [toast, setToast] = useState(null)
  const [modal, setModal] = useState(null)
  /**
   * Which controls the airframe just wrote, so the panel can say so in place.
   * `{ aircraftName, keys: [...] }` — cleared key by key as the user takes
   * each value back over.
   */
  const [airframeNote, setAirframeNote] = useState(null)

  const [replay, setReplay] = useState(null)
  const [replayConfig, setReplayConfig] = useState(null)
  /**
   * Identity of the run currently loaded, bumped on every Run.
   *
   * The transport used to rewind on `[duration, hasReplay]`, and re-running the
   * same scenario changes neither — so the clock stayed parked at the end of
   * the previous run and Run appeared to do nothing at all.
   */
  const runIdRef = useRef(0)
  const [runId, setRunId] = useState(0)
  const [runError, setRunError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [batch, setBatch] = useState({ running: false, stopped: false, done: 0, total: 0, result: null, error: null })
  const batchHandle = useRef(null)
  /**
   * Chart refresh throttle.
   *
   * Every progress message carries a fully aggregated partial BatchResult, and
   * applying one re-renders all twelve charts on the main thread. Doing that
   * per message froze the tab for over a second at a time (rAF gaps: p95
   * 1.1 s, max 1.6 s on b777/2000 reps, 3.35 s in Compare) and left Stop
   * taking nearly four seconds to be noticed.
   *
   * So the two halves of a progress message are decoupled: `done`/`total` are
   * applied immediately, because a counter that lags is a counter that lies,
   * and the heavy `result` is applied at most every CHART_REFRESH_MS.
   */
  const pendingResult = useRef(null)
  const lastChartPaint = useRef(0)
  const chartTimer = useRef(0)

  /* keep the address bar in step with the config */
  useEffect(() => {
    syncHash(config, defaults)
  }, [config, defaults])

  useEffect(() => {
    writeStored(SECTION_KEY, openSections)
  }, [openSections])

  useEffect(() => {
    if (!toast) return undefined
    const id = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(id)
  }, [toast])

  /* ------------------------------------------------------------- actions */

  const setField = useCallback(
    (field, value) => {
      if (field === 'aircraftId') {
        const target = resolveAircraftSafely(engine, value, defaults.aircraftId)
        // Same pure calculation the reducer runs, so what the toast names and
        // what the config gets cannot disagree.
        const changes = airframeChanges(config, defaults, aircraft, target)
        rawDispatch({ type: 'SET_FIELD', field, value, aircraft: target, prevAircraft: aircraft })
        if (changes.length) {
          const keys = changes.map((c) => c.key)
          setAirframeNote({ aircraftName: target?.name || value, keys })
          setToast({ kind: 'ok', text: `${target?.name || value} defaults applied: ${keys.map(labelForKey).join(', ')}` })
        } else {
          setAirframeNote(null)
          // The previous airframe's "defaults applied" toast is about the
          // previous airframe. Leaving it up for its remaining seconds after a
          // switch that changed nothing reads as a claim about the new one.
          setToast({ kind: 'ok', text: `${target?.name || value}: no parameter defaults to apply.` })
        }
        return
      }
      // Taking a value back over retires the airframe's claim on it.
      setAirframeNote((note) => {
        if (!note || !note.keys.includes(field)) return note
        const keys = note.keys.filter((k) => k !== field)
        return keys.length ? { ...note, keys } : null
      })
      rawDispatch({ type: 'SET_FIELD', field, value, aircraft })
    },
    [engine, aircraft, config, defaults],
  )

  const toggleDoor = useCallback((doorId) => rawDispatch({ type: 'TOGGLE_DOOR', doorId, aircraft }), [aircraft])

  const loadConfig = useCallback(
    (partial) => {
      const target = resolveAircraftSafely(engine, partial?.aircraftId, config.aircraftId, defaults.aircraftId)
      setAirframeNote(null)
      rawDispatch({ type: 'LOAD_CONFIG', config: partial, aircraft: target })
    },
    [engine, config.aircraftId, defaults.aircraftId],
  )

  const applyPreset = useCallback(
    (presetId) => {
      const preset = PRESET_BY_ID[presetId]
      if (!preset) return
      const target = resolveAircraftSafely(engine, preset.patch.aircraftId, config.aircraftId, defaults.aircraftId)
      rawDispatch({ type: 'APPLY_PRESET', patch: preset.patch, aircraft: target })
      // A preset states some parameters explicitly; the rest come from the
      // airframe it names. Only the latter are the airframe's doing.
      const fromAirframe = Object.keys(aircraftDefaultConfig(target, defaults)).filter(
        (key) => !Object.prototype.hasOwnProperty.call(preset.patch, key) && !deepEqual(defaults[key], target?.defaultConfig?.[key]),
      )
      setAirframeNote(fromAirframe.length ? { aircraftName: target?.name || target?.id, keys: fromAirframe } : null)
      setToast({ kind: 'ok', text: `Loaded preset: ${preset.name}` })
    },
    [engine, config.aircraftId, defaults],
  )

  const reset = useCallback(() => {
    setAirframeNote(null)
    rawDispatch({ type: 'RESET', aircraft: resolveAircraftSafely(engine, defaults.aircraftId) })
  }, [engine, defaults.aircraftId])

  const randomiseSeed = useCallback(() => {
    const next = Math.floor(Math.random() * 1_000_000_000)
    rawDispatch({ type: 'SET_FIELD', field: 'seed', value: next, aircraft })
  }, [aircraft])

  /* ------------------------------------------------------- running things */

  /** Apply the newest partial result the throttle is holding, if any. */
  const flushCharts = useCallback(() => {
    if (chartTimer.current) {
      clearTimeout(chartTimer.current)
      chartTimer.current = 0
    }
    const pending = pendingResult.current
    if (!pending) return
    pendingResult.current = null
    lastChartPaint.current = now()
    setBatch((b) => ({ ...b, result: pending }))
  }, [])

  /** Drop anything the throttle is holding, without painting it. */
  const cancelChartFlush = useCallback(() => {
    if (chartTimer.current) {
      clearTimeout(chartTimer.current)
      chartTimer.current = 0
    }
    pendingResult.current = null
  }, [])

  const stopBatch = useCallback(() => {
    // Order matters: drop the queued repaint FIRST, so stopping never pays for
    // one more twelve-chart render before it takes effect.
    cancelChartFlush()
    batchHandle.current?.stop()
    batchHandle.current = null
    setBatch((b) => ({ ...b, running: false, stopped: true }))
  }, [cancelChartFlush])

  const runCabin = useCallback(() => {
    setBusy(true)
    setRunError(null)
    // Yield one frame so the Run button can paint its busy state first.
    setTimeout(() => {
      try {
        const next = engine.runReplay(config)
        setReplay(next && next.result ? next : { result: next, duration: next?.totalSeconds ?? 0 })
        setReplayConfig(config)
        runIdRef.current += 1
        setRunId(runIdRef.current)
      } catch (err) {
        setRunError(err?.message || String(err))
        setReplay(null)
      } finally {
        setBusy(false)
      }
    }, 0)
  }, [engine, config])

  const runBatch = useCallback(
    (strategies, options) => {
      batchHandle.current?.stop()
      const list = strategies && strategies.length ? strategies : [config.strategy]
      // Chart 7 only gets data if somebody asks for it. The sweep is part of
      // the same job list, so it is part of the total the progress bar divides
      // by — otherwise the bar sits at 100% for the whole second axis.
      const sweep = options?.sweep === undefined ? sweepSpecFor(config, mode, engine.SWEEPABLE) : options.sweep
      const sweepTotal = sweep ? list.length * specValues(sweep).length * sweep.runs : 0
      cancelChartFlush()
      setBatch({
        running: true,
        stopped: false,
        done: 0,
        total: list.length * config.runs + sweepTotal,
        result: null,
        error: null,
      })
      batchHandle.current = startBatch({
        engine,
        config,
        aircraft,
        strategies: list,
        runs: config.runs,
        sweep,
        names: engine.STRATEGIES,
        onProgress: ({ done, total, partial }) => {
          // Cheap half: always, so the counter tracks the run.
          setBatch((b) => ({ ...b, done, total }))
          if (!partial) return
          // Expensive half: at most every CHART_REFRESH_MS, newest wins.
          pendingResult.current = partial
          const wait = CHART_REFRESH_MS - (now() - lastChartPaint.current)
          if (wait <= 0) flushCharts()
          else if (!chartTimer.current) chartTimer.current = setTimeout(flushCharts, wait)
        },
        onDone: (result) => {
          cancelChartFlush()
          lastChartPaint.current = now()
          setBatch({
            running: false,
            stopped: false,
            done: result?.done ?? result?.total ?? 0,
            total: result?.total ?? 0,
            result,
            error: null,
          })
          batchHandle.current = null
        },
        onError: (message) => {
          cancelChartFlush()
          setBatch((b) => ({ ...b, running: false, error: message }))
          batchHandle.current = null
        },
      })
    },
    [engine, config, mode, aircraft, cancelChartFlush, flushCharts],
  )

  const run = useCallback(() => {
    if (mode === 'cabin') runCabin()
    else if (mode === 'analytics') runBatch([config.strategy])
    else runBatch(config.compareStrategies)
  }, [mode, runCabin, runBatch, config.strategy, config.compareStrategies])

  useEffect(
    () => () => {
      batchHandle.current?.stop()
      if (chartTimer.current) clearTimeout(chartTimer.current)
    },
    [],
  )

  const toggleSection = useCallback((id) => setOpenSections((s) => ({ ...s, [id]: !s[id] })), [])

  const value = useMemo(
    () => ({
      engine,
      defaults,
      config,
      aircraft,
      strategy,
      strategies: engine.STRATEGIES,
      aircraftList: Object.values(engine.AIRCRAFT),
      isMockEngine: engine.isMock,
      setField,
      toggleDoor,
      loadConfig,
      applyPreset,
      reset,
      randomiseSeed,
      mode,
      setMode,
      theme,
      toggleTheme,
      drawerOpen,
      setDrawerOpen,
      openSections,
      toggleSection,
      toast,
      setToast,
      airframeNote,
      modal,
      setModal,
      replay,
      // True once the config has moved on from the run currently on screen.
      replayStale: Boolean(replay && replayConfig && !deepEqual(replayConfig, config)),
      runError,
      busy,
      run,
      batch,
      runBatch,
      stopBatch,
    }),
    [
      engine, defaults, config, aircraft, strategy, setField, toggleDoor, loadConfig, applyPreset, reset,
      randomiseSeed, mode, theme, toggleTheme, drawerOpen, openSections, toggleSection, toast, modal, airframeNote,
      replay, replayConfig, runError, busy, run, batch, runBatch, stopBatch,
    ],
  )

  return (
    <StoreContext.Provider value={value}>
      <PlaybackProvider
        duration={replay?.duration ?? replay?.result?.totalSeconds ?? 0}
        hasReplay={Boolean(replay)}
        runId={runId}
      >
        {children}
      </PlaybackProvider>
    </StoreContext.Provider>
  )
}

/* --------------------------------------------------------------- playback */

function PlaybackProvider({ duration, hasReplay, runId, children }) {
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(10)
  const raf = useRef(0)
  const last = useRef(0)

  // A fresh replay rewinds the transport and starts it — unless the user has
  // asked for reduced motion, in which case it waits to be told to play.
  //
  // Keyed on `runId`, not on the duration: re-running the SAME scenario
  // produces the same duration by construction, so a duration-keyed effect
  // never fired and the clock sat at the end of the previous run.
  useEffect(() => {
    setT(0)
    setPlaying(hasReplay && duration > 0 && !prefersReducedMotion())
  }, [runId, duration, hasReplay])

  useEffect(() => {
    if (!playing || duration <= 0) return undefined
    last.current = performance.now()
    const tick = (now) => {
      const dt = (now - last.current) / 1000
      last.current = now
      setT((prev) => {
        const next = prev + dt * speed
        if (next >= duration) {
          setPlaying(false)
          return duration
        }
        return next
      })
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [playing, speed, duration])

  const api = useMemo(() => {
    /** Close enough to the end that playing on would be over within a frame. */
    const atEnd = (t) => duration - t <= Math.max(0.15, speed / 60)
    return {
      duration,
      playing,
      speed,
      setSpeed,
      // Play at the end of the timeline used to be a dead no-op: the clock was
      // already at `duration`, so the rAF loop stopped itself on its first
      // tick and the button flicked back to Play. Pressing Play always plays
      // something now — from the top when there is nothing left to play.
      //
      // "Nothing left" is measured in frames, not in floating-point equality:
      // parking the scrub at its far right leaves the clock a step short of
      // the duration, and at 100x a second of remaining timeline is a single
      // frame. Anything that would be over before it is seen counts as the end.
      play: () => {
        if (duration <= 0) return
        setT((prev) => (atEnd(prev) ? 0 : prev))
        setPlaying(true)
      },
      pause: () => setPlaying(false),
      toggle: () => {
        if (duration <= 0) return
        if (playing) {
          setPlaying(false)
          return
        }
        setT((prev) => (atEnd(prev) ? 0 : prev))
        setPlaying(true)
      },
      seek: (v) => setT(Math.max(0, Math.min(duration, v))),
      step: (delta) => {
        setPlaying(false)
        setT((prev) => Math.max(0, Math.min(duration, prev + delta)))
      },
      rewind: () => {
        setPlaying(false)
        setT(0)
      },
    }
  }, [duration, playing, speed])

  return (
    <PlaybackContext.Provider value={api}>
      <ClockContext.Provider value={t}>{children}</ClockContext.Provider>
    </PlaybackContext.Provider>
  )
}
