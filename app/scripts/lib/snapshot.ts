/**
 * How the snapshot jobs read their invocation.
 *
 * Both jobs are launched the same way, by a nightly workflow with secrets in the
 * environment or by hand with a network alias. These turn either form into the
 * network, credentials, and pointer name a run needs, and exit with a usable
 * message when something required is missing.
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

/** Read a required environment variable, exiting with a clear message if unset. */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`${name} env is required to publish the snapshot`)
    process.exit(1)
  }
  return value
}

/**
 * Name to record the published manifest CID on, or `null` to skip the record.
 *
 * The write is signed with `MNEMONIC`, the same key the deploy pipeline
 * registers the name with, so no second secret is involved. Set
 * `SKIP_SNAPSHOT_POINTER` to publish blocks against a network where that key
 * does not own the name.
 */
export function pointerDomain(fallback: string): string | null {
  if (process.env.SKIP_SNAPSHOT_POINTER) return null
  return process.env.SNAPSHOT_POINTER_DOMAIN || fallback
}
