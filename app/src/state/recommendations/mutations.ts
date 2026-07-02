import { ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AccountId, type SS58String } from 'polkadot-api'

import { type LabelEntry, updateAttestationCount } from '../../db/labels'
import { encodeAttestationLabel, namehash, nodeToSubject } from '../../lib/abi'
import { attestationService } from '../../lib/attestation-service'
import { ACTIVE_SCHEMA_ID } from '../../lib/config'
import { resolveIdentityH160 } from '../apps/identity'
import { type AppEntry } from '../apps/types'

const ALL_KEY = ['apps', 'all'] as const
const LABELS_KEY = ['labels', 'db'] as const

function updateApp(
  apps: AppEntry[] | undefined,
  label: string,
  patch: (app: AppEntry) => AppEntry
): AppEntry[] | undefined {
  return apps?.map((app) => (app.label === label ? patch(app) : app))
}

function attestPatch(app: AppEntry): AppEntry {
  return {
    ...app,
    hasUserAttested: true,
    attestationCount: (app.attestationCount ?? 0) + 1
  }
}

function revokePatch(app: AppEntry): AppEntry {
  return {
    ...app,
    hasUserAttested: false,
    attestationCount: Math.max(0, (app.attestationCount ?? 0) - 1)
  }
}

type AttestationQueryData = { attestationCount: number; hasUserAttested: boolean }

function attestationKey(label: string) {
  return ['attestations', 'app', label] as const
}

function resolveLabelKey(label: string) {
  return ['resolveLabel', label] as const
}

type MutationCtx = {
  all: AppEntry[] | undefined
  attestation: AttestationQueryData | undefined
  labels: Map<string, LabelEntry> | undefined
  resolved: AppEntry | null | undefined
}

function snapshot(queryClient: ReturnType<typeof useQueryClient>, label: string): MutationCtx {
  return {
    all: queryClient.getQueryData<AppEntry[]>(ALL_KEY),
    attestation: queryClient.getQueryData<AttestationQueryData>(attestationKey(label)),
    labels: queryClient.getQueryData<Map<string, LabelEntry>>(LABELS_KEY),
    resolved: queryClient.getQueryData<AppEntry | null>(resolveLabelKey(label))
  }
}

function rollback(
  queryClient: ReturnType<typeof useQueryClient>,
  label: string,
  ctx: MutationCtx
): void {
  if (ctx.all !== undefined) queryClient.setQueryData(ALL_KEY, ctx.all)
  if (ctx.attestation !== undefined)
    queryClient.setQueryData(attestationKey(label), ctx.attestation)
  if (ctx.labels !== undefined) queryClient.setQueryData(LABELS_KEY, ctx.labels)
  if (ctx.resolved !== undefined) queryClient.setQueryData(resolveLabelKey(label), ctx.resolved)
}

/** Optimistically patch the resolved-search-result cache for one label. */
function patchResolved(
  queryClient: ReturnType<typeof useQueryClient>,
  label: string,
  patch: (app: AppEntry) => AppEntry
): void {
  queryClient.setQueryData<AppEntry | null>(resolveLabelKey(label), (prev) =>
    prev ? patch(prev) : prev
  )
}

/** Optimistically patch the labels-DB query cache for one label. */
function patchLabels(
  queryClient: ReturnType<typeof useQueryClient>,
  label: string,
  delta: 1 | -1,
  hasUserAttested: boolean
): void {
  queryClient.setQueryData<Map<string, LabelEntry>>(LABELS_KEY, (prev) => {
    if (!prev) return prev
    const existing = prev.get(label)
    if (!existing) return prev
    const next = new Map(prev)
    next.set(label, {
      ...existing,
      attestationCount: Math.max(0, (existing.attestationCount ?? 0) + delta),
      hasUserAttested
    })
    return next
  })
}

/**
 * Add or remove a label from the my-recommendations set for the caller identity.
 *
 * Matches every `['attestations', 'mine']` query so the recommend button toggles
 * at once instead of waiting for the enumeration to refetch.
 */
function patchMine(
  queryClient: ReturnType<typeof useQueryClient>,
  label: string,
  add: boolean
): void {
  queryClient.setQueriesData<Set<string>>({ queryKey: ['attestations', 'mine'] }, (prev) => {
    if (!prev) return prev
    const next = new Set(prev)
    if (add) next.add(label)
    else next.delete(label)
    return next
  })
}

/** Translate a raw chain/mutation error into a user-facing toast message. */
export function describeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('No DotNS username')) {
    return 'Allow reveal username'
  }
  // The resolver refuses a second recommendation from the same identity. Tell
  // the user it already counts rather than showing a generic failure.
  if (msg.includes('ResolverRejected')) {
    return 'Already recommended by you'
  }
  if (msg.includes('NotEnoughFunds') || msg.includes('"type": "Payment"')) {
    return 'Not enough allowance'
  }
  if (
    msg.includes('Chain sync timed out') ||
    msg.includes('No active follow') ||
    msg.includes('RpcError')
  ) {
    return 'Network unavailable'
  }
  return 'Failed'
}

