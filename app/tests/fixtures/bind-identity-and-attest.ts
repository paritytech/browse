import { ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { type SS58String } from 'polkadot-api'
import { bytesToHex, hexToBytes } from 'viem'

import { encodeAttestationLabel, namehash, nodeToSubject } from '../../src/lib/abi'
import { ACTIVE_ATTESTATION_RESOLVER, ACTIVE_SCHEMA_ID } from '../../src/lib/config'
import { createDevSigner, createProductSigner } from './fund'
import { withSigner } from './with-attestation-service'

const MESSAGE_PREFIX = 'attestation v1\n'

/** The bare message the identity key signs to bind `account`, matching the resolver's `_bindingMessage`. */
function buildBindingMessage(resolver: `0x${string}`, account: `0x${string}`): Uint8Array {
  const prefix = new TextEncoder().encode(MESSAGE_PREFIX)
  const resolverBytes = hexToBytes(resolver)
  const accountBytes = hexToBytes(account)
  const out = new Uint8Array(prefix.length + resolverBytes.length + accountBytes.length)
  out.set(prefix, 0)
  out.set(resolverBytes, prefix.length)
  out.set(accountBytes, prefix.length + resolverBytes.length)
  return out
}

/**
 * Bind the `tag` product account to the connected identity, then attest `label`
 * as that account. This is the fixture twin of the app first recommendation, but
 * driven from Node: the identity key (`//wallet`, which owns smalltava.05 and
 * holds the binding key) signs the binding message directly instead of going
 * through the host. Use it to seed an attestation from a freshly bound account so
 * a second product account of the same identity is then refused on the same app.
 */
export async function bindIdentityAndAttest(tag: string, label: string): Promise<void> {
  const account = createDevSigner(tag)
  const h160 = (ss58ToEthereum(account.address as SS58String) as `0x${string}`).toLowerCase()
  const message = buildBindingMessage(ACTIVE_ATTESTATION_RESOLVER, h160 as `0x${string}`)

  const identity = createProductSigner()
  const signature = await identity.signer.signBytes(message)

  await withSigner(account, async (service) => {
    await service.bindIdentity(bytesToHex(identity.publicKey), bytesToHex(signature))
    const recipient = nodeToSubject(namehash(`${label}.dot`))
    const data = encodeAttestationLabel(label)
    try {
      await service.attest(ACTIVE_SCHEMA_ID, recipient, 0n, true, 0n, data)
    } catch (err) {
      // The identity may already recommend this label via another bound product
      // account or a prior seed.
      if (!String(err).includes('ResolverRejected')) throw err
    }
  })
}
