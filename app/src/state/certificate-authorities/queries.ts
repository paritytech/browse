/**
 * Certificate authority discovery and trust state.
 *
 * Enumerates schemas and keeps those whose resolver is a
 * `TrustedAttesterIndexResolver`, so each such schema is a certificate
 * authority. No registry contract is needed. Results are cached so the app-read
 * path knows each attester and schema without re-discovering.
 */

import { useQuery } from '@tanstack/react-query'

import type { CertificateAuthority } from './types'
import {
  readCertificateAuthorities,
  readSelectedCertificateAuthorities,
  writeCertificateAuthorities
} from '../../db/certificate-authorities'
import {
  decodeAddress,
  decodeAddressArray,
  decodeAttestation,
  decodeSchemaRecord,
  decodeUint,
  encodeCountBySchema,
  encodeGetAttestationById,
  encodeGetSchema,
  encodeListBySchema,
  encodeSchemaCount,
  encodeTrustedAttester,
  type MulticallTarget,
  trustedAttestationId,
  tryDecode
} from '../../lib/abi'
import { reviveCall } from '../../lib/client'
import { NETWORK } from '../../lib/config'
import { hiddenLog } from '../../lib/debug'
import { multicall } from '../../lib/multicall'
import { certificateIdentityFrom } from '../apps/remote'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * The current compliance schema spec. Only authorities registered against this
 * exact spec are surfaced. Older `"bool compliant"` schemas are ignored.
 */
const COMPLIANCE_SCHEMA_SPEC = 'bool compliant,string contentCid,string badgeIconCid,string name'

/** The network built-in authority from config, known even before discovery runs. */
function builtinCertificateAuthority(): CertificateAuthority | null {
  const resolver = NETWORK.TRUSTED_ATTESTER_RESOLVER?.toLowerCase()
  if (!NETWORK.TRUSTED_ATTESTER || !resolver) return null
  return {
    resolver,
    attester: NETWORK.TRUSTED_ATTESTER,
    schemaId: NETWORK.COMPLIANCE_SCHEMA_ID.toString(),
    name: null,
    contentCid: null,
    badgeIconCid: null
  }
}

/** Discover every certificate authority by enumerating schemas, then persist the result. */
export async function discoverCertificateAuthorities(): Promise<CertificateAuthority[]> {
  const registry = NETWORK.SCHEMA_REGISTRY
  const countRaw = await reviveCall(registry, encodeSchemaCount())
  const count = tryDecode({ success: true, returnData: countRaw }, decodeUint) ?? 0n
  if (count === 0n) return []

  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i))
  const schemaResults = await multicall(
    ids.map((id) => ({ target: registry, callData: encodeGetSchema(id) }))
  )
  // Candidate schemas are only those on the current compliance spec.
  const candidates = ids
    .map((_, i) => tryDecode(schemaResults[i], decodeSchemaRecord))
    .filter((s): s is NonNullable<typeof s> => !!s && s.schema === COMPLIANCE_SCHEMA_SPEC)
  if (candidates.length === 0) return []

  // Probe each candidate. `trustedAttester` confirms it is an authority resolver
  // and yields the attester. `countBySchema` gives the certified-product count.
  const probe: MulticallTarget[] = []
  for (const candidate of candidates) {
    probe.push({ target: candidate.resolver, callData: encodeTrustedAttester() })
    probe.push({ target: candidate.resolver, callData: encodeCountBySchema(candidate.id) })
  }
  const probeResults = await multicall(probe)

  // A resolver can index more than one schema version. Collapse to one row per
  // resolver, keeping the schema with the most attestations so the live,
  // populated version wins.
  const byResolver = new Map<string, CertificateAuthority>()
  for (let i = 0; i < candidates.length; i++) {
    const attester = tryDecode(probeResults[i * 2], decodeAddress)
    if (!attester || attester.toLowerCase() === ZERO_ADDRESS) continue
    const certifiedCount = Number(tryDecode(probeResults[i * 2 + 1], decodeUint) ?? 0n)
    const resolver = candidates[i].resolver.toLowerCase()
    const existing = byResolver.get(resolver)
    if (existing && (existing.certifiedCount ?? 0) >= certifiedCount) continue
    byResolver.set(resolver, {
      resolver,
      attester,
      schemaId: candidates[i].id.toString(),
      name: null,
      contentCid: null,
      badgeIconCid: null,
      certifiedCount
    })
  }
  const authorities = [...byResolver.values()]
  await sampleCertificateMetadata(authorities)

  // Always include the built-in authority, even if the schema scan missed it.
  const builtin = builtinCertificateAuthority()
  if (builtin && !authorities.some((a) => a.resolver === builtin.resolver)) {
    authorities.unshift(builtin)
  }

  hiddenLog(`Discovered ${authorities.length} certificate authorities`)
  await writeCertificateAuthorities(authorities)
  return authorities
}

