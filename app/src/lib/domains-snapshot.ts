/**
 * Search-bar suggestions from the verifiable `.dot` domain snapshot.
 *
 * Binds {@link domainService} to react-query, so a suggestion survives a
 * re-render and a stale keystroke aborts instead of racing the one after it.
 */

import { MIN_PREFIX_LENGTH } from '@parity/browse-sdk/snapshots'
import { useQuery } from '@tanstack/react-query'

import { domainService } from './snapshot-services'

/**
 * Suggest bare `.dot` labels for a search prefix.
 *
 * The prefix must already be normalized, lowercased with any `.dot` stripped.
 * Yields `[]` rather than throwing on any failure, so suggestions close instead
 * of breaking render.
 */
export function useDomainSuggestions(prefix: string) {
  return useQuery<string[]>({
    queryKey: ['domainSuggestions', prefix],
    queryFn: ({ signal }) => domainService.suggest(prefix, signal),
    enabled: prefix.length >= MIN_PREFIX_LENGTH,
    staleTime: 60_000
  })
}
