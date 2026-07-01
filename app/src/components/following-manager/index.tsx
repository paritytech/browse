import { useEffect, useRef, useState } from 'preact/hooks'

import { X } from 'lucide-preact'
import { AccountId } from 'polkadot-api'

import { searchUsernames, type UsernameEntry } from '../../lib/usernames'
import { type FollowedAccount } from '../../state/following/api'
import { avatarBg } from '../identicon'
import './styles.css'

function isValidSS58(addr: string): boolean {
  try {
    AccountId().enc(addr)
    return true
  } catch {
    return false
  }
}

interface FollowingManagerProps {
  following: FollowedAccount[]
  visible: boolean
  onAdd: (address: string, username?: string) => void
  onRemove: (address: string) => void
  onDismiss: () => void
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function accountLabel(account: FollowedAccount): string {
  return account.username ? `@${account.username}` : truncateAddress(account.address)
}

export function FollowingManager({
  following,
  visible,
  onAdd,
  onRemove,
  onDismiss
}: FollowingManagerProps) {
  const [input, setInput] = useState('')
  const [result, setResult] = useState<UsernameEntry | null>(null)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const trimmed = input.trim()
  const query = trimmed.replace(/^@/, '')
  const ss58 = isValidSS58(trimmed)
  const isFollowing = (address: string) => following.some((a) => a.address === address)

  // Reset when the modal closes, not when it opens: clearing on open races with
  // the user (or a test) typing right after it becomes visible and would wipe
  // the field.
  useEffect(() => {
    if (!visible) {
      setInput('')
      setResult(null)
      setSearching(false)
      return
    }
    // Drop the caret into the field once the open transition starts.
    const id = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(id)
  }, [visible])

  // Resolve as the user types (debounced). The People-chain lookup is exact, so
  // a result appears once the full username is typed.
  useEffect(() => {
    if (!query || ss58) {
      setResult(null)
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const id = setTimeout(async () => {
      try {
        const [match] = await searchUsernames(query)
        if (!cancelled) setResult(match ?? null)
      } catch {
        if (!cancelled) setResult(null)
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [query, ss58])

  function follow(address: string, username?: string) {
    if (isFollowing(address)) return
    onAdd(address, username)
    setInput('')
    setResult(null)
  }

  function commit() {
    if (result) follow(result.account, result.username)
    else if (ss58) follow(trimmed)
  }

  const searchMode = trimmed.length > 0

  return (
    <div
      class={`following-modal-overlay${visible ? ' following-modal-overlay--visible' : ''}`}
      onClick={onDismiss}
    >
      <div class='following-modal' onClick={(e) => e.stopPropagation()}>
        <div class='following-modal__header'>
          <span class='following-modal__title'>Following</span>
          <button class='following-modal__close' onClick={onDismiss} aria-label='Close'>
            <X size={22} />
          </button>
        </div>

        <div class='following-modal__body'>
          <div class='following-modal__input-row'>
            <div class='following-modal__field'>
              <span class='following-modal__at'>@</span>
              <input
                ref={inputRef}
                class='following-modal__input'
                type='text'
                autocomplete='off'
                spellcheck={false}
                placeholder='username'
                value={input}
                onInput={(e) => setInput((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commit()
                  } else if (e.key === 'Backspace' && input === '' && following.length > 0) {
                    // Pull the last-followed username back into the field so it can
                    // be edited rather than dropped outright.
                    const last = following[following.length - 1]
                    onRemove(last.address)
                    setInput(last.username ?? last.address)
                  } else if (e.key === 'Escape') {
                    onDismiss()
                  }
                }}
              />
            </div>
          </div>

          {searchMode ? (
            <div class='following-modal__results'>
              {ss58 ? (
                isFollowing(trimmed) ? (
                  <p class='following-modal__state'>You already follow this address</p>
                ) : (
                  <button
                    type='button'
                    class='following-modal__option'
                    onClick={() => follow(trimmed)}
                  >
                    <span
                      class='following-modal__avatar'
                      style={{ backgroundColor: avatarBg(trimmed) }}
                    >
                      {trimmed.charAt(0).toUpperCase()}
                    </span>
                    <span class='following-modal__row-label'>{truncateAddress(trimmed)}</span>
                  </button>
                )
              ) : searching ? (
                <p class='following-modal__state'>Searching…</p>
              ) : result ? (
                isFollowing(result.account) ? (
                  <p class='following-modal__state'>You already follow @{result.username}</p>
                ) : (
                  <button
                    type='button'
                    class='following-modal__option'
                    onClick={() => follow(result.account, result.username)}
                  >
                    <span
                      class='following-modal__avatar'
                      style={{ backgroundColor: avatarBg(result.username) }}
                    >
                      {result.username.charAt(0).toUpperCase()}
                    </span>
                    <span class='following-modal__row-label'>{result.username}</span>
                  </button>
                )
              ) : (
                <p class='following-modal__state'>No results for “{query}”</p>
              )}
            </div>
          ) : (
            following.length > 0 && (
              <div class='following-modal__following'>
                {following.map((account) => (
                  <div key={account.address} class='following-modal__row'>
                    <span
                      class='following-modal__avatar'
                      style={{ backgroundColor: avatarBg(account.username ?? account.address) }}
                    >
                      {(account.username ?? account.address).charAt(0).toUpperCase()}
                    </span>
                    <span class='following-modal__row-label'>{accountLabel(account)}</span>
                    <button
                      type='button'
                      class='following-modal__unfollow'
                      onClick={() => onRemove(account.address)}
                    >
                      Unfollow
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
