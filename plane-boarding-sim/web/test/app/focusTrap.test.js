// @vitest-environment jsdom
/**
 * The focus-trap primitives. The browser-level behaviour is verified with
 * Playwright; these pin the two bugs that made the trap leak.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { focusableIn, initialFocusIn } from '../../src/app/focusTrap.js'

beforeEach(() => {
  document.body.innerHTML = ''
})

const dialog = (html) => {
  const node = document.createElement('div')
  node.innerHTML = html
  document.body.appendChild(node)
  return node
}

describe('focusableIn', () => {
  it('skips disabled elements, so the last focusable really is focusable', () => {
    const node = dialog(`
      <textarea id="a"></textarea>
      <button id="b">Cancel</button>
      <button id="c" disabled>Load config</button>
    `)
    const ids = focusableIn(node).map((el) => el.id)
    expect(ids).toEqual(['a', 'b'])
    // The old querySelectorAll made #c the wrap-around target: focus reached
    // it, could not land, and walked out of the dialog into the page behind.
    expect(ids[ids.length - 1]).toBe('b')
  })

  it('skips elements taken out of the tab order by a roving tabindex', () => {
    const node = dialog(`
      <button id="a" tabindex="0" role="radio">one</button>
      <button id="b" tabindex="-1" role="radio">two</button>
    `)
    expect(focusableIn(node).map((el) => el.id)).toEqual(['a'])
  })

  it('skips anything inside an inert subtree', () => {
    const node = dialog('<div inert><button id="a">no</button></div><button id="b">yes</button>')
    expect(focusableIn(node).map((el) => el.id)).toEqual(['b'])
  })
})

describe('initialFocusIn', () => {
  it('honours data-autofocus even when a button comes first in the document', () => {
    const node = dialog(`
      <button id="close">Close</button>
      <textarea id="json" data-autofocus></textarea>
    `)
    // querySelector('[data-autofocus], button, textarea') returns the first
    // element matching ANY of the selectors in document order — the Close
    // button — which is how the marked element was being ignored.
    expect(node.querySelector('[data-autofocus], button, textarea').id).toBe('close')
    expect(initialFocusIn(node).id).toBe('json')
  })

  it('falls back to the first focusable element when nothing is marked', () => {
    const node = dialog('<button id="close">Close</button><textarea id="json"></textarea>')
    expect(initialFocusIn(node).id).toBe('close')
  })

  it('returns null for an empty dialog rather than throwing', () => {
    expect(initialFocusIn(dialog('<p>nothing here</p>'))).toBeNull()
    expect(initialFocusIn(null)).toBeNull()
  })
})
