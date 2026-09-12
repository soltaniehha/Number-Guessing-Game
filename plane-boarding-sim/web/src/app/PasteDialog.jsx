import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from './Modal.jsx'
import { useStore } from '../state/StoreProvider.jsx'

/** Paste a config JSON blob back in. Unknown keys are dropped by the reducer. */
export function PasteDialog({ initial }) {
  const { loadConfig, setModal, setToast } = useStore()
  const [text, setText] = useState(initial || '')
  const [error, setError] = useState(null)
  const touched = useRef(false)

  // The clipboard prefill, if it arrives at all, arrives after the dialog is
  // already on screen (see PresetSection). Adopt it — unless the user has
  // started typing, in which case what they typed wins.
  useEffect(() => {
    if (!touched.current && typeof initial === 'string' && initial) setText(initial)
  }, [initial])

  // Stable, so the dialog's key listener is not town down and rebuilt on every
  // keystroke. See app/focusTrap.js.
  const close = useCallback(() => setModal(null), [setModal])

  const load = () => {
    try {
      const parsed = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object')
      loadConfig(parsed)
      setModal(null)
      setToast({ kind: 'ok', text: 'Config loaded' })
    } catch (err) {
      setError(err.message || 'That is not valid JSON')
    }
  }

  return (
    <Modal
      title="Load a config"
      onClose={close}
      footer={
        <>
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn btn--run" onClick={load} disabled={!text.trim()}>
            Load config
          </button>
        </>
      }
    >
      <p className="field__help">
        Paste a config JSON object. Anything the engine does not recognise is ignored, and missing values fall back to
        the defaults.
      </p>
      <textarea
        className="input input--area num"
        data-autofocus
        rows={12}
        spellCheck={false}
        value={text}
        aria-label="Config JSON"
        placeholder='{ "strategy": "wilma", "loadFactor": 0.95 }'
        onChange={(e) => {
          touched.current = true
          setText(e.target.value)
          setError(null)
        }}
      />
      {error && <p className="alert alert--bad">{error}</p>}
    </Modal>
  )
}
