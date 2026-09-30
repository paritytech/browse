import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { Plus, X } from 'lucide-preact'
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
  /**
   * Whether the @username input is expanded.
   *
   * Owned by the parent so it can hide the app list while someone is being added.
   */
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (address: string, username?: string) => void
  onRemove: (address: string) => void
}

/** Avatars shown before the stack truncates into a +N circle. */
const STACK_LIMIT = 3

/** How long a lookup runs before "Searching…" replaces the blank line. */
const SEARCHING_DELAY_MS = 300

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function accountLabel(account: FollowedAccount): string {
  return account.username ? `@${account.username}` : truncateAddress(account.address)
}

/**
 * The follow panel inlined under the category tabs on the Following tab. At
 * rest it is one compact row: the followed accounts as a stack of avatars with
 * a + button tucked on as the next slot.
 *
 * An avatar expands to its name and an unfollow cross on mouse hover or on tap.
 * Past STACK_LIMIT avatars the stack truncates into a +N circle that fans every
 * name out. The + grows into the @username input, right of the stack, with
 * snapshot autocomplete.
 */
export function FollowingManager({
  following,
  open,
  onOpenChange,
  onAdd,
  onRemove
}: FollowingManagerProps) {
  // The avatar expanded by tap. Hover expansion is pure CSS on top of this.
  const [expandedAddress, setExpandedAddress] = useState<string | null>(null)
  // Whether the whole stack is fanned out to names, from tapping the +N circle.
  const [expandedAll, setExpandedAll] = useState(false)
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const stackRef = useRef<HTMLDivElement>(null)

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

  // Drop the caret into the field as it expands from the + button, folding any
  // opened avatar back into the stack, and reset the draft whenever the field
  // closes, including a close from the parent.
  useEffect(() => {
    if (open) {
      setExpandedAddress(null)
      setExpandedAll(false)
      inputRef.current?.focus()
    } else {
      setInput('')
    }
  }, [open])

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

  // Past this many the stack truncates into a +N circle that fans the whole
  // stack out to names. Falling back under it ends the fan-out.
  const overflow = following.length - STACK_LIMIT
  useEffect(() => {
    if (overflow <= 0) setExpandedAll(false)
  }, [overflow])
  const shown = expandedAll || overflow <= 0 ? following : following.slice(0, STACK_LIMIT)

  // Any click away from the fanned-out stack folds it back. An unfollow cross
  // stops propagation, so pruning the fan keeps it open.
  useEffect(() => {
    if (!expandedAll) return
    const onDocClick = (e: MouseEvent) => {
      if (e.target instanceof Node && stackRef.current?.contains(e.target)) return
      setExpandedAll(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [expandedAll])

  const stack = following.length > 0 && (
    <div
      ref={stackRef}
      class={`following-panel__stack${expandedAll ? ' following-panel__stack--expanded' : ''}`}
    >
      {shown.map((account) => (
        <div
          key={account.address}
          class={`following-panel__chip${
            expandedAddress === account.address ? ' following-panel__chip--expanded' : ''
          }`}
          onClick={() =>
            expandedAll
              ? setExpandedAll(false)
              : setExpandedAddress(expandedAddress === account.address ? null : account.address)
          }
        >
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
            onClick={(e) => {
              e.stopPropagation()
              onRemove(account.address)
            }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )

  return (
    <div class={`following-panel${open ? ' following-panel--adding' : ''}`}>
      <div class='following-panel__row'>
        {stack}
        {overflow > 0 && !expandedAll && (
          <button
            type='button'
            class='following-panel__more'
            aria-label={`Show all ${following.length} followed accounts`}
            onClick={() => setExpandedAll(true)}
          >
            +{overflow}
          </button>
        )}
        {/* The + is the collapsed input: one element that grows from the last
            slot of the stack into the field, so the expansion is a single
            smooth transition instead of a swap. Hidden while the stack is
            fanned out. */}
        {!expandedAll && (
          <div class={`following-panel__field${open ? ' following-panel__field--open' : ''}`}>
            <button
              type='button'
              class='following-panel__add'
              aria-label='Follow someone'
              tabIndex={open ? -1 : 0}
              onClick={() => onOpenChange(true)}
            >
              <Plus size={16} />
            </button>
            <span class='following-panel__at'>@</span>
            <input
              ref={inputRef}
              class='following-panel__input'
              type='text'
              autocomplete='off'
              spellcheck={false}
              enterkeyhint='done'
              placeholder='username'
              tabIndex={open ? 0 : -1}
              value={input}
              onInput={(e) => setInput((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  // Return only puts the phone keyboard away. Results arrive
                  // asynchronously, so following one always takes a tap.
                  e.preventDefault()
                  e.currentTarget.blur()
                } else if (e.key === 'Escape') {
                  onOpenChange(false)
                }
              }}
            />
            <button
              type='button'
              class='following-panel__close'
              aria-label='Close'
              tabIndex={open ? 0 : -1}
              onClick={() => onOpenChange(false)}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>

      {showResults && (
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
          ) : knownEmpty || !pending ? (
            <p class='following-panel__state'>No results for “{query}”</p>
          ) : showSearching ? (
            <p class='following-panel__state'>Searching…</p>
          ) : (
            <p class='following-panel__state' aria-hidden='true'>
              {'\u00a0'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
