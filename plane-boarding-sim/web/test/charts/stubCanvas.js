/**
 * A recording stand-in for the 2-D context the congestion heatmap paints on.
 *
 * jsdom has no canvas backend: `getContext('2d')` returns null *and* logs a
 * "not implemented" error for every chart that mounts one. Installing this
 * keeps the test output readable, and lets a test assert what was actually
 * painted (`fillRect` calls, `fillStyle` values, backing-store size).
 */
export function makeStubContext() {
  const calls = []
  const fills = []
  const ctx = {
    calls,
    fills,
    fillStyle: '',
    setTransform: (...args) => calls.push({ name: 'setTransform', args }),
    clearRect: (...args) => calls.push({ name: 'clearRect', args }),
    fillRect: (...args) => {
      calls.push({ name: 'fillRect', args })
      fills.push({ style: ctx.fillStyle, args })
    },
  }
  return ctx
}

/**
 * Give every canvas in the document a stub context. Returns a restore
 * function; call it in `afterAll` if the suite needs the original back.
 */
export function installCanvasStub() {
  if (typeof HTMLCanvasElement === 'undefined') return () => {}
  const original = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function getContext() {
    if (!this.__stub) this.__stub = makeStubContext()
    return this.__stub
  }
  return () => {
    HTMLCanvasElement.prototype.getContext = original
  }
}
