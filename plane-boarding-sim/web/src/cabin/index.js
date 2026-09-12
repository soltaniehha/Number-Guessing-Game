/**
 * Cabin mode — the live top-down boarding view.
 *
 * Public surface for the rest of the app. Nothing outside `src/cabin/` should
 * need to reach into the internals.
 */

export { default as CabinView } from './CabinView.jsx'
export { default as PlaybackControls } from './PlaybackControls.jsx'
export { default as PassengerTooltip } from './PassengerTooltip.jsx'
export { default as CabinLegend } from './CabinLegend.jsx'
export { usePlayback } from './usePlayback.js'

export {
  SPEEDS,
  STATE,
  STATE_NAMES,
  SMOOTH_SPEED_LIMIT,
  advanceTime,
  compressQueue,
  formatClock,
  formatDuration,
  frameCursor,
  interpolateX,
  replayDuration,
  sampleSeries,
  scrubToTime,
  seatedSeries,
  stateAtTime,
  stateTally,
  stepTime,
  timeToFraction,
} from './playback.js'

export { readTokens, observeTheme } from './tokens.js'
export { buildCabinModel, computeGeometry } from './geometry.js'
