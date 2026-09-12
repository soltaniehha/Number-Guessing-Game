#!/usr/bin/env node
/**
 * Emit the canonical parity digest for every fixture, from the JAVASCRIPT engine.
 *
 * A direct mirror of `parity/emit_py.py`: same helper names, same order of
 * operations, so a reviewer can diff the two by eye.
 *
 *     node parity/emit_js.mjs            # digest JSON on stdout
 *     node parity/emit_js.mjs --list     # fixture names only
 *
 * Digest contract (ENGINE_SPEC 9): keys sorted, every float rounded to 9
 * decimal places. Rounding is what makes the comparison meaningful -- IEEE
 * doubles agree between the two languages to far better than 1e-9 for these
 * quantities, but their shortest-repr printing does not, so we round before
 * serialising rather than relying on the differ's tolerance.
 *
 * The one place this file has to work harder than its Python twin is
 * `canonical()`. `config_hash` hashes the fixture config re-serialised the way
 * `json.dumps(sort_keys=True, separators=(",", ":"))` would, and Python
 * distinguishes the int `1` from the float `1.0` where `JSON.parse` does not.
 * So the fixture file is parsed with a tokenizer that keeps each number's
 * literal text, and numbers are re-emitted with Python's `repr` rules.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { geometryPayload, getAircraft } from '../web/src/sim/aircraft.js'
import { buildConfig } from '../web/src/sim/config.js'
import { simulate } from '../web/src/sim/engine.js'
import { pyRound } from '../web/src/sim/pyutil.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES_PATH = join(HERE, 'fixtures.json')

/**
 * Curve resample step, in seconds. Fixed at 10 s so the digest does not depend
 * on `sampleInterval`, which is a presentation setting rather than physics.
 */
const CURVE_STEP = 10.0
const ROUND_DP = 9

/**
 * 32-bit FNV-1a over UTF-8. Chosen because it is four lines in any language and
 * needs no crypto library on either side of the parity harness.
 */