export async function attestLabel(label: string, onPermitted?: () => void) {
  const recipient = nodeToSubject(namehash(`${label}.dot`))
  const data = encodeAttestationLabel(label)
  const account = await attestationService.productH160()
  // The first recommendation from an unbound account batches the identity
  // binding and the attestation into one tx. Later ones are a plain single attest.
  const bound = BigInt(await attestationService.boundIdentity(account)) !== 0n
  return bound
    ? attestationService.attest(ACTIVE_SCHEMA_ID, recipient, 0n, true, 0n, data, onPermitted)
    : attestationService.bindIdentityAndAttest(
        ACTIVE_SCHEMA_ID,
        recipient,
        0n,
        true,
        0n,
        data,
        onPermitted
      )
}

async function getAttesterH160(): Promise<string> {
  const { publicKey } = await attestationService.getSigner()
  const ss58 = AccountId().dec(publicKey) as SS58String
  return (ss58ToEthereum(ss58) as `0x${string}`).toLowerCase()
}

export async function revokeLabel(label: string, onPermitted?: () => void) {
  const recipient = nodeToSubject(namehash(`${label}.dot`))
  const ids = await attestationService.listByRecipientAndSchema(recipient, 0n, 100n)
  if (ids.length === 0) throw new Error('No attestation to revoke')

  const attesterH160 = await getAttesterH160()
  const attestations = await Promise.all(ids.map((id) => attestationService.getAttestationById(id)))
  const mine = attestations
    .map((a, i) => ({ schema: a.schema, id: ids[i], attester: a.attester }))
    .filter((a) => a.attester.toLowerCase() === attesterH160)
  if (mine.length === 0) {
    // The button is active because this identity recommended the app, but the
    // attestation was signed by a different product account of the same
    // identity, so there is nothing this account can revoke. Surface it as the
    // one-per-identity lock rather than a generic failure.
    const identity = await resolveIdentityH160()
    if (identity && (await attestationService.identityHasAttested(recipient, identity))) {
      throw new Error('AttestationService__ResolverRejected')
    }
    throw new Error('No attestation to revoke')
  }

  // Prefer the active schema so its one-per-identity lock is released and the
  // user can recommend again. Fall back to an older version.
  const chosen = mine.find((a) => a.schema === ACTIVE_SCHEMA_ID) ?? mine[0]
  return attestationService.revoke(chosen.schema, chosen.id, onPermitted)
}

export async function getAttestationId(label: string): Promise<bigint | null> {
  const recipient = nodeToSubject(namehash(`${label}.dot`))
  const ids = await attestationService.listByRecipientAndSchema(recipient, 0n, 100n)
  if (ids.length === 0) return null

  const attesterH160 = await getAttesterH160()
  const attestations = await Promise.all(ids.map((id) => attestationService.getAttestationById(id)))
  const idx = ids.findIndex((_, i) => attestations[i].attester.toLowerCase() === attesterH160)
  return idx === -1 ? null : ids[idx]
}

export function useAttestProduct() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, { label: string; onBroadcast?: () => void }, MutationCtx>({
    onMutate: ({ label }) => snapshot(queryClient, label),
    mutationFn: ({ label, onBroadcast }) =>
      attestLabel(label, () => {
        queryClient.setQueryData<AppEntry[]>(ALL_KEY, (prev) => updateApp(prev, label, attestPatch))
        queryClient.setQueryData<AttestationQueryData>(attestationKey(label), (prev) =>
          prev
            ? { attestationCount: prev.attestationCount + 1, hasUserAttested: true }
            : { attestationCount: 1, hasUserAttested: true }
        )
        patchLabels(queryClient, label, 1, true)
        patchResolved(queryClient, label, attestPatch)
        patchMine(queryClient, label, true)
        onBroadcast?.()
      }),
    onError: (_err, { label }, ctx) => {
      if (ctx) rollback(queryClient, label, ctx)
      void queryClient.invalidateQueries({ queryKey: ['attestations', 'mine'] })
    },
    onSuccess: (_data, { label }) => {
      void updateAttestationCount(label, 1, true)
    }
  })
}

export function useRevokeApp() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, { label: string; onBroadcast?: () => void }, MutationCtx>({
    onMutate: ({ label }) => snapshot(queryClient, label),
    mutationFn: ({ label, onBroadcast }) =>
      revokeLabel(label, () => {
        queryClient.setQueryData<AppEntry[]>(ALL_KEY, (prev) => updateApp(prev, label, revokePatch))
        queryClient.setQueryData<AttestationQueryData>(attestationKey(label), (prev) =>
          prev
            ? { attestationCount: Math.max(0, prev.attestationCount - 1), hasUserAttested: false }
            : { attestationCount: 0, hasUserAttested: false }
        )
        patchLabels(queryClient, label, -1, false)
        patchResolved(queryClient, label, revokePatch)
        patchMine(queryClient, label, false)
        onBroadcast?.()
      }),
    onError: (_err, { label }, ctx) => {
      if (ctx) rollback(queryClient, label, ctx)
      void queryClient.invalidateQueries({ queryKey: ['attestations', 'mine'] })
    },
    onSuccess: (_data, { label }) => {
      void updateAttestationCount(label, -1, false)
    }
  })
}
