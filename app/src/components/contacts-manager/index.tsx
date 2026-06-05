import { useEffect, useRef, useState } from 'preact/hooks'

import { AccountId } from 'polkadot-api'

import { resolveUsername, searchUsernames, type UsernameEntry } from '../../lib/usernames'
import { type ContactEntry } from '../../state/contacts/api'
import './styles.css'

function isValidSS58(addr: string): boolean {
  try {
    AccountId().enc(addr)
    return true
  } catch {
    return false
  }
}

interface ContactsManagerProps {
  contacts: ContactEntry[]
  visible: boolean
  onAdd: (address: string, username?: string) => void
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
  const [matches, setMatches] = useState<UsernameEntry[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const trimmed = input.trim()

  useEffect(() => {
    if (!trimmed) {
      setMatches([])
      return
    }
    let cancelled = false
    const id = setTimeout(async () => {
      const results = await searchUsernames(trimmed)
      if (cancelled) return
      const taken = new Set(contacts.map((contact) => contact.address))
      setMatches(results.filter((entry) => !taken.has(entry.account)))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [trimmed, contacts])

  function addEntry(address: string, username?: string) {
    if (contacts.some((contact) => contact.address === address)) {
      setError('Already added')
      return
    }
    onAdd(address, username)
    setInput('')
    setError('')
    setShowDropdown(false)
  }

  async function handleAdd() {
    if (!trimmed) return

    const match = matches.find((entry) => entry.username.toLowerCase() === trimmed.toLowerCase())
    if (match) {
      addEntry(match.account, match.username)
      return
    }
    if (isValidSS58(trimmed)) {
      addEntry(trimmed)
      return
    }
    const resolved = await resolveUsername(trimmed)
    if (resolved) {
      addEntry(resolved, trimmed)
      return
    }
    setError('Username not found')
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
          ref={inputRef}
          class={`contacts-manager__input${
            trimmed && isValidSS58(trimmed) ? ' contacts-manager__input--valid' : ''
          }`}
          type='text'
          placeholder='Type username'
          value={input}
          onInput={(e) => {
            const value = (e.target as HTMLInputElement).value
            setInput(value)
            setError('')
            setShowDropdown(value.trim().length > 0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAdd()
            }
            if (e.key === 'Escape') setShowDropdown(false)
          }}
          onFocus={() => {
            if (trimmed.length > 0) setShowDropdown(true)
          }}
          onBlur={() => {
            setTimeout(() => setShowDropdown(false), 200)
          }}
        />
        <button class='contacts-manager__add-btn' onClick={handleAdd}>
          Add
        </button>
      </div>

      {showDropdown && matches.length > 0 && (
        <div class='contacts-manager__dropdown'>
          {matches.map((entry) => (
            <button
              key={entry.account}
              class='contacts-manager__match'
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addEntry(entry.account, entry.username)}
            >
              <span class='contacts-manager__match-name'>@{entry.username}</span>
              <span class='contacts-manager__match-addr'>{truncateAddress(entry.account)}</span>
            </button>
          ))}
        </div>
      )}

      {error && <p class='contacts-manager__error'>{error}</p>}

      <div class='contacts-manager__list'>
        {contacts.map((contact) => (
          <div key={contact.address} class='contacts-manager__item'>
            <div class='contacts-manager__item-info'>
              {contact.username ? (
                <span class='contacts-manager__username'>@{contact.username}</span>
              ) : (
                <span class='contacts-manager__addr'>{truncateAddress(contact.address)}</span>
              )}
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
