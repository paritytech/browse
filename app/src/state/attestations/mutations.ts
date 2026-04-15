import { useMutation } from '@tanstack/react-query'

import { attestationRegistry } from '../../lib/attestation-registry'

export function useAttestApp() {
  return useMutation({
    mutationFn: (label: string) => attestationRegistry.attest(label)
  })
}

export function useRevokeApp() {
  return useMutation({
    mutationFn: (label: string) => attestationRegistry.revoke(label)
  })
}
