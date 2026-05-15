import { ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { AccountId, type SS58String } from 'polkadot-api'

import { namehash, nodeToSubject } from '../../src/lib/abi'
import { BACKEND } from '../../src/lib/config'
import { withAttestationService } from './with-attestation-service'

export async function createRevokedAttestation(label: string, devAccount = 'Alice'): Promise<void> {
  await withAttestationService(devAccount, async (service) => {
    const recipient = nodeToSubject(namehash(`${label}.dot`))
    const { publicKey } = await service.getSigner()
    const ss58 = AccountId().dec(publicKey)
    const attesterH160 = (ss58ToEthereum(ss58 as SS58String) as `0x${string}`).toLowerCase()

    const ids = await service.listByRecipientAndSchema(recipient, BACKEND.SCHEMA_ID, 0n, 100n)
    if (ids.length === 0) return

    const records = await Promise.all(ids.map((id) => service.getAttestationById(id)))
    const match = ids.find((_, i) => records[i].attester.toLowerCase() === attesterH160)
    if (match === undefined) return

    await service.revoke(BACKEND.SCHEMA_ID, match)
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , label = 'e2e-test-app-alpha', account = 'Alice'] = process.argv
  createRevokedAttestation(label, account)
    .then(() => {
      console.log('[main] done')
      process.exit(0)
    })
    .catch((e: Error) => {
      console.error('[main] error', e)
      process.exit(1)
    })
}
