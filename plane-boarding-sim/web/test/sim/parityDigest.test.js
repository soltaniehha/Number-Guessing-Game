/**
 * The parity digest emitter (`parity/emit_js.mjs`).
 *
 * `python3 parity/compare.py` is the real gate; these tests pin the contract
 * that gate depends on, so a break shows up here with a useful message instead
 * of as a wall of numeric diffs. Mirrors `python/tests/test_parity_digest.py`.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  canonical,
  digestFor,
  fnv1a32,
  parseJsonRaw,
  plain,
  r9,
  seatedCurve,
} from '../../../parity/emit_js.mjs'

const FIXTURES_PATH = new URL('../../../parity/fixtures.json', import.meta.url)
const raw = parseJsonRaw(readFileSync(FIXTURES_PATH, 'utf-8'))
const fixtures = raw.get('fixtures')

it('the fixture set covers every aircraft and the awkward corners', () => {
  const configs = fixtures.map((f) => plain(f.get('config')))
  const aircraft = new Set(configs.map((c) => c.aircraftId))
  expect(aircraft).toEqual(
    new Set(['e175', 'a320neo', 'b737_max8', 'a220_300', 'b777_300er', 'b787_9']),
  )
  expect(configs.some((c) => c.loadFactor === 0)).toBe(true)
  expect(configs.some((c) => c.loadFactor === 1)).toBe(true)
  expect(configs.some((c) => c.strategy === 'open_seating')).toBe(true)
  expect(fixtures.length).toBeGreaterThanOrEqual(12)
})

describe('fnv1a32', () => {
  it('matches the reference FNV-1a/32 vectors, byte for byte with Python', () => {
    expect(fnv1a32('')).toBe('811c9dc5')
    expect(fnv1a32('a')).toBe('e40c292c')
    expect(fnv1a32('foobar')).toBe('bf9cf968')
  })
})

describe('canonical', () => {
  it('sorts keys and uses Python separators', () => {
    const node = parseJsonRaw('{"b": 2, "a": [1, {"d": 4, "c": 3}]}')
    expect(canonical(node)).toBe('{"a":[1,{"c":3,"d":4}],"b":2}')
  })

  it('keeps Python’s int/float distinction, which the hash depends on', () => {
    // json.dumps writes the float 1.0 as "1.0" and the int 1 as "1". JSON.parse
    // collapses both to the number 1, which would hash differently -- so the
    // emitter parses the fixture text itself and remembers the literal.
    expect(canonical(parseJsonRaw('{"x": 1.0}'))).toBe('{"x":1.0}')
    expect(canonical(parseJsonRaw('{"x": 1}'))).toBe('{"x":1}')
    expect(canonical(parseJsonRaw('{"x": 0.0}'))).toBe('{"x":0.0}')
    expect(canonical(parseJsonRaw('{"x": 0}'))).toBe('{"x":0}')
    expect(canonical(parseJsonRaw('{"x": -0.5}'))).toBe('{"x":-0.5}')
    expect(canonical(parseJsonRaw('{"x": 0.9677419354838709}'))).toBe(
      '{"x":0.9677419354838709}',
    )
  })
})

describe('r9', () => {
  it('rounds to nine places and normalises -0.0', () => {
    expect(r9(1 / 3)).toBe(0.333333333)
    expect(r9(-0.0)).toBe(0)
    expect(Object.is(r9(-0.0), -0)).toBe(false)
    expect(r9(-1e-12)).toBe(0)
    expect(r9(432.8)).toBe(432.8)
  })
})

describe('seatedCurve', () => {
  it('is a 10 s grid that starts at zero and ends holding everybody', () => {
    const curve = seatedCurve([5, 12, 12, 47], 47)
    expect(curve.map((p) => p[0])).toEqual([0, 10, 20, 30, 40, 50])
    expect(curve.map((p) => p[1])).toEqual([0, 1, 3, 3, 3, 4])
  })

  it('handles an empty cabin', () => {
    expect(seatedCurve([], 0)).toEqual([[0, 0], [10, 0]])
  })
})

describe('digestFor', () => {
  it('has the contracted fields and types', () => {
    const d = digestFor(fixtures[0])
    expect(Object.keys(d).sort()).toEqual([
      'aisleBlockEvents',
      'binSearches',
      'config_hash',
      'doors',
      'first20SitTimes',
      'gateChecks',
      'geometry_hash',
      'interference',
      'paxCount',
      'seatCount',
      'seatedCurve',
      'timeBreakdown',
      'totalSeconds',
    ])
    expect(d.config_hash).toMatch(/^[0-9a-f]{8}$/)
    expect(d.geometry_hash).toMatch(/^[0-9a-f]{8}$/)
    expect(Number.isInteger(d.paxCount)).toBe(true)
    expect(Number.isInteger(d.seatCount)).toBe(true)
    expect(Object.keys(d.timeBreakdown)).toEqual(['blocked', 'shuffle', 'stow', 'walk'])
    expect(Object.keys(d.interference)).toEqual(['none', 'one', 'sameParty', 'two'])
    expect(Object.values(d.interference).every(Number.isInteger)).toBe(true)
    expect(d.first20SitTimes.length).toBeLessThanOrEqual(20)
  })

  it('rounds every float to nine places', () => {
    const near = (v) => expect(Math.abs(v * 1e9 - Math.round(v * 1e9))).toBeLessThan(1e-3)
    for (const f of fixtures.slice(0, 5)) {
      const d = digestFor(f)
      near(d.totalSeconds)
      for (const v of Object.values(d.timeBreakdown)) near(v)
      for (const v of d.first20SitTimes) near(v)
    }
  })

  it('is deterministic', () => {
    for (const f of fixtures.slice(0, 4)) {
      expect(digestFor(f)).toEqual(digestFor(f))
    }
  })

  it('hashes the config VALUES, not the key order or the fixture name', () => {
    const make = (name, body) => parseJsonRaw(`{"name": ${JSON.stringify(name)}, "config": ${body}}`)
    const a = make('x', '{"aircraftId":"e175","strategy":"random","seed":1,"loadFactor":0.5}')
    const b = make('renamed', '{"loadFactor":0.5,"seed":1,"strategy":"random","aircraftId":"e175"}')
    const c = make('x', '{"aircraftId":"e175","strategy":"random","seed":2,"loadFactor":0.5}')
    expect(digestFor(a).config_hash).toBe(digestFor(b).config_hash)
    expect(digestFor(a).config_hash).not.toBe(digestFor(c).config_hash)
  })

  it('degrades gracefully on the empty-cabin fixture', () => {
    const f = fixtures.find((x) => plain(x.get('config')).loadFactor === 0)
    const d = digestFor(f)
    expect(d.paxCount).toBe(0)
    expect(d.totalSeconds).toBe(0)
    expect(d.first20SitTimes).toEqual([])
    expect(Object.values(d.interference).reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('emits valid JSON for the whole fixture set', () => {
    const out = {}
    for (const f of fixtures) out[f.get('name')] = digestFor(f)
    expect(JSON.parse(JSON.stringify(out))).toEqual(out)
    expect(Object.keys(out).length).toBeGreaterThanOrEqual(12)
  })
})
