import { useState } from 'preact/hooks'

import { AccountId } from 'polkadot-api'

import './styles.css'

function isValidSS58(addr: string): boolean {
  try {
    AccountId().enc(addr)
    return true
  } catch {
    return false
  }
}

interface ContactEntry {
  address: string
}

interface ContactsManagerProps {
  contacts: ContactEntry[]
  visible: boolean
  onAdd: (address: string) => void
  onRemove: (address: string) => void
  onDismiss: () => void
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function ContactsManager({
  contacts,
  visible,
  onAdd,
  onRemove,
  onDismiss
}: ContactsManagerProps) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')

  function handleAdd() {
    const trimmed = input.trim()
    if (!trimmed) return

    if (!isValidSS58(trimmed)) {
      setError('Invalid address')
      return
    }
    if (contacts.some((contact) => contact.address === trimmed)) {
      setError('Already added')
      return
    }
    onAdd(trimmed)
    setInput('')
    setError('')
  }

  return (
    <div class={`contacts-manager${visible ? ' contacts-manager--visible' : ''}`}>
      <div class='contacts-manager__header'>
        <span class='contacts-manager__title'>Following</span>
        <button class='contacts-manager__close' onClick={onDismiss}>
          ✕
        </button>
      </div>

      <div class='contacts-manager__input-row'>
        <input
          class={`contacts-manager__input${
            input.trim()
              ? isValidSS58(input.trim())
                ? ' contacts-manager__input--valid'
                : ' contacts-manager__input--invalid'
              : ''
          }`}
          type='text'
          placeholder='5FLSig…S59Y'
          value={input}
          onInput={(e) => {
            setInput((e.target as HTMLInputElement).value)
            setError('')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAdd()
            }
          }}
        />
        <button class='contacts-manager__add-btn' onClick={handleAdd}>
          Add
        </button>
      </div>

      {error && <p class='contacts-manager__error'>{error}</p>}

      <div class='contacts-manager__list'>
        {contacts.map((contact) => (
          <div key={contact.address} class='contacts-manager__item'>
            <div class='contacts-manager__item-info'>
              <span class='contacts-manager__addr'>{truncateAddress(contact.address)}</span>
            </div>
            <button class='contacts-manager__remove' onClick={() => onRemove(contact.address)}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export type { ContactEntry }
