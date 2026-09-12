import { useCallback } from 'react'
import { Modal } from './Modal.jsx'
import { useStore } from '../state/StoreProvider.jsx'

const SHORTCUTS = [
  ['Space', 'Play or pause the replay'],
  ['← / →', 'Step one second back or forward'],
  ['R', 'Rewind to the start'],
  ['1 / 2 / 3', 'Cabin, Analytics, Compare'],
  ['Ctrl or ⌘ + Enter', 'Run'],
  ['Esc', 'Close a dialog'],
]

export function HelpDialog() {
  const { setModal } = useStore()
  // Stable: see the note in app/focusTrap.js.
  const close = useCallback(() => setModal(null), [setModal])
  return (
    <Modal title="Keyboard shortcuts" onClose={close}>
      <dl className="shortcuts">
        {SHORTCUTS.map(([keys, what]) => (
          <div className="shortcuts__row" key={keys}>
            <dt>
              <kbd>{keys}</kbd>
            </dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
      <p className="field__help">Shortcuts are ignored while you are typing in a field.</p>
    </Modal>
  )
}
