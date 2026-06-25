/**
 * Builds and signs the identity-binding message consumed by the resolver's
 * `bindIdentity`.
 *
 * Flow: ask the host for the connected user's primary username, resolve that
 * username to its owning root account on the People chain, then sign the binding
 * message with that account via the host's legacy-account signer. The resolver
 * derives the same identity from the signing key and admits attestations once it
 * holds personhood.
 *
 * The signed bytes MUST match the resolver's `_bindingMessage`:
 *   "attestation v1\n" || resolver(20 bytes) || account(20 bytes)
 * The host may or may not wrap raw payloads in `<Bytes>` tags. The resolver
 * verifies both the wrapped and bare forms, so we sign the bare bytes here.
 */

import { createAccountsProvider } from '@novasamatech/host-api-wrapper'
import { hexToBytes } from 'viem'

import { resolveUsernameOwner } from './client'

const MESSAGE_PREFIX = 'attestation v1\n'

/** The signature payload the identity account signs to bind `account`. */
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

export type IdentityBinding = {
  /** 32-byte sr25519 public key of the identity (root) account. */
  pubKey: Uint8Array
  /** 64-byte sr25519 signature over the binding message. */
  signature: Uint8Array
}

/**
 * Sign the binding message with the connected user's DotNS root account.
 *
 * Asks the host for the primary username, resolves it to its owning root
 * AccountId32 on the People chain, then signs via the host's legacy-account
 * signer. Throws when no username is available, the username owns no account, or
 * the host declines.
 */
export async function signIdentityMessage(
  resolver: `0x${string}`,
  account: `0x${string}`
): Promise<IdentityBinding> {
  const accountsProvider = createAccountsProvider()

  const username = (
    await accountsProvider.getUserId().match(
      (ok) => ok.primaryUsername,
      () => ''
    )
  ).trim()
  if (!username) {
    throw new Error('No DotNS username available from the host to sign with.')
  }

  const pubKey = await resolveUsernameOwner(username)
  if (!pubKey) {
    throw new Error(`No account owns DotNS username "${username}".`)
  }

  const signer = accountsProvider.getLegacyAccountSigner({ publicKey: pubKey, name: username })
  const signature = await signer.signBytes(buildBindingMessage(resolver, account))

  return { pubKey, signature }
}
