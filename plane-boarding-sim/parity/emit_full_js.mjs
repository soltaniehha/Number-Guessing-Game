#!/usr/bin/env node
/**
 * Emit COMPLETE `RunResult` documents for the full scenario matrix, from the
 * JAVASCRIPT engine.
 *
 * A direct mirror of `parity/emit_full_py.py`: same helper names, same matrix,
 * same order, so a reviewer can diff the two by eye.
 *
 * Where `emit_js.mjs` emits a *digest* -- a hash of a summary, which catches
 * gross divergence but can pass while per-passenger records differ -- this emits
 * everything: every per-passenger record, the seated curve, the aisle-occupancy
 * curve, the congestion matrix, the door stats. That is the comparison that
 * actually proved the port, and `parity/compare.py --full` is what re-runs it.
 *
 * Output is NDJSON -- one `{"name": ..., "result": {...}}` object per line -- so
 * the comparator can diff one scenario at a time and drop it, instead of holding
 * 384 complete results in memory on each side.
 *
 *     node parity/emit_full_js.mjs             # NDJSON on stdout
 *     node parity/emit_full_js.mjs --list      # scenario names only
 *     node parity/emit_full_js.mjs --only NAME
 */
import { aircraftIds, getAircraft } from '../web/src/sim/aircraft.js'
import { buildConfig } from '../web/src/sim/config.js'
import { simulate } from '../web/src/sim/engine.js'
import { STRATEGIES } from '../web/src/sim/strategies.js'

/**
 * The four scenario shapes each (aircraft, strategy) pair is run through.
 * Chosen to cover the axes that change the CODE PATH rather than just the
 * numbers: one door against the aircraft's own door set, both door-assignment
 * policies, a full cabin and a light one, and the cabin-wide zone fallback.
 */
const CONFIGS = [
  { _name: 'default' },
  { _name: 'single_door', doorAssignment: 'single', _one_door: true },
  { _name: 'full_split_by_aisle', loadFactor: 1.0, doorAssignment: 'split_by_aisle' },
  {
    _name: 'light_cabinwide_zones',
    loadFactor: 0.55,
    doorAwareZones: false,
    openSeatingPolicy: 'window_first',
    dt: 0.25,
  },
]

/**
 * 16 strategies x 6 aircraft x 4 configs = 384, in a fixed order.
 *
 * The seed is a function of the position in the matrix rather than a constant,
 * so the sweep covers 384 different passenger manifests instead of 24.
 */
function* scenarios() {
  let n = 0
  for (const aid of aircraftIds()) {
    const ac = getAircraft(aid)
    const oneDoor = ac.boardableDoors().map((d) => d.id).slice(0, 1)
    for (const strategy of Object.keys(STRATEGIES)) {
      for (const shape of CONFIGS) {
        const cfg = {}
        for (const [k, v] of Object.entries(shape)) if (!k.startsWith('_')) cfg[k] = v
        if (shape._one_door) cfg.doors = [...oneDoor]
        Object.assign(cfg, { aircraftId: aid, strategy, seed: 1000 + n })
        yield { name: `${aid}|${strategy}|${shape._name}`, config: cfg }
        n += 1
      }
    }
  }
}

function resultFor(scenario) {
  const cfgIn = scenario.config
  const ac = getAircraft(cfgIn.aircraftId)
  return simulate(buildConfig(ac.defaultConfig, cfgIn), ac)
}

/** `json.dumps(obj, sort_keys=True, separators=(",", ":"))`. */
function dumpSorted(value) {
  if (Array.isArray(value)) return `[${value.map(dumpSorted).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${dumpSorted(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function main(argv) {
  const wantList = argv.includes('--list')
  const onlyIdx = argv.indexOf('--only')
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : null

  const chunks = []
  for (const scenario of scenarios()) {
    if (wantList) {
      chunks.push(scenario.name + '\n')
      continue
    }
    if (only && scenario.name !== only) continue
    chunks.push(
      dumpSorted({
        name: scenario.name,
        config: scenario.config,
        result: resultFor(scenario),
      }) + '\n',
    )
    // Flush periodically: 384 complete results is tens of megabytes and the
    // comparator reads this as a stream.
    if (chunks.length >= 8) {
      process.stdout.write(chunks.join(''))
      chunks.length = 0
    }
  }
  if (chunks.length) process.stdout.write(chunks.join(''))
  return 0
}

if (process.argv[1] && process.argv[1].endsWith('emit_full_js.mjs')) {
  process.exitCode = main(process.argv.slice(2))
}

export { CONFIGS, main, resultFor, scenarios }
