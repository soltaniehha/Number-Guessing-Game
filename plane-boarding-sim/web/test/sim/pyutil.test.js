/**
 * The Python-semantics helpers.
 *
 * Every one of these exists because a JavaScript operator disagrees with its
 * Python spelling in a way that would silently change a simulation result.
 * Expected values below are what CPython 3 actually returns.
 */
import { describe, expect, it } from 'vitest'
import {
  bisectLeft,
  floorDiv,
  minByTuple,
  pyMod,
  pyRound,
  pyRoundInt,
  pySum,
  removeFirst,
  sortByKey,
  sortByTuple,
  tupleLess,
} from '../../src/sim/pyutil.js'

describe('floorDiv', () => {
  it('floors toward negative infinity, unlike Math.trunc and | 0', () => {
    expect(floorDiv(7, 2)).toBe(3)
    expect(floorDiv(-7, 2)).toBe(-4) // Math.trunc(-3.5) === -3, and -7/2|0 === -3
    expect(floorDiv(-1, 3)).toBe(-1)
    expect(floorDiv(0, 5)).toBe(0)
    expect(Math.trunc(-7 / 2)).not.toBe(floorDiv(-7, 2))
  })

  it('matches the band arithmetic the strategies rely on', () => {
    // _bands: (n * b // z, n * (b + 1) // z) over 31 rows, 4 zones
    const n = 31
    const z = 4
    const got = [0, 1, 2, 3].map((b) => [floorDiv(n * b, z), floorDiv(n * (b + 1), z)])
    expect(got).toEqual([[0, 7], [7, 15], [15, 23], [23, 31]])
  })
})

describe('pyMod', () => {
  it('takes the sign of the divisor, unlike JS %', () => {
    expect(pyMod(7, 3)).toBe(1)
    expect(pyMod(-7, 3)).toBe(2) // JS: -7 % 3 === -1
    expect(pyMod(-1, 2)).toBe(1)
    expect(-7 % 3).toBe(-1)
  })
})

describe('pyRound', () => {
  it('rounds half to even at zero decimals, unlike Math.round', () => {
    expect(pyRoundInt(0.5)).toBe(0) // Math.round -> 1
    expect(pyRoundInt(1.5)).toBe(2)
    expect(pyRoundInt(2.5)).toBe(2) // Math.round -> 3
    expect(pyRoundInt(3.5)).toBe(4)
    expect(pyRoundInt(-0.5)).toBe(-0) // Math.round -> -0 too, but by luck
    expect(pyRoundInt(-1.5)).toBe(-2) // Math.round -> -1
    expect(pyRoundInt(-2.5)).toBe(-2) // Math.round -> -2
    expect(Math.round(2.5)).not.toBe(pyRoundInt(2.5))
  })

  it('rounds half to even at N decimals', () => {
    expect(pyRound(0.125, 2)).toBe(0.12) // exactly representable tie -> even
    expect(pyRound(0.375, 2)).toBe(0.38)
    expect(pyRound(2.675, 2)).toBe(2.67) // the classic: 2.675 is really 2.67499...
    expect(pyRound(1.005, 2)).toBe(1.0) // really 1.00499...
    expect(pyRound(-0.125, 2)).toBe(-0.12)
  })

  it('is exact on values that are not ties', () => {
    expect(pyRound(432.79999999999995, 6)).toBe(432.8)
    expect(pyRound(1 / 3, 9)).toBe(0.333333333)
    expect(pyRound(2 / 3, 9)).toBe(0.666666667)
    expect(pyRound(123.4567894999, 6)).toBe(123.456789)
    expect(pyRound(123.4567895001, 6)).toBe(123.45679)
  })

  it('leaves zero, the sign of zero and non-finite values alone', () => {
    expect(pyRound(0, 6)).toBe(0)
    expect(Object.is(pyRound(-0, 6), -0)).toBe(true)
    expect(pyRound(Infinity, 6)).toBe(Infinity)
    expect(Number.isNaN(pyRound(NaN, 6))).toBe(true)
  })

  it('decides round(loadFactor * seats) the way the passenger count needs', () => {
    // A half value here changes the manifest size, so it is worth pinning.
    expect(pyRoundInt(0.5 * 186)).toBe(93)
    expect(pyRoundInt(0.5 * 76)).toBe(38)
    expect(pyRoundInt(0.855 * 130)).toBe(111)
    // 0.25 * 130 = 32.5 exactly -> half to even -> 32, where Math.round gives 33
    expect(pyRoundInt(0.25 * 130)).toBe(32)
    expect(Math.round(0.25 * 130)).toBe(33)
  })
})

