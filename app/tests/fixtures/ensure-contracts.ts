import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEV_PHRASE as IDENTITY_PHRASE } from '../utils'

/**
 * Put the Browse contract stack on the active network, or confirm it is
 * there. Runs the staged deploy this repo ships, up to the client build, signed by the
 * e2e master wallet, so after a chain reset the suite rebuilds what it tests
 * against instead of waiting for someone to. Idempotent. On a healthy network
 * it is a handful of reads.
 */
export function ensureContracts(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  execFileSync('bun', ['scripts/deploy.ts', '--contracts-only'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, MNEMONIC: IDENTITY_PHRASE, DERIVATION_PATH: '//wallet' }
  })
}
