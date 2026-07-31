/**
 * How the snapshot jobs read their invocation.
 *
 * Both are launched the same way, by a nightly workflow with secrets in the
 * environment or by hand with a network alias, and both exit with a usable
 * message rather than a stack trace when something required is missing.
 */

import {
  isKnownGenesis,
  type NetworkGenesis,
  PASEO_ASSETHUB_NEXT_V2_GENESIS,
  PREVIEWNET_ASSETHUB_GENESIS,
  SUMMIT_ASSETHUB_GENESIS
} from '@parity/browse-sdk'

const GENESIS_BY_ALIAS: Record<string, NetworkGenesis> = {
  paseo: PASEO_ASSETHUB_NEXT_V2_GENESIS,
  'paseo-next-v2': PASEO_ASSETHUB_NEXT_V2_GENESIS,
  previewnet: PREVIEWNET_ASSETHUB_GENESIS,
  preview: PREVIEWNET_ASSETHUB_GENESIS,
  summit: SUMMIT_ASSETHUB_GENESIS
}

/** Resolve the target genesis from `NETWORK_GENESIS_HASH` or the CLI alias. */
export function resolveGenesis(): NetworkGenesis {
  const envGenesis = process.env.NETWORK_GENESIS_HASH
  if (envGenesis) {
    if (!isKnownGenesis(envGenesis)) {
      console.error(`Unknown NETWORK_GENESIS_HASH: ${envGenesis}`)
      process.exit(1)
    }
    return envGenesis
  }
  const alias = (process.argv[2] ?? 'paseo').toLowerCase()
  const genesis = GENESIS_BY_ALIAS[alias]
  if (!genesis) {
    console.error(
      `Unknown network alias '${alias}'. Use: ${Object.keys(GENESIS_BY_ALIAS).join(', ')}`
    )
    process.exit(1)
  }
  return genesis
}

/**
 * The key that pays for Bulletin storage and signs the pointer record.
 *
 * One secret covers both, since the deploy pipeline registers the pointer name
 * with this same key.
 */
export function requireMnemonic(): string {
  const mnemonic = process.env.MNEMONIC
  if (!mnemonic) {
    console.error('MNEMONIC env is required to publish the snapshot')
    process.exit(1)
  }
  return mnemonic
}

/**
 * Name the pointer records are written to, which is the name this deployment
 * lives at.
 *
 * The deploy pipeline registers it with the same key that signs the records, so
 * writing there needs no separate registration. `APP_DOTNS_DOMAIN` is the full
 * domain the deploy computed, suffix included.
 */
export function requirePointerDomain(): string {
  const domain = process.env.APP_DOTNS_DOMAIN
  if (!domain) {
    console.error('APP_DOTNS_DOMAIN env is required to record the snapshot pointer')
    process.exit(1)
  }
  return domain.toLowerCase().endsWith('.dot')
    ? domain.toLowerCase()
    : `${domain.toLowerCase()}.dot`
}
