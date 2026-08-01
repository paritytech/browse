/**
 * Serve a running dev server through a mock Host, so the app renders in a browser.
 *
 *   cd app && bun run dev:paseo                      # in one terminal
 *   cd app && bun scripts/mock-host.ts               # in another, prints a URL
 *   cd app && bun scripts/mock-host.ts --port 3004 --network previewnet
 *
 * The app gates its UI on being inside a Host webview, so `localhost:<port>` on its
 * own only ever shows "Not Running Inside Host". This wraps that port in
 * `createTestHostServer`, which supplies the bridge the app expects: an account, a
 * signer, and routed chain reads.
 *
 * The network here must match the one the dev server was started with. Mismatch it
 * and every read fails with "Host does not support network", which looks exactly
 * like a broken feature rather than a misconfigured script. The app itself falls
 * back to Paseo when `NETWORK_GENESIS_HASH` is unset, so an unset variable and a
 * previewnet host is the easy way to hit this.
 */

import {
  KNOWN_NETWORKS,
  PASEO_ASSETHUB_NEXT_V2_GENESIS,
  PREVIEWNET_ASSETHUB_GENESIS
} from '@parity/browse-sdk'
import { createTestHostServer } from '@parity/host-api-test-sdk'

function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback)
}

/** Dev accounts the test host can impersonate. */
const DEV_ACCOUNTS = ['alice', 'bob', 'charlie', 'dave', 'eve', 'ferdie'] as const

function accountFlag(): (typeof DEV_ACCOUNTS)[number] {
  const value = flag('account', 'alice')
  const account = DEV_ACCOUNTS.find((name) => name === value)
  if (!account) {
    console.error(`--account must be one of: ${DEV_ACCOUNTS.join(', ')}`)
    process.exit(1)
  }
  return account
}

const port = flag('port', '3000')
const onPreviewnet = flag('network', 'paseo') === 'previewnet'
const genesis = onPreviewnet ? PREVIEWNET_ASSETHUB_GENESIS : PASEO_ASSETHUB_NEXT_V2_GENESIS
const network = KNOWN_NETWORKS[genesis]
const token = onPreviewnet
  ? { tokenSymbol: 'UNIT', tokenDecimals: 12 }
  : { tokenSymbol: 'PAS', tokenDecimals: 10 }

const host = await createTestHostServer({
  productUrl: `http://localhost:${port}/`,
  accounts: [accountFlag()],
  networks: [
    {
      id: 'asset-hub',
      name: 'Asset Hub',
      genesisHash: genesis,
      rpcUrl: network.ASSETHUB_RPCS[0],
      ...token
    },
    {
      id: 'people',
      name: 'People',
      genesisHash: network.PEOPLE_GENESIS!,
      rpcUrl: network.PEOPLE_RPCS![0],
      ...token
    }
  ]
})

console.log(
  `dev server:  http://localhost:${port}/  (${onPreviewnet ? 'previewnet' : 'paseo-next-v2'})`
)
console.log(`open this:   ${host.url}`)
console.log('Ctrl-C to stop.')

await new Promise(() => {})
