/**
 * Share-by-URL. A scenario is a link.
 *
 * Only the values that differ from the defaults are encoded, so the common
 * case is a short hash and the link keeps working when a default changes.
 * The payload is base64url of the JSON diff under a versioned key:
 *
 *   #c1=eyJzdHJhdGVneSI6IndpbG1hIn0
 */
import { configDiff } from '../state/configReducer.js'

const KEY = 'c1'

/* -------------------------------------------------------- base64url utils */

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  bytes.forEach((b) => {
    binary += String.fromCharCode(b)
  })
  const b64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(text, 'utf8').toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(payload) {
  const b64 = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (payload.length % 4)) % 4)
  if (typeof atob === 'function') {
    const binary = atob(b64)
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  }
  return Buffer.from(b64, 'base64').toString('utf8')
}

/* ------------------------------------------------------------- public api */

/** Config -> hash fragment body, e.g. `c1=…`. Empty string when config is all defaults. */
export function encodeConfig(config, defaults) {
  const diff = configDiff(config, defaults)
  if (Object.keys(diff).length === 0) return ''
  return `${KEY}=${toBase64Url(JSON.stringify(diff))}`
}

/** Hash fragment (with or without leading '#') -> partial config, or null. */
export function decodeConfig(hash) {
  if (!hash) return null
  const body = String(hash).replace(/^#/, '')
  if (!body) return null
  const params = new URLSearchParams(body)
  const payload = params.get(KEY)
  if (!payload) return null
  try {
    const parsed = JSON.parse(fromBase64Url(payload))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Full shareable URL for a config. */
export function shareUrl(config, defaults, href) {
  const base = (href || (typeof window !== 'undefined' ? window.location.href : '')).split('#')[0]
  const frag = encodeConfig(config, defaults)
  return frag ? `${base}#${frag}` : base
}

/** Push the config into the address bar without adding a history entry. */
export function syncHash(config, defaults) {
  if (typeof window === 'undefined' || !window.history) return
  try {
    const frag = encodeConfig(config, defaults)
    const url = window.location.pathname + window.location.search + (frag ? `#${frag}` : '')
    window.history.replaceState(null, '', url)
  } catch {
    /* history is unavailable in some sandboxes; sharing simply degrades */
  }
}

/** Read the config the page was opened with, if any. */
export function readHashConfig() {
  if (typeof window === 'undefined') return null
  try {
    return decodeConfig(window.location.hash)
  } catch {
    return null
  }
}
