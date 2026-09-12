/**
 * Fixture engine — a drop-in stand-in for `src/sim/index.js` with exactly the
 * same export surface, so `engineBridge.js` can swap between them.
 */
export { AIRCRAFT, resolveAircraft } from './aircraft.js'
export { STRATEGIES, STRATEGY_FAMILIES } from './strategies.js'
export { runSimulation, runReplay } from './mockEngine.js'
export { ENGINE_DEFAULTS as DEFAULTS } from './defaults.js'
