import { DEFAULT_CERTIFICATES } from '../lib/config'
import { localStorage } from '../lib/local-storage'
import type { CertificateAuthority } from '../state/certificate-authorities/types'

const CATALOG_KEY = 'browse:certificate-authorities'
const SELECTED_KEY = 'browse:selected-certificate-authorities'

/**
 * The last discovery of certificate authorities.
 *
 * Cached so the app-read path knows each attester and schema without
 * re-discovering, and the manager renders instantly on cold start. Rewritten
 * wholesale on every discovery, so it never holds user state.
 */
export async function readCertificateAuthorities(): Promise<CertificateAuthority[]> {
  return (await localStorage.readJSON<CertificateAuthority[]>(CATALOG_KEY)) ?? []
}

export async function writeCertificateAuthorities(
  authorities: CertificateAuthority[]
): Promise<void> {
  await localStorage.writeJSON(CATALOG_KEY, authorities)
}

/**
 * Lowercased resolver addresses of the certificate authorities the user selected.
 *
 * When unset the deployer defaults apply, so the bundled authorities are
 * selected out of the box until the user changes anything. Kept separate from
 * the catalog above so discovery never clobbers the selection.
 */
export async function readSelectedCertificateAuthorities(): Promise<string[]> {
  const stored = await localStorage.readJSON<string[]>(SELECTED_KEY)
  return stored ?? [...DEFAULT_CERTIFICATES]
}

/** Select or deselect a certificate authority by its resolver address. */
export async function setCertificateAuthoritySelected(
  resolver: string,
  selected: boolean
): Promise<void> {
  const current = new Set(await readSelectedCertificateAuthorities())
  if (selected) current.add(resolver.toLowerCase())
  else current.delete(resolver.toLowerCase())
  await localStorage.writeJSON(SELECTED_KEY, [...current])
}

/** Restore the deployer default selection. */
export async function resetSelectedCertificateAuthorities(): Promise<void> {
  await localStorage.writeJSON(SELECTED_KEY, [...DEFAULT_CERTIFICATES])
}
