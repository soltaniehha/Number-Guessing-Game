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
import { sweepSpecFor } from './sweep.js'
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

export function StoreProvider({ engine, children }) {
  const defaults = useMemo(() => buildDefaultConfig(engine), [engine])
  const reducer = useMemo(() => makeConfigReducer(defaults), [defaults])

  const [config, rawDispatch] = useReducer(reducer, defaults, (base) => {
    const fromHash = readHashConfig()
    const id = (fromHash && fromHash.aircraftId) || base.aircraftId
    // The airframe's own defaults sit between the base defaults and anything
    // the link asks for, exactly as the engine layers them.
    const start = effectiveDefaults(base, engine.resolveAircraft(id))
    if (!fromHash) return sanitizeConfig(start, engine.resolveAircraft(id), base)
    // A link is untrusted input like any other: it goes through the same
    // pickKnown gate as LOAD_CONFIG and APPLY_PRESET, or an arbitrary key
    // would survive into the config and be re-encoded into the next link.
    const merged = { ...start, ...pickKnown(fromHash, base) }
    return sanitizeConfig(merged, engine.resolveAircraft(merged.aircraftId), base)
  })

  const aircraft = useMemo(() => engine.resolveAircraft(config.aircraftId), [engine, config.aircraftId])
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
  const [runError, setRunError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [batch, setBatch] = useState({ running: false, done: 0, total: 0, result: null, error: null })
  const batchHandle = useRef(null)

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
        const target = engine.resolveAircraft(value)
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
      const target = engine.resolveAircraft(partial?.aircraftId || config.aircraftId)
      setAirframeNote(null)
      rawDispatch({ type: 'LOAD_CONFIG', config: partial, aircraft: target })
    },
    [engine, config.aircraftId],
  )

  const applyPreset = useCallback(
    (presetId) => {
      const preset = PRESET_BY_ID[presetId]
      if (!preset) return
      const target = engine.resolveAircraft(preset.patch.aircraftId || config.aircraftId)
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
    rawDispatch({ type: 'RESET', aircraft: engine.resolveAircraft(defaults.aircraftId) })
  }, [engine, defaults.aircraftId])

  const randomiseSeed = useCallback(() => {
    const next = Math.floor(Math.random() * 1_000_000_000)
    rawDispatch({ type: 'SET_FIELD', field: 'seed', value: next, aircraft })
  }, [aircraft])

  /* ------------------------------------------------------- running things */

  const stopBatch = useCallback(() => {
    batchHandle.current?.stop()
    batchHandle.current = null
    setBatch((b) => ({ ...b, running: false }))
  }, [])

  const runCabin = useCallback(() => {
    setBusy(true)
    setRunError(null)
    // Yield one frame so the Run button can paint its busy state first.
    setTimeout(() => {
      try {
        const next = engine.runReplay(config)
        setReplay(next && next.result ? next : { result: next, duration: next?.totalSeconds ?? 0 })
        setReplayConfig(config)
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
      const sweep = options?.sweep === undefined ? sweepSpecFor(config, mode) : options.sweep
      const sweepTotal = sweep ? list.length * sweep.loadFactors.length * sweep.runs : 0
      setBatch({ running: true, done: 0, total: list.length * config.runs + sweepTotal, result: null, error: null })
      batchHandle.current = startBatch({
        engine,
        config,
        strategies: list,
        runs: config.runs,
        sweep,
        names: engine.STRATEGIES,
        onProgress: ({ done, total, partial }) => setBatch((b) => ({ ...b, done, total, result: partial ?? b.result })),
        onDone: (result) => {
          setBatch({ running: false, done: result?.done ?? result?.total ?? 0, total: result?.total ?? 0, result, error: null })
          batchHandle.current = null
        },
        onError: (message) => {
          setBatch((b) => ({ ...b, running: false, error: message }))
          batchHandle.current = null
        },
      })
    },
    [engine, config, mode],
  )

  const run = useCallback(() => {
    if (mode === 'cabin') runCabin()
    else if (mode === 'analytics') runBatch([config.strategy])
    else runBatch(config.compareStrategies)
  }, [mode, runCabin, runBatch, config.strategy, config.compareStrategies])

  useEffect(() => () => batchHandle.current?.stop(), [])

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
      <PlaybackProvider duration={replay?.duration ?? replay?.result?.totalSeconds ?? 0} hasReplay={Boolean(replay)}>
        {children}
      </PlaybackProvider>
    </StoreContext.Provider>
  )
}

/* --------------------------------------------------------------- playback */

function PlaybackProvider({ duration, hasReplay, children }) {
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(10)
  const raf = useRef(0)
  const last = useRef(0)

  // A fresh replay rewinds the transport and starts it — unless the user has
  // asked for reduced motion, in which case it waits to be told to play.
  useEffect(() => {
    setT(0)
    setPlaying(hasReplay && duration > 0 && !prefersReducedMotion())
  }, [duration, hasReplay])

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

  const api = useMemo(
    () => ({
      duration,
      playing,
      speed,
      setSpeed,
      play: () => duration > 0 && setPlaying(true),
      pause: () => setPlaying(false),
      toggle: () => duration > 0 && setPlaying((p) => !p),
      seek: (v) => setT(Math.max(0, Math.min(duration, v))),
      step: (delta) => {
        setPlaying(false)
        setT((prev) => Math.max(0, Math.min(duration, prev + delta)))
      },
      rewind: () => {
        setPlaying(false)
        setT(0)
      },
    }),
    [duration, playing, speed],
  )

  return (
    <PlaybackContext.Provider value={api}>
      <ClockContext.Provider value={t}>{children}</ClockContext.Provider>
    </PlaybackContext.Provider>
  )
}
