import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import {
  fetchUsernames,
  resolveUsername,
  searchUsernames,
  type UsernameEntry
} from '../../lib/usernames'
import './styles.css'

const SS58_RE = /^[1-9A-HJ-NP-Za-km-z]{46,48}$/

interface ContactEntry {
  address: string
  username?: string
}

interface ContactsManagerProps {
  contacts: ContactEntry[]
  visible: boolean
  onAdd: (address: string, username?: string) => void
  onRemove: (address: string) => void
  onDismiss: () => void
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`
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
  const [usernames, setUsernames] = useState<UsernameEntry[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (visible) {
      fetchUsernames().then(setUsernames)
    }
  }, [visible])

  const suggestions = useMemo(() => {
    if (!input.trim()) return []
    const contactAddresses = new Set(contacts.map((c) => c.address))
    return searchUsernames(usernames, input).filter((u) => !contactAddresses.has(u.account))
  }, [input, usernames, contacts])

  function handleAdd() {
    const trimmed = input.trim()
    if (!trimmed) return

    // Try as username first
    const resolved = resolveUsername(usernames, trimmed)
    if (resolved) {
      if (contacts.some((c) => c.address === resolved)) {
        setError('Already added')
        return
      }
      onAdd(resolved, trimmed)
      setInput('')
      setError('')
      setShowDropdown(false)
      return
    }

    // Try as SS58 address
    if (SS58_RE.test(trimmed)) {
      if (contacts.some((c) => c.address === trimmed)) {
        setError('Already added')
        return
      }
      onAdd(trimmed)
      setInput('')
      setError('')
      setShowDropdown(false)
      return
    }

    setError('Username not found')
  }

  function handleSelectSuggestion(entry: UsernameEntry) {
    if (contacts.some((c) => c.address === entry.account)) {
      setError('Already added')
      return
    }
    onAdd(entry.account, entry.username)
    setInput('')
    setError('')
    setShowDropdown(false)
    inputRef.current?.focus()
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
          class='contacts-manager__input'
          type='text'
          placeholder='Username or address'
          value={input}
          onInput={(e) => {
            const val = (e.target as HTMLInputElement).value
            setInput(val)
            setError('')
            setShowDropdown(val.trim().length > 0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAdd()
            }
            if (e.key === 'Escape') {
              setShowDropdown(false)
            }
          }}
          onFocus={() => {
            if (input.trim().length > 0) setShowDropdown(true)
          }}
          onBlur={() => {
            setTimeout(() => setShowDropdown(false), 200)
          }}
        />
        <button class='contacts-manager__add-btn' onClick={handleAdd}>
          Add
        </button>
      </div>

      {showDropdown && suggestions.length > 0 && (
        <div class='contacts-manager__dropdown'>
          {suggestions.map((s) => (
            <button
              key={s.account}
              class='contacts-manager__suggestion'
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelectSuggestion(s)}
            >
              <span class='contacts-manager__suggestion-name'>@{s.username}</span>
              <span class='contacts-manager__suggestion-addr'>{truncateAddress(s.account)}</span>
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

export type { ContactEntry }
