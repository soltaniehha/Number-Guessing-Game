/** Clipboard helpers that degrade gracefully when the API is unavailable. */

export async function copyText(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}

/**
 * Read the clipboard, or give up.
 *
 * `navigator.clipboard.readText()` does not merely reject when it cannot read:
 * in Chromium's default `prompt` permission state the promise never settles at
 * all, so a `catch` cannot save a caller that awaited it. Anything that waits
 * on the clipboard must therefore wait on a clock too. Never await this before
 * showing UI — open the paste box first and let a prefill arrive if it can.
 *
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<string|null>} the text, or null if it did not arrive in time
 */
export async function readText({ timeoutMs = 1500 } = {}) {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) return null
  let timer
  try {
    const value = await Promise.race([
      navigator.clipboard.readText(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
    return typeof value === 'string' ? value : null
  } catch {
    /* permission denied — the caller already offered a paste box */
    return null
  } finally {
    clearTimeout(timer)
  }
}
