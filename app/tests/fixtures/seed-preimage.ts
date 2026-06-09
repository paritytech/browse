import {
  KNOWN_NETWORKS,
  PREVIEWNET_ASSET_HUB_GENESIS,
  type NetworkGenesis
} from '@parity/browse-sdk'
import type { Page } from '@playwright/test'

/** IPFS gateway for the network the suite runs against. */
function ipfsGateway(): string {
  const genesis = process.env.NETWORK_GENESIS_HASH
  const known =
    genesis && Object.prototype.hasOwnProperty.call(KNOWN_NETWORKS, genesis)
      ? KNOWN_NETWORKS[genesis as NetworkGenesis]
      : KNOWN_NETWORKS[PREVIEWNET_ASSET_HUB_GENESIS]
  return known.IPFS_GATEWAY
}

/** Seed raw bytes into the test host's preimage map (keyed by blake2b-256). */
export async function seedPreimage(page: Page, bytes: Uint8Array): Promise<void> {
  await page.evaluate((arr) => {
    const host = (
      window as unknown as { __TEST_HOST__?: { seedPreimage: (v: Uint8Array) => string } }
    ).__TEST_HOST__
    if (!host?.seedPreimage) throw new Error('__TEST_HOST__.seedPreimage is unavailable')
    host.seedPreimage(new Uint8Array(arr))
  }, Array.from(bytes))
}

/**
 * Fetch a cached app's icon bytes from the IPFS gateway by its `iconCid` and
 * seed them into the test host, so the card's icon lookup resolves to an image.
 * Reads `iconCid` from the host page's labels DB, so call it after a sync.
 */
export async function seedIconPreimage(page: Page, label: string): Promise<void> {
  const cid = await page.evaluate((l) => {
    const raw = localStorage.getItem('test-host:browse:labels')
    const arr = raw ? (JSON.parse(raw) as Array<{ label: string; iconCid: string | null }>) : []
    return arr.find((entry) => entry.label === l)?.iconCid ?? null
  }, label)
  if (!cid) throw new Error(`No cached iconCid for "${label}"`)

  const res = await fetch(`${ipfsGateway()}/ipfs/${cid}`)
  if (!res.ok) throw new Error(`Icon fetch failed for "${label}" (${cid}): HTTP ${res.status}`)
  await seedPreimage(page, new Uint8Array(await res.arrayBuffer()))
}
