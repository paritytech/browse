import { ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { useQuery } from '@tanstack/react-query'
import { AccountId, type SS58String } from 'polkadot-api'

import { getCachedFollowed, setCachedFollowed } from './cache'
import { namehash, nodeToSubject } from '../../lib/abi'
import { attestationService } from '../../lib/attestation-service'
import { SCHEMA_LIKE_ID } from '../../lib/config'
import { type AppEntry } from '../apps/types'

async function getFollowedApps(apps: AppEntry[], contacts: string[]): Promise<Set<string>> {
  if (contacts.length === 0 || apps.length === 0) return new Set()

  const h160Contacts = contacts.map((ss58) => ss58ToEthereum(ss58 as SS58String).asHex())

  const results = await Promise.all(
    apps.map((app) => {
      const recipient = nodeToSubject(namehash(`${app.label}.dot`))
      return attestationService.isActiveAny(recipient, SCHEMA_LIKE_ID, h160Contacts)
    })
  )

  const matched = new Set<string>()
  for (let i = 0; i < apps.length; i++) {
    if (results[i]) matched.add(apps[i].label)
  }
  return matched
}

export function useGetAttestationsByContacts(apps: AppEntry[], contactAddresses: string[]) {
  const sorted = [...contactAddresses].sort()
  const appCount = apps.length

  return useQuery<Set<string>>({
    queryKey: ['attestations', 'followed', sorted, appCount],
    queryFn: async () => {
      const result = await getFollowedApps(apps, contactAddresses)
      setCachedFollowed([...result])
      return result
    },
    enabled: contactAddresses.length > 0 && apps.length > 0,
    staleTime: 5 * 60_000
  })
}

export function useGetAppAttestation(label: string) {
  return useQuery({
    queryKey: ['attestations', 'app', label],
    queryFn: async () => {
      const recipient = nodeToSubject(namehash(`${label}.dot`))
      const { publicKey } = await attestationService.getSigner()
      const ss58 = AccountId().dec(publicKey)
      const userH160 = ss58ToEthereum(ss58 as SS58String).asHex()
      const [count, hasUserAttested] = await Promise.all([
        attestationService.countByRecipientAndSchema(recipient, SCHEMA_LIKE_ID),
        attestationService.isActiveAny(recipient, SCHEMA_LIKE_ID, [userH160])
      ])
      return { attestationCount: Number(count), hasUserAttested }
    },
    staleTime: 30_000
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
