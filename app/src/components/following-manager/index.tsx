import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { X } from 'lucide-preact'
import { AccountId } from 'polkadot-api'

import { MIN_PREFIX_LENGTH, useUsernameSuggestions } from '../../lib/usernames-snapshot'
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
  /** Render just the body, for embedding inside the settings modal tab. */
  embedded?: boolean
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
  onDismiss,
  embedded = false
}: FollowingManagerProps) {
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const trimmed = input.trim()
  const ss58 = isValidSS58(trimmed)
  const query = trimmed.replace(/^@/, '').toLowerCase()
  const isFollowing = (address: string) => following.some((a) => a.address === address)

  // Debounce the suggestion prefix ~150ms behind the query so rapid typing
  // doesn't spin up a react-query observer and shard scan per keystroke.
  // `useDeferredValue` is a no-op under Preact, so debounce explicitly, the same
  // way App.tsx does for the domain suggestions.
  const [suggestionPrefix, setSuggestionPrefix] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setSuggestionPrefix(query), 150)
    return () => clearTimeout(id)
  }, [query])

  // Reset when the modal closes, not when it opens: clearing on open races with
  // someone typing right after it becomes visible and would wipe the field.
  useEffect(() => {
    if (!visible) {
      setInput('')
      return
    }
    // Drop the caret into the field once the open transition starts.
    // `preventScroll` stops the browser scrolling an ancestor to reveal the
    // input, which would shift the customize popover slide track sideways.
    const id = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50)
    return () => clearTimeout(id)
  }, [visible])

  // Prefix autocomplete from the verifiable username snapshot, mirroring the
  // domain search bar. A raw SS58 paste is handled directly below instead.
  const { data: suggestions = [], isFetching } = useUsernameSuggestions(
    ss58 ? '' : suggestionPrefix
  )
  const results = useMemo(
    () => suggestions.filter((entry) => !isFollowing(entry.account)),
    [suggestions, following]
  )
  // The debounced prefix trailing the query, or a fetch in flight, both mean a
  // result is still pending, so hold the "No results" state until it settles.
  const searching = isFetching || suggestionPrefix !== query

  function follow(address: string, username?: string) {
    if (isFollowing(address)) return
    onAdd(address, username)
    setInput('')
  }

  function commit() {
    const first = results[0]
    if (first) follow(first.account, first.username)
    else if (ss58) follow(trimmed)
  }

  // A raw SS58 paste follows directly. A username prefix only resolves once it
  // reaches the snapshot shard-key length, so shorter input shows the list.
  const showResults = ss58 || query.length >= MIN_PREFIX_LENGTH

  const body = (
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

      {showResults ? (
        <div class='following-modal__results'>
          {ss58 ? (
            isFollowing(trimmed) ? (
              <p class='following-modal__state'>You already follow this address</p>
            ) : (
              <button type='button' class='following-modal__option' onClick={() => follow(trimmed)}>
                <span
                  class='following-modal__avatar'
                  style={{ backgroundColor: avatarBg(trimmed) }}
                >
                  {trimmed.charAt(0).toUpperCase()}
                </span>
                <span class='following-modal__row-label'>{truncateAddress(trimmed)}</span>
              </button>
            )
          ) : results.length > 0 ? (
            results.map((entry) => (
              <button
                key={entry.account}
                type='button'
                class='following-modal__option'
                onClick={() => follow(entry.account, entry.username)}
              >
                <span
                  class='following-modal__avatar'
                  style={{ backgroundColor: avatarBg(entry.username) }}
                >
                  {entry.username.charAt(0).toUpperCase()}
                </span>
                <span class='following-modal__row-label'>{entry.username}</span>
              </button>
            ))
          ) : searching ? (
            <p class='following-modal__state'>Searching…</p>
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
  )

  if (embedded) return body

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
        {body}
      </div>
    </div>
  )
}
