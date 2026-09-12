import { useState } from 'react'
import { Modal } from './Modal.jsx'
import { useStore } from '../state/StoreProvider.jsx'

/** Paste a config JSON blob back in. Unknown keys are dropped by the reducer. */
export function PasteDialog({ initial }) {
  const { loadConfig, setModal, setToast } = useStore()
  const [text, setText] = useState(initial || '')
  const [error, setError] = useState(null)

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
      onClose={() => setModal(null)}
      footer={
        <>
          <button type="button" className="btn" onClick={() => setModal(null)}>
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
          setText(e.target.value)
          setError(null)
        }}
      />
      {error && <p className="alert alert--bad">{error}</p>}
    </Modal>
  )
}
