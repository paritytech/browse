import { ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { type SS58String } from 'polkadot-api'

import { encodeAttestationLabel, namehash, nodeToSubject } from '../../src/lib/abi'
import { NETWORK } from '../../src/lib/config'
import { withAttestationService } from './with-attestation-service'

interface AttestResult {
  success: boolean
  signerAddress: string
  attestationCountBefore: bigint
  attestationCountAfter: bigint
}

export async function createAttestation(
  label: string,
  devAccount = 'Alice'
): Promise<AttestResult> {
  return withAttestationService(devAccount, async (service, address) => {
    const recipient = nodeToSubject(namehash(`${label}.dot`))
    const attesterH160 = ss58ToEthereum(address as SS58String) as `0x${string}`
    const attestationCountBefore = await service.countByRecipientAndSchema(
      recipient,
      NETWORK.SCHEMA_ID
    )
    const alreadyAttested = await service.isActiveAny(recipient, NETWORK.SCHEMA_ID, [attesterH160])
    if (!alreadyAttested) {
      const data = encodeAttestationLabel(label)
      await service.attest(NETWORK.SCHEMA_ID, recipient, 0n, true, 0n, data)
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
  const [, , label = 'calculator', account = 'Alice'] = process.argv
  createAttestation(label, account)
    .then((r) => {
      console.log('[main] done', r)
      process.exit(0)
    })
    .catch((e: Error) => {
      console.error('[main] error', e)
      process.exit(1)
    })
}
