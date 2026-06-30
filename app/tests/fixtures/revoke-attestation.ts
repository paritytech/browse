import { ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { AccountId, type SS58String } from 'polkadot-api'

import { namehash, nodeToSubject } from '../../src/lib/abi'
import { createProductSigner } from './fund'
import { withSigner } from './with-attestation-service'

// Revokes the given account attestation on `label`. Defaults to the bound
// product account. Pass a different signer to revoke another attester.
export async function createRevokedAttestation(
  label: string,
  credentials = createProductSigner()
): Promise<void> {
  await withSigner(credentials, async (service) => {
    const recipient = nodeToSubject(namehash(`${label}.dot`))
    const { publicKey } = await service.getSigner()
    const ss58 = AccountId().dec(publicKey)
    const attesterH160 = (ss58ToEthereum(ss58 as SS58String) as `0x${string}`).toLowerCase()

    const ids = await service.listByRecipientAndSchema(recipient, 0n, 100n)
    if (ids.length === 0) return

    const records = await Promise.all(ids.map((id) => service.getAttestationById(id)))
    const matchIndex = records.findIndex((r) => r.attester.toLowerCase() === attesterH160)
    if (matchIndex === -1) return

    await service.revoke(records[matchIndex].schema, ids[matchIndex])
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , label = 'calculator'] = process.argv
  createRevokedAttestation(label)
    .then(() => {
      console.log('[main] done')
      process.exit(0)
    })
    .catch((e: Error) => {
      console.error('[main] error', e)
      process.exit(1)
    })
}
