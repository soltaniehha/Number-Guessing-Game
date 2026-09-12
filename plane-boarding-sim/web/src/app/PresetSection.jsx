/**
 * Presets and config sharing: seven one-click scenarios, reset, copy/paste as
 * JSON, and a shareable URL that carries only the non-default values.
 */
import { useRef } from 'react'
import { useStore } from '../state/StoreProvider.jsx'
import { PRESETS } from './presets.js'
import { configDiff } from '../state/configReducer.js'
import { copyText, readText } from '../lib/clipboard.js'
import { shareUrl } from '../lib/urlConfig.js'

export function PresetSection() {
  const { config, defaults, applyPreset, reset, setToast, setModal } = useStore()
  const afterReset = useRef(null)
  const diff = configDiff(config, defaults)
  const changed = Object.keys(diff).length

  const copyJson = async () => {
    const ok = await copyText(JSON.stringify(config, null, 2))
    setToast(ok ? { kind: 'ok', text: 'Config copied as JSON' } : { kind: 'bad', text: 'Clipboard unavailable' })
  }

  const copyLink = async () => {
    const ok = await copyText(shareUrl(config, defaults))
    setToast(ok ? { kind: 'ok', text: 'Shareable link copied' } : { kind: 'bad', text: 'Clipboard unavailable' })
  }

  /**
   * The dialog opens first, always. Reading the clipboard is a best-effort
   * prefill that happens afterwards: with the default `prompt` permission
   * state the read never settles, and awaiting it made the button look dead.
   */
  const openPaste = () => {
    setModal({ kind: 'paste', initial: '' })
    readText().then((text) => {
      if (typeof text !== 'string' || !text.trim()) return
      setModal((current) => (current?.kind === 'paste' ? { ...current, initial: text } : current))
    })
  }

  /**
   * Reset disables itself the moment it succeeds, and a control that disables
   * itself under the user's finger drops focus to <body>. Hand focus on to the
   * next control in the row before that happens.
   */
  const resetAndMoveFocus = () => {
    afterReset.current?.focus()
    reset()
  }

  return (
    <>
      <div className="presets">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className="preset" onClick={() => applyPreset(p.id)}>
            <span className="preset__name">{p.name}</span>
            <span className="preset__blurb">{p.blurb}</span>
          </button>
        ))}
      </div>

      <div className="share">
        <div className="share__row">
          <button type="button" className="btn" onClick={resetAndMoveFocus} disabled={changed === 0}>
            Reset to defaults
          </button>
          <span className="share__count num">
            {changed === 0 ? 'all defaults' : `${changed} changed`}
          </span>
        </div>
        <div className="share__row">
          <button type="button" className="btn" ref={afterReset} onClick={copyJson}>
            Copy JSON
          </button>
          <button type="button" className="btn" onClick={openPaste}>
            Paste JSON…
          </button>
          <button type="button" className="btn" onClick={copyLink}>
            Copy link
          </button>
        </div>
        <p className="field__help">
          The address bar always holds the current scenario, so a link is a scenario. Only values that differ from
          the defaults are encoded.
        </p>
      </div>
    </>
  )
}
