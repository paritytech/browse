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
  onAdd: (address: string, username?: string) => void
  onRemove: (address: string) => void
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function accountLabel(account: FollowedAccount): string {
  return account.username ? `@${account.username}` : truncateAddress(account.address)
}

/**
 * The follow panel inlined under the category tabs on the Following tab: an
 * @username input with snapshot autocomplete, and the accounts already
 * followed as removable chips while the input is empty.
 */
export function FollowingManager({ following, onAdd, onRemove }: FollowingManagerProps) {
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

  // A raw SS58 paste follows directly. A username prefix only resolves once it
  // reaches the snapshot shard-key length, so shorter input shows the chips.
  const showResults = ss58 || query.length >= MIN_PREFIX_LENGTH

  return (
    <div class='following-panel'>
      <div class='following-panel__field'>
        <span class='following-panel__at'>@</span>
        <input
          ref={inputRef}
          class='following-panel__input'
          type='text'
          autocomplete='off'
          spellcheck={false}
          enterkeyhint='done'
          placeholder='username'
          value={input}
          onInput={(e) => setInput((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Done typing, and nothing more. Return used to follow the first
              // result, which arrives asynchronously, so pressing it early
              // followed whoever happened to be there. Choosing an account is a
              // choice, so it takes a tap. Blurring is what puts a phone
              // keyboard away.
              e.preventDefault()
              e.currentTarget.blur()
            } else if (e.key === 'Backspace' && input === '' && following.length > 0) {
              // Pull the last-followed username back into the field so it can
              // be edited rather than dropped outright.
              const last = following[following.length - 1]
              onRemove(last.address)
              setInput(last.username ?? last.address)
            } else if (e.key === 'Escape') {
              setInput('')
              e.currentTarget.blur()
            }
          }}
        />
      </div>

      {showResults ? (
        <div class='following-panel__results'>
          {ss58 ? (
            isFollowing(trimmed) ? (
              <p class='following-panel__state'>You already follow this address</p>
            ) : (
              <button type='button' class='following-panel__option' onClick={() => follow(trimmed)}>
                <span
                  class='following-panel__avatar'
                  style={{ backgroundColor: avatarBg(trimmed) }}
                >
                  {trimmed.charAt(0).toUpperCase()}
                </span>
                <span class='following-panel__row-label'>{truncateAddress(trimmed)}</span>
              </button>
            )
          ) : results.length > 0 ? (
            results.map((entry) => (
              <button
                key={entry.account}
                type='button'
                class='following-panel__option'
                onClick={() => follow(entry.account, entry.username)}
              >
                <span
                  class='following-panel__avatar'
                  style={{ backgroundColor: avatarBg(entry.username) }}
                >
                  {entry.username.charAt(0).toUpperCase()}
                </span>
                <span class='following-panel__row-label'>{entry.username}</span>
              </button>
            ))
          ) : searching ? (
            <p class='following-panel__state'>Searching…</p>
          ) : (
            <p class='following-panel__state'>No results for “{query}”</p>
          )}
        </div>
      ) : (
        following.length > 0 && (
          <div class='following-panel__chips'>
            {following.map((account) => (
              <span key={account.address} class='following-panel__chip'>
                <span
                  class='following-panel__chip-avatar'
                  style={{ backgroundColor: avatarBg(account.username ?? account.address) }}
                >
                  {(account.username ?? account.address).charAt(0).toUpperCase()}
                </span>
                <span class='following-panel__chip-label'>{accountLabel(account)}</span>
                <button
                  type='button'
                  class='following-panel__chip-remove'
                  aria-label={`Unfollow ${accountLabel(account)}`}
                  onClick={() => onRemove(account.address)}
                >
                  <X size={14} />
                </button>
              </span>
            ))}
          </div>
        )
      )}
    </div>
  )
}