/**
 * Fill each authority display field from one of its attestations, since name,
 * badge, and document live in attestation data rather than the schema.
 *
 * Mutates `authorities` in place.
 */
async function sampleCertificateMetadata(authorities: CertificateAuthority[]): Promise<void> {
  const withAttestations = authorities.filter((a) => (a.certifiedCount ?? 0) > 0)
  if (withAttestations.length === 0) return

  // One recipient per authority.
  const recipients = await multicall(
    withAttestations.map((authority) => ({
      target: authority.resolver as `0x${string}`,
      callData: encodeListBySchema(BigInt(authority.schemaId), 0n, 1n)
    }))
  )

  const sampleCalls: MulticallTarget[] = []
  const sampled: CertificateAuthority[] = []
  withAttestations.forEach((authority, i) => {
    const [recipient] = tryDecode(recipients[i], decodeAddressArray) ?? []
    if (!recipient) return
    const id = trustedAttestationId(
      authority.attester as `0x${string}`,
      recipient,
      BigInt(authority.schemaId)
    )
    sampleCalls.push({
      target: NETWORK.ATTESTATION_SERVICE,
      callData: encodeGetAttestationById(id)
    })
    sampled.push(authority)
  })
  if (sampleCalls.length === 0) return

  const attestations = await multicall(sampleCalls)
  sampled.forEach((authority, i) => {
    const decoded = tryDecode(attestations[i], decodeAttestation)
    if (!decoded) return
    Object.assign(authority, certificateIdentityFrom(decoded, authority.resolver))
  })
}

/**
 * Every known authority, the built-in one plus the discovered snapshot,
 * regardless of trust.
 *
 * The read path hydrates certificates for all of these so a badge is already
 * cached when the user enables its authority. Toggling is then pure display,
 * with no re-sync. Enabled authorities are this set filtered by the trusted set,
 * derived at the call site rather than in a separate query.
 */
export async function knownCertificateAuthorities(): Promise<CertificateAuthority[]> {
  const discovered = await readCertificateAuthorities()
  const byResolver = new Map<string, CertificateAuthority>()

  const builtin = builtinCertificateAuthority()
  if (builtin) byResolver.set(builtin.resolver, builtin)
  for (const authority of discovered) byResolver.set(authority.resolver.toLowerCase(), authority)

  return [...byResolver.values()]
}

export const CERTIFICATE_AUTHORITIES_KEY = ['certificate-authorities'] as const
export const KNOWN_CERTIFICATE_AUTHORITIES_KEY = ['certificate-authorities', 'known'] as const
export const SELECTED_CERTIFICATE_AUTHORITIES_KEY = ['selected-certificate-authorities'] as const

/** Every known authority from cache, the built-in one plus the discovered snapshot. */
export function useKnownCertificateAuthorities() {
  return useQuery<CertificateAuthority[]>({
    queryKey: KNOWN_CERTIFICATE_AUTHORITIES_KEY,
    queryFn: knownCertificateAuthorities,
    staleTime: Infinity
  })
}

/** All authorities for the manager, from discovery, falling back to the cached snapshot. */
export function useCertificateAuthorities() {
  return useQuery<CertificateAuthority[]>({
    queryKey: CERTIFICATE_AUTHORITIES_KEY,
    queryFn: async () => {
      try {
        return await discoverCertificateAuthorities()
      } catch {
        const cached = await readCertificateAuthorities()
        if (cached.length > 0) return cached
        const builtin = builtinCertificateAuthority()
        return builtin ? [builtin] : []
      }
    },
    staleTime: 5 * 60_000
  })
}

/** The user selected authority resolver set, lowercased. */
export function useSelectedCertificateAuthorities() {
  return useQuery<string[]>({
    queryKey: SELECTED_CERTIFICATE_AUTHORITIES_KEY,
    queryFn: readSelectedCertificateAuthorities,
    staleTime: Infinity
  })
}
