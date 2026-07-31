/**
 * Following-manager suggestions from the verifiable username snapshot.
 *
 * Each snapshot entry carries the account that owns the username, so selecting a
 * suggestion follows that account with no further lookup.
 */

import { MIN_PREFIX_LENGTH, type UsernameEntry } from '@parity/browse-sdk/snapshots'
import { useQuery } from '@tanstack/react-query'

import { usernameService } from './snapshot-services'

export { MIN_PREFIX_LENGTH }
export type { UsernameEntry }

/**
 * Suggest username matches for a prefix.
 *
 * The prefix must already be normalized, lowercased with any leading `@`
 * stripped. Yields `[]` rather than throwing on any failure.
 */
export function useUsernameSuggestions(prefix: string) {
  return useQuery<UsernameEntry[]>({
    queryKey: ['usernameSuggestions', prefix],
    queryFn: ({ signal }) => usernameService.suggest(prefix, signal),
    enabled: prefix.length >= MIN_PREFIX_LENGTH,
    staleTime: 60_000
  })
}
