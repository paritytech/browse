import { useQuery } from '@tanstack/react-query'

import { getCachedFollowed, setCachedFollowed } from './cache'
import { attestationRegistry } from '../../lib/attestation-registry'
import { type AppEntry } from '../apps/types'

/**
 * Query the attestation registry for apps that any of the given contact
 * addresses have vouched for. Results are cached to hostLocalStorage.
 *
 * The query key includes sorted contact addresses so it refetches when
 * the contact list changes.
 */
export function useGetAttestationsByContacts(apps: AppEntry[], contactAddresses: string[]) {
  const sorted = [...contactAddresses].sort()
  const appCount = apps.length

  return useQuery<Set<string>>({
    queryKey: ['attestations', 'followed', sorted, appCount],
    queryFn: async () => {
      const result = await attestationRegistry.getFollowedApps(apps, contactAddresses)
      setCachedFollowed([...result])
      return result
    },
    enabled: contactAddresses.length > 0 && apps.length > 0,
    staleTime: 5 * 60_000
  })
}

export async function prefetchFollowedLabels(
  queryClient: import('@tanstack/react-query').QueryClient
) {
  const cached = await getCachedFollowed()
  if (cached.length > 0) {
    queryClient.setQueryData(['attestations', 'followed'], new Set(cached))
  }
}
