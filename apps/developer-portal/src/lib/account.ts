import { getAccountsProvider } from '@parity/product-sdk/host'
import { AccountId, type PolkadotSigner, type SS58String } from 'polkadot-api'
import { keccak256 } from 'viem'

import { resolveUsernameOwner } from './chain'

/**
 * The connected user identity that publishes domains.
 *
 * `.dot` names are owned by the user root account (the one owning their DotNS
 * username), so that account signs publish transactions and its H160 is the
 * `msg.sender` the Publisher registry checks ownership against. This is the
 * legacy/root account, not the app-scoped product account.
 */
export type Identity = {
  username: string
  /** SS58 of the root account, used as the dry-run origin. */
  ss58: SS58String
  /** The root account EVM address, i.e. the publisher the registry records. */
  h160: `0x${string}`
  signer: PolkadotSigner
}

/** The revive H160 a 32-byte account public key controls: keccak256(pubKey)[12..]. */
function h160Of(publicKey: Uint8Array): `0x${string}` {
  return `0x${keccak256(publicKey).slice(-40)}` as `0x${string}`
}

let identityPromise: Promise<Identity> | null = null

/**
 * Resolve the connected user identity from the host.
 *
 * Asks for the primary DotNS username, resolves it to its owning root account
 * on the People chain, and builds the host legacy-account signer for it. Cached
 * for the session. Throws when run outside a host or when no username is set.
 */
export function connectIdentity(): Promise<Identity> {
  if (!identityPromise) {
    identityPromise = (async () => {
      const provider = await getAccountsProvider()
      if (!provider) {
        throw new Error('Host accounts provider unavailable (not running in a host container?).')
      }

      // Connecting is the explicit step toward publishing, so log in here. This
      // prompts the host when the user is not already connected.
      const login = await provider.requestLogin('Connect to publish domains').match(
        (ok) => ok,
        () => 'rejected' as const
      )
      if (login === 'rejected') throw new Error('Connection to the host was declined.')

      const username = (
        await provider.getUserId().match(
          (ok) => ok.primaryUsername,
          () => ''
        )
      ).trim()
      if (!username) throw new Error('No DotNS username available from the host.')

      const publicKey = await resolveUsernameOwner(username)
      if (!publicKey) throw new Error(`No account owns DotNS username "${username}".`)

      const ss58 = AccountId().dec(publicKey) as SS58String
      const h160 = h160Of(publicKey)
      console.log(`Primary Account · ${username} · ss58 ${ss58} · h160 ${h160}`)

      return {
        username,
        ss58,
        h160,
        signer: provider.getLegacyAccountSigner({ publicKey, name: username })
      }
    })().catch((err) => {
      identityPromise = null
      throw err
    })
  }
  return identityPromise
}