describe('bisectLeft', () => {
  it('returns the leftmost insertion point', () => {
    const a = [1, 3, 3, 5]
    expect(bisectLeft(a, 0)).toBe(0)
    expect(bisectLeft(a, 1)).toBe(0)
    expect(bisectLeft(a, 3)).toBe(1)
    expect(bisectLeft(a, 4)).toBe(3)
    expect(bisectLeft(a, 9)).toBe(4)
    expect(bisectLeft([], 1)).toBe(0)
  })
})

describe('sortByKey', () => {
  it('is stable, so equal keys keep their original order', () => {
    const items = [['a', 1], ['b', 0], ['c', 1], ['d', 0]]
    sortByKey(items, (t) => t[1])
    expect(items.map((t) => t[0])).toEqual(['b', 'd', 'a', 'c'])
  })

  it('keeps the ORIGINAL order among ties when reversed, as Python does', () => {
    // CPython's reverse=True reverses, sorts ascending stably, reverses back --
    // so ties are NOT flipped. A naive descending comparator on an unstable
    // sort would be free to flip them.
    const items = [['a', 1], ['b', 0], ['c', 1], ['d', 0]]
    sortByKey(items, (t) => t[1], true)
    expect(items.map((t) => t[0])).toEqual(['a', 'c', 'b', 'd'])
  })

  it('evaluates the key exactly once per element', () => {
    const seen = []
    sortByKey([3, 1, 2], (v) => {
      seen.push(v)
      return v
    })
    expect(seen.slice().sort()).toEqual([1, 2, 3])
    expect(seen).toHaveLength(3)
  })
})

describe('sortByTuple and tupleLess', () => {
  it('compares element by element, in order', () => {
    expect(tupleLess([1, 5], [2, 0])).toBe(true)
    expect(tupleLess([2, 0], [2, 1])).toBe(true)
    expect(tupleLess([2, 1], [2, 1])).toBe(false)
    const items = [[2, 'b'], [1, 'z'], [2, 'a']]
    sortByTuple(items, (t) => t)
    expect(items).toEqual([[1, 'z'], [2, 'a'], [2, 'b']])
  })
})

describe('minByTuple', () => {
  it('returns the FIRST element holding the minimum, as Python min does', () => {
    const items = [{ id: 'x', k: 2 }, { id: 'y', k: 1 }, { id: 'z', k: 1 }]
    expect(minByTuple(items, (o) => [o.k]).id).toBe('y')
  })
})

describe('removeFirst', () => {
  it('drops only the first identical element', () => {
    const a = { n: 1 }
    const b = { n: 1 }
    const arr = [a, b, a]
    removeFirst(arr, a)
    expect(arr).toEqual([b, a])
  })
})

describe('pySum', () => {
  it('adds left to right, which is not the same as any other order', () => {
    expect(pySum([1e16, 1, -1e16])).toBe(0) // (1e16 + 1) - 1e16 loses the 1
    expect(pySum([1e16, -1e16, 1])).toBe(1) // same three terms, different answer
  })
})

describe('integer-keyed JSON maps', () => {
  it('are iterated in ascending numeric order by JS, which is why config sorts explicitly', () => {
    // defaults.json has {"0":..,"1":..,"2":..} maps. JS puts integer-like keys
    // first, in ascending numeric order, whatever the source order -- so the
    // engine sorts them itself rather than depending on that rule.
    const obj = JSON.parse('{"2":0.2,"0":0.5,"1":0.3}')
    expect(Object.keys(obj)).toEqual(['0', '1', '2'])
    const sorted = Object.keys(obj).map(Number).sort((a, b) => a - b)
    expect(sorted).toEqual([0, 1, 2])
  })

  it('preserves insertion order for non-integer keys, which eliteMix relies on', () => {
    const obj = JSON.parse('{"elite_top":1,"cardholder":2,"basic":3}')
    expect(Object.keys(obj)).toEqual(['elite_top', 'cardholder', 'basic'])
  })
})
