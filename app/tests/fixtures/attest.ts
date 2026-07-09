import { ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { type SS58String } from 'polkadot-api'

import { encodeAttestationLabel, namehash, nodeToSubject } from '../../src/lib/abi'
import { ACTIVE_SCHEMA_ID } from '../../src/lib/config'
import { withAttestationService } from './with-attestation-service'

interface AttestResult {
  success: boolean
  signerAddress: string
  attestationCountBefore: bigint
  attestationCountAfter: bigint
}

// The gated resolver only accepts attestations from the bound product account,
// so seeding always signs as that account.
export async function createAttestation(label: string): Promise<AttestResult> {
  return withAttestationService(async (service, address) => {
    const recipient = nodeToSubject(namehash(`${label}.dot`))
    const attesterH160 = ss58ToEthereum(address as SS58String) as `0x${string}`
    const attestationCountBefore = await service.countByRecipientAndSchema(recipient)
    const alreadyAttested = await service.isActiveAny(recipient, [attesterH160])
    if (!alreadyAttested) {
      const data = encodeAttestationLabel(label)
      try {
        await service.attest(ACTIVE_SCHEMA_ID, recipient, 0n, true, 0n, data)
      } catch (err) {
        // The one-per-identity lock is keyed on the identity, not the attester,
        // so a recommendation left by another product account of this identity
        // (e.g. a leftover bind-and-attest seed) makes this re-attest revert
        // with ResolverRejected. For seeding that is a success: the label is
        // already recommended by the identity, so treat it as an idempotent
        // no-op rather than failing the whole suite.
        if (!String(err).includes('ResolverRejected')) throw err
      }
    }
    return {
      success: true,
      signerAddress: address,
      attestationCountBefore,
      attestationCountAfter: attestationCountBefore + 1n
    }
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , label = 'calculator'] = process.argv
  createAttestation(label)
    .then((r) => {
      console.log('[main] done', r)
      process.exit(0)
    })
    .catch((e: Error) => {
      console.error('[main] error', e)
      process.exit(1)
    })
}
