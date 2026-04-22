import { ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { type Binary, type SS58String } from 'polkadot-api'

import { namehash, nodeToSubject } from '../../src/lib/abi'
import { SCHEMA_LIKE_ID } from '../../src/lib/config'
import { withAttestationService } from './with-attestation-service'

interface AttestResult {
  success: boolean
  signerAddress: string
  attestationCountBefore: bigint
  attestationCountAfter: bigint
}

export async function createAttestation(label: string, devAccount = 'Alice'): Promise<AttestResult> {
  return withAttestationService(devAccount, async (service, address) => {
    const recipient = nodeToSubject(namehash(`${label}.dot`))
    const attesterH160 = ss58ToEthereum(address as SS58String).asHex()
    const attestationCountBefore = await service.countByRecipientAndSchema(
      recipient,
      SCHEMA_LIKE_ID
    )
    const alreadyAttested = await service.isActiveAny(recipient, SCHEMA_LIKE_ID, [attesterH160])
    if (!alreadyAttested) {
      await service.attest(SCHEMA_LIKE_ID, recipient, 0n, true, 0n, '0x' as unknown as Binary)
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
  const [, , label = 'e2e-test-app-alpha', account = 'Alice'] = process.argv
  createAttestation(label, account)
    .then((r) => { console.log('[main] done', r); process.exit(0) })
    .catch((e: Error) => { console.error('[main] error', e); process.exit(1) })
}
