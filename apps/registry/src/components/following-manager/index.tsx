import { useEffect, useMemo, useState } from 'preact/hooks'

import { AccountId } from 'polkadot-api'

import { MIN_PREFIX_LENGTH, useUsernameSuggestions } from '../../lib/usernames-snapshot'
import { type FollowedAccount } from '../../state/following/api'
import { avatarBg } from '../identicon'
import { type StackItem, StackPanel } from '../stack-panel'

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
  /** Whether the @username input is expanded, owned by the parent. */
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (address: string, username?: string) => void
  onRemove: (address: string) => void
}

/** How long a lookup runs before "Searching…" replaces the blank line. */
const SEARCHING_DELAY_MS = 300

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function accountLabel(account: FollowedAccount): string {
  return account.username ? `@${account.username}` : truncateAddress(account.address)
}

function toStackItem(account: FollowedAccount): StackItem {
  const seed = account.username ?? account.address
  return {
    key: account.address,
    label: accountLabel(account),
    avatar: seed.charAt(0).toUpperCase(),
    avatarStyle: { backgroundColor: avatarBg(seed) }
  }
}

/**
 * The follow panel inlined under the category tabs on the Following tab.
 *
 * The followed accounts sit as a stack of avatars, and the + grows into the
 * @username input with snapshot autocomplete. See {@link StackPanel}.
 */
export function FollowingManager({
  following,
  open,
  onOpenChange,
  onAdd,
  onRemove
}: FollowingManagerProps) {
  const [input, setInput] = useState('')

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
  const {
    data: suggestions = [],
    isFetching,
    isPlaceholderData
  } = useUsernameSuggestions(ss58 ? '' : suggestionPrefix)
  // Held rows from the previous prefix are narrowed to the current query, so a
  // row that no longer matches never shows while the next prefix loads.
  const results = useMemo(
    () =>
      suggestions.filter(
        (entry) => entry.username.toLowerCase().startsWith(query) && !isFollowing(entry.account)
      ),
    [suggestions, following, query]
  )
  const pending = isFetching || suggestionPrefix !== query

  // A prefix with no matches has none for any longer prefix either, so typing on
  // past it keeps "No results" up instead of cycling through "Searching…".
  const [emptyPrefix, setEmptyPrefix] = useState<string | null>(null)
  const settledEmpty = !ss58 && !isFetching && !isPlaceholderData && suggestions.length === 0
  useEffect(() => {
    if (settledEmpty && suggestionPrefix.length >= MIN_PREFIX_LENGTH) {
      setEmptyPrefix(suggestionPrefix)
    }
  }, [settledEmpty, suggestionPrefix])
  const knownEmpty = emptyPrefix !== null && query.startsWith(emptyPrefix)

  // "Searching…" only appears once a lookup outlasts a short delay, so a quick
  // one never flashes it.
  const [showSearching, setShowSearching] = useState(false)
  useEffect(() => {
    if (!pending) {
      setShowSearching(false)
      return
    }
    const id = setTimeout(() => setShowSearching(true), SEARCHING_DELAY_MS)
    return () => clearTimeout(id)
  }, [pending])

  // Collapse back to the stack on follow: the new avatar appearing there is the
  // confirmation, and following more people is one tap away.
  function follow(address: string, username?: string) {
    if (isFollowing(address)) return
    onAdd(address, username)
    onOpenChange(false)
  }

  // A raw SS58 paste follows directly. A username prefix only resolves once it
  // reaches the snapshot shard-key length, so shorter input shows nothing yet.
  const showResults = ss58 || query.length >= MIN_PREFIX_LENGTH

  return (
    <StackPanel
      variant='stack-panel--following'
      items={following.map(toStackItem)}
      open={open}
      onOpenChange={onOpenChange}
      onRemove={onRemove}
      input={input}
      onInput={setInput}
      addLabel='Follow someone'
      removeLabel={(item) => `Unfollow ${item.label}`}
      moreLabel={(count) => `Show all ${count} followed accounts`}
      placeholder='username'
      prefix='@'
    >
      {showResults &&
        (ss58 ? (
          isFollowing(trimmed) ? (
            <p class='stack-panel__state'>You already follow this address</p>
          ) : (
            <button type='button' class='stack-panel__option' onClick={() => follow(trimmed)}>
              <span class='stack-panel__avatar' style={{ backgroundColor: avatarBg(trimmed) }}>
                {trimmed.charAt(0).toUpperCase()}
              </span>
              <span class='stack-panel__row-label'>{truncateAddress(trimmed)}</span>
            </button>
          )
        ) : results.length > 0 ? (
          results.map((entry) => (
            <button
              key={entry.account}
              type='button'
              class='stack-panel__option'
              onClick={() => follow(entry.account, entry.username)}
            >
              <span
                class='stack-panel__avatar'
                style={{ backgroundColor: avatarBg(entry.username) }}
              >
                {entry.username.charAt(0).toUpperCase()}
              </span>
              <span class='stack-panel__row-label'>{entry.username}</span>
            </button>
          ))
        ) : knownEmpty || !pending ? (
          <p class='stack-panel__state'>No results for “{query}”</p>
        ) : showSearching ? (
          <p class='stack-panel__state'>Searching…</p>
        ) : (
          <p class='stack-panel__state' aria-hidden='true'>
            {' '}
          </p>
        ))}
    </StackPanel>
  )
}