export function fnv1a32(text) {
  let h = 0x811c9dc5
  for (const byte of new TextEncoder().encode(text)) {
    h ^= byte
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// ---------------------------------------------------------------------------
// JSON with number literals preserved
// ---------------------------------------------------------------------------

/** A number as it was written in the source, so int/float can be told apart. */
class RawNumber {
  constructor(text) {
    this.text = text
    this.value = Number(text)
    this.isInt = !/[.eE]/.test(text)
  }
}

/** Parse JSON, wrapping every number in a `RawNumber`. */
function parseJsonRaw(text) {
  let i = 0

  const ws = () => {
    while (i < text.length && (text[i] === ' ' || text[i] === '\n' || text[i] === '\r' || text[i] === '\t')) i += 1
  }
  const fail = (msg) => {
    throw new Error(`${msg} at offset ${i}`)
  }

  function value() {
    ws()
    const c = text[i]
    if (c === '{') return object()
    if (c === '[') return array()
    if (c === '"') return string()
    if (c === 't') {
      i += 4
      return true
    }
    if (c === 'f') {
      i += 5
      return false
    }
    if (c === 'n') {
      i += 4
      return null
    }
    return number()
  }

  function object() {
    i += 1 // {
    const out = new Map()
    ws()
    if (text[i] === '}') {
      i += 1
      return out
    }
    for (;;) {
      ws()
      const key = string()
      ws()
      if (text[i] !== ':') fail('expected :')
      i += 1
      out.set(key, value())
      ws()
      if (text[i] === ',') {
        i += 1
        continue
      }
      if (text[i] === '}') {
        i += 1
        return out
      }
      fail('expected , or }')
    }
  }

  function array() {
    i += 1 // [
    const out = []
    ws()
    if (text[i] === ']') {
      i += 1
      return out
    }
    for (;;) {
      out.push(value())
      ws()
      if (text[i] === ',') {
        i += 1
        continue
      }
      if (text[i] === ']') {
        i += 1
        return out
      }
      fail('expected , or ]')
    }
  }

  function string() {
    if (text[i] !== '"') fail('expected string')
    const start = i
    i += 1
    while (i < text.length) {
      if (text[i] === '\\') i += 2
      else if (text[i] === '"') {
        i += 1
        return JSON.parse(text.slice(start, i))
      } else i += 1
    }
    return fail('unterminated string')
  }

  function number() {
    const start = i
    while (i < text.length && /[-+0-9.eE]/.test(text[i])) i += 1
    if (i === start) fail('expected a value')
    return new RawNumber(text.slice(start, i))
  }

  const out = value()
  ws()
  return out
}

/** Strip the `RawNumber`/`Map` wrappers back to ordinary JS values. */
function plain(node) {
  if (node instanceof RawNumber) return node.value
  if (node instanceof Map) {
    const out = {}
    for (const [k, v] of node) out[k] = plain(v)
    return out
  }
  if (Array.isArray(node)) return node.map(plain)
  return node
}

/**
 * Python's `repr` for a number that came out of `json.load`.
 *
 * A literal with no `.` and no exponent is an int and prints without a decimal
 * point; anything else is a float and always has one. Fixture configs are
 * required to be plain round-trippable values, so the exponent branch is
 * defensive only.
 */
function pyNumberRepr(raw) {
  if (raw.isInt) return String(BigInt(raw.text))
  let s = String(raw.value)
  if (!/[.eE]/.test(s)) s += '.0'
  // JS writes 1e-7 where Python writes 1e-07.
  s = s.replace(/e([+-])(\d)$/, 'e$10$2')
  return s
}

/** `json.dumps(obj, sort_keys=True, separators=(",", ":"))`. */
export function canonical(node) {
  if (node instanceof RawNumber) return pyNumberRepr(node)
  if (node === null) return 'null'
  if (node === true) return 'true'
  if (node === false) return 'false'
  if (typeof node === 'string') return JSON.stringify(node)
  if (Array.isArray(node)) return `[${node.map(canonical).join(',')}]`
  if (node instanceof Map) {
    const keys = [...node.keys()].sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(node.get(k))}`).join(',')}}`
  }
  if (typeof node === 'number') return Number.isInteger(node) ? `${node}.0` : String(node)
  throw new Error(`cannot canonicalise ${typeof node}`)
}

/** Round to 9 dp, normalising -0.0 to 0.0 so the two languages print alike. */
export function r9(value) {
  const out = pyRound(Number(value), ROUND_DP)
  return out === 0 ? 0.0 : out
}

/**
 * Cumulative seated count on a fixed 10 s grid, computed from the sit times
 * themselves rather than from the engine's sampled curve -- the sampling
 * interval is a config knob and must not leak into the parity contract.
 */
/**
 * A 6-dp float as fixed-point text, with -0 normalised to 0.
 *
 * Fixed-point rather than the language's own number repr, because Python prints
 * an integral float as `1.0` and JavaScript prints it as `1`. Every value fed to
 * this has already been through `round(x, 6)`, so it sits within an ulp of a
 * 6-dp decimal and both `%.6f` and `Number.toFixed(6)` recover that decimal
 * exactly -- there is no tie for their differing tie rules to disagree about.
 */
export function f6(value) {
  return (value + 0).toFixed(6)
}

const i = (value) => String(Math.trunc(value))

/**
 * Hash every ROUNDED value in `geometryPayload`, plus the identifiers that give
 * them meaning. Mirrors `geometry_fingerprint` in `emit_py.py`.
 *
 * The digest covers the simulation but used to stop at the cabin door: nothing
 * in it depended on the geometry payload, so a rounding disagreement between
 * `round(x, 6)` and a hand-rolled `Math.round(v * 1e6) / 1e6` could ship
 * undetected until an airframe's pitch happened to land on a tie. It is a hash
 * rather than a list of numbers because the differ compares numerically with a
 * 1e-6 tolerance, which is precisely the size of the disagreement being looked
 * for -- an exact string hash is the only thing that can see it.
 */
export function geometryFingerprint(ac) {
  const g = geometryPayload(ac)
  const parts = [
    g.id, i(g.aisleCount), i(g.seatCount), i(g.maxDepth),
    f6(g.lengthM), i(g.binBagsPerRowSide),
  ]
  for (const r of g.rows) parts.push(i(r.slot), i(r.number), f6(r.x), f6(r.pitch))
  for (const s of g.seats) {
    parts.push(i(s.index), s.id, f6(s.x), i(s.rowSlot), i(s.aisle),
      i(s.depth), i(s.blockId), i(s.binRun))
  }
  for (const d of g.doors) parts.push(d.id, f6(d.x), i(d.aisle))
  return fnv1a32(parts.join('|'))
}

export function seatedCurve(sitTimes, total) {
  const ordered = sitTimes.slice().sort((a, b) => a - b)
  const steps = Math.floor(total / CURVE_STEP + 1e-9) + 1
  const out = []
  let idx = 0
  for (let k = 0; k <= steps; k++) {
    const t = k * CURVE_STEP
    while (idx < ordered.length && ordered[idx] <= t + 1e-9) idx += 1
    out.push([r9(t), idx])
  }
  return out
}

export function digestFor(fixture) {
  const cfgRaw = fixture.get('config')
  const cfgIn = plain(cfgRaw)
  const ac = getAircraft(cfgIn.aircraftId)
  const cfg = buildConfig(ac.defaultConfig, cfgIn)
  const result = simulate(cfg, ac)
  const sits = result.perPassenger.map((p) => p.sitTime)
  const breakdown = {}
  for (const k of Object.keys(result.timeBreakdown).sort()) breakdown[k] = r9(result.timeBreakdown[k])
  const interference = {}
  for (const k of Object.keys(result.interference).sort()) {
    interference[k] = Math.trunc(result.interference[k])
  }
  return {
    config_hash: fnv1a32(canonical(cfgRaw)),
    geometry_hash: geometryFingerprint(ac),
    totalSeconds: r9(result.totalSeconds),
    paxCount: result.paxCount,
    seatCount: result.seatCount,
    doors: [...result.doors],
    timeBreakdown: breakdown,
    interference,
    gateChecks: result.gateChecks,
    binSearches: result.binSearches,
    aisleBlockEvents: result.aisleBlockEvents,
    seatedCurve: seatedCurve(sits, result.totalSeconds),
    first20SitTimes: sits.slice(0, 20).map(r9),
  }
}

/** `json.dumps(out, sort_keys=True, indent=...)` for a digest tree. */
function dumpSorted(value, indent, depth = 0) {
  const pad = indent === null ? '' : '\n' + ' '.repeat(indent * (depth + 1))
  const padEnd = indent === null ? '' : '\n' + ' '.repeat(indent * depth)
  const sep = indent === null ? ', ' : ',' + pad
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    return `[${pad}${value.map((v) => dumpSorted(v, indent, depth + 1)).join(sep)}${padEnd}]`
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    if (!keys.length) return '{}'
    const body = keys
      .map((k) => `${JSON.stringify(k)}: ${dumpSorted(value[k], indent, depth + 1)}`)
      .join(sep)
    return `{${pad}${body}${padEnd}}`
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) && !Object.is(value, -0) ? String(value) : String(value)
  }
  return JSON.stringify(value)
}

function main(argv) {
  const wantList = argv.includes('--list')
  const onlyIdx = argv.indexOf('--only')
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : null
  const indentIdx = argv.indexOf('--indent')
  const indent = indentIdx >= 0 ? Number(argv[indentIdx + 1]) : null

  const parsed = parseJsonRaw(readFileSync(FIXTURES_PATH, 'utf-8'))
  const fixtures = parsed.get('fixtures')

  if (wantList) {
    for (const f of fixtures) process.stdout.write(`${f.get('name')}\n`)
    return 0
  }

  const out = {}
  for (const f of fixtures) {
    const name = f.get('name')
    if (only && name !== only) continue
    out[name] = digestFor(f)
  }
  process.stdout.write(dumpSorted(out, indent) + '\n')
  return 0
}

// `if __name__ == "__main__"` -- so the helpers above can be imported by tests
// without the CLI running.
if (process.argv[1] && process.argv[1].endsWith('emit_js.mjs')) {
  process.exitCode = main(process.argv.slice(2))
}

export { main, parseJsonRaw, plain }
