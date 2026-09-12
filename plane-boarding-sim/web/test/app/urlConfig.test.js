import { describe, expect, it } from 'vitest'
import { encodeConfig, decodeConfig, shareUrl } from '../../src/lib/urlConfig.js'
import { makeConfigReducer } from '../../src/state/configReducer.js'
import { defaults, a320 } from './fixtures.js'

const reducer = makeConfigReducer(defaults)

describe('url encoding', () => {
  it('encodes nothing when the config is all defaults', () => {
    expect(encodeConfig(defaults, defaults)).toBe('')
    expect(shareUrl(defaults, defaults, 'https://x.test/lab')).toBe('https://x.test/lab')
  })

  it('round-trips a changed config through the hash', () => {
    let config = defaults
    config = reducer(config, { type: 'SET_FIELD', field: 'strategy', value: 'steffen_modified', aircraft: a320 })
    config = reducer(config, { type: 'SET_FIELD', field: 'loadFactor', value: 0.77, aircraft: a320 })
    config = reducer(config, { type: 'TOGGLE_DOOR', doorId: '2L', aircraft: a320 })

    const hash = encodeConfig(config, defaults)
    const decoded = decodeConfig(`#${hash}`)
    const restored = reducer(defaults, { type: 'LOAD_CONFIG', config: decoded, aircraft: a320 })

    expect(restored).toEqual(config)
  })

  it('round-trips nested weight objects and string enums', () => {
    let config = reducer(defaults, {
      type: 'SET_FIELD',
      field: 'bagWeights',
      value: { 0: 0.5, 1: 0.25, 2: 0.25 },
      aircraft: a320,
    })
    // A non-default enum, so it actually appears in the encoded diff.
    config = reducer(config, { type: 'SET_FIELD', field: 'openSeatingPolicy', value: 'window_first', aircraft: a320 })

    const decoded = decodeConfig(`#${encodeConfig(config, defaults)}`)
    expect(decoded.bagWeights).toEqual({ 0: 0.5, 1: 0.25, 2: 0.25 })
    expect(decoded.openSeatingPolicy).toBe('window_first')
    expect(reducer(defaults, { type: 'LOAD_CONFIG', config: decoded, aircraft: a320 })).toEqual(config)
  })

  it('encodes only the non-default keys', () => {
    const config = reducer(defaults, { type: 'SET_FIELD', field: 'seed', value: 999, aircraft: a320 })
    expect(decodeConfig(`#${encodeConfig(config, defaults)}`)).toEqual({ seed: 999 })
  })

  it('survives a hash with other parameters in it', () => {
    const config = reducer(defaults, { type: 'SET_FIELD', field: 'seed', value: 5, aircraft: a320 })
    const hash = `#other=1&${encodeConfig(config, defaults)}&z=2`
    expect(decodeConfig(hash)).toEqual({ seed: 5 })
  })

  it('returns null for junk rather than throwing', () => {
    expect(decodeConfig('')).toBeNull()
    expect(decodeConfig('#')).toBeNull()
    expect(decodeConfig('#c1=not-base64!!')).toBeNull()
    expect(decodeConfig('#nothingHere=1')).toBeNull()
    expect(decodeConfig(null)).toBeNull()
  })

  it('builds a full shareable url', () => {
    const config = reducer(defaults, { type: 'SET_FIELD', field: 'seed', value: 1, aircraft: a320 })
    const url = shareUrl(config, defaults, 'https://x.test/lab#old')
    expect(url.startsWith('https://x.test/lab#c1=')).toBe(true)
    expect(decodeConfig(url.split('#')[1])).toEqual({ seed: 1 })
  })
})
