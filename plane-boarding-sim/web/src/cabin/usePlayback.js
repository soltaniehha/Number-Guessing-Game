/**
 * The playback clock.
 *
 * Drives simulated time from `requestAnimationFrame` using real wall-clock
 * deltas, so at 1x one wall-clock second is exactly one simulated second and
 * a dropped frame costs no accuracy. Above 25x nothing special happens by
 * design: the same multiply simply advances time by a bigger delta per frame
 * instead of trying to render every 0.25 s tick.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { advanceTime, isAtEnd, stepTime } from './playback.js'

export function usePlayback({
  duration = 0,
  frameInterval = 0.25,
  initialSpeed = 1,
  autoPlay = false,
} = {}) {
  const [t, setTState] = useState(0)
  const [playing, setPlaying] = useState(autoPlay)
  const [speed, setSpeed] = useState(initialSpeed)

  const tRef = useRef(0)
  const speedRef = useRef(initialSpeed)
  const durationRef = useRef(duration)
  const resumeRef = useRef(false)

  speedRef.current = speed
  durationRef.current = duration

  const setT = useCallback((next) => {
    const clamped = Math.max(0, Math.min(durationRef.current, next))
    tRef.current = clamped
    setTState(clamped)
  }, [])

  // A new replay resets the clock.
  useEffect(() => {
    tRef.current = 0
    setTState(0)
  }, [duration])

  useEffect(() => {
    if (!playing || !(duration > 0)) return undefined
    let raf = 0
    let last = performance.now()

    const tick = (now) => {
      const wall = (now - last) / 1000
      last = now
      const next = advanceTime(tRef.current, wall, speedRef.current, durationRef.current)
      tRef.current = next
      setTState(next)
      if (isAtEnd(next, durationRef.current)) {
        setPlaying(false)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, duration])

  // Pause cleanly when the tab is hidden; pick up where we left off on return.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const onVisibility = () => {
      if (document.hidden) {
        setPlaying((was) => {
          resumeRef.current = was
          return false
        })
      } else if (resumeRef.current) {
        resumeRef.current = false
        setPlaying(true)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const toggle = useCallback(() => {
    setPlaying((was) => {
      // Restarting from the end rewinds rather than sticking.
      if (!was && isAtEnd(tRef.current, durationRef.current)) {
        tRef.current = 0
        setTState(0)
      }
      return !was
    })
  }, [])

  const step = useCallback(
    (dir) => {
      setPlaying(false)
      setT(stepTime(tRef.current, dir, frameInterval, durationRef.current))
    },
    [frameInterval, setT],
  )

  const reset = useCallback(() => {
    setPlaying(false)
    setT(0)
  }, [setT])

  return { t, setT, playing, setPlaying, toggle, speed, setSpeed, step, reset }
}
