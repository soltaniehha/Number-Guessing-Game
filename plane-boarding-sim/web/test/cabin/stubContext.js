/**
 * A recording stand-in for CanvasRenderingContext2D.
 *
 * jsdom has no canvas backend, so the draw smoke tests run the real painting
 * code against this instead: it accepts every call the renderer makes, records
 * them, and screams if a coordinate ever comes out NaN — which is the failure
 * mode that actually matters for geometry code.
 */

const METHODS = [
  'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo',
  'quadraticCurveTo', 'bezierCurveTo', 'arc', 'arcTo', 'rect', 'roundRect',
  'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect',
  'setTransform', 'transform', 'translate', 'scale', 'rotate', 'fillText',
  'strokeText', 'setLineDash', 'createLinearGradient',
]

export function makeStubContext() {
  const calls = []
  const bad = []
  const ctx = {
    calls,
    bad,
    canvas: { width: 0, height: 0 },
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    fillStyle: '',
    strokeStyle: '',
    measureText: (text) => ({ width: String(text).length * 6 }),
  }
  for (const name of METHODS) {
    ctx[name] = (...args) => {
      for (const arg of args) {
        if (typeof arg === 'number' && !Number.isFinite(arg)) {
          bad.push({ name, args })
          break
        }
      }
      calls.push({ name, args })
      return name === 'createLinearGradient'
        ? { addColorStop() {} }
        : undefined
    }
  }
  return ctx
}

/** Every call of a given name. */
export function callsOf(ctx, name) {
  return ctx.calls.filter((c) => c.name === name)
}
