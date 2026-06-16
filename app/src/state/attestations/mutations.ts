import { ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AccountId, type SS58String } from 'polkadot-api'

import { type LabelEntry, updateAttestationCount } from '../../db/labels'
import { encodeAttestationLabel, namehash, nodeToSubject } from '../../lib/abi'
import { attestationService } from '../../lib/attestation-service'
import { NETWORK } from '../../lib/config'
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

type MutationCtx = {
  all: AppEntry[] | undefined
  attestation: AttestationQueryData | undefined
  labels: Map<string, LabelEntry> | undefined
}

function snapshot(queryClient: ReturnType<typeof useQueryClient>, label: string): MutationCtx {
  return {
    all: queryClient.getQueryData<AppEntry[]>(ALL_KEY),
    attestation: queryClient.getQueryData<AttestationQueryData>(attestationKey(label)),
    labels: queryClient.getQueryData<Map<string, LabelEntry>>(LABELS_KEY)
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

/** Translate a raw chain/mutation error into a user-facing toast message. */
export function describeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
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
  try {
    return await attestationService.attest(
      NETWORK.SCHEMA_ID,
      recipient,
      0n,
      true,
      0n,
      data,
      onPermitted
    )
  } catch (err) {
    console.error('[attestLabel] failed for', label, err)
    throw err
  }
}

async function getAttesterH160(): Promise<string> {
  const { publicKey } = await attestationService.getSigner()
  const ss58 = AccountId().dec(publicKey) as SS58String
  return (ss58ToEthereum(ss58) as `0x${string}`).toLowerCase()
}

export async function revokeLabel(label: string, onPermitted?: () => void) {
  try {
    const recipient = nodeToSubject(namehash(`${label}.dot`))
    const ids = await attestationService.listByRecipientAndSchema(
      recipient,
      NETWORK.SCHEMA_ID,
      0n,
      100n
    )
    if (ids.length === 0) throw new Error('No attestation to revoke')

    const attesterH160 = await getAttesterH160()
    const attestations = await Promise.all(
      ids.map((id) => attestationService.getAttestationById(id))
    )
    const match = ids.find((_, i) => attestations[i].attester.toLowerCase() === attesterH160)
    if (match === undefined) throw new Error('No attestation to revoke')

    return await attestationService.revoke(NETWORK.SCHEMA_ID, match, onPermitted)
  } catch (err) {
    console.error('[revokeLabel] failed for', label, err)
    throw err
  }
}

export async function getAttestationId(label: string): Promise<bigint | null> {
  const recipient = nodeToSubject(namehash(`${label}.dot`))
  const ids = await attestationService.listByRecipientAndSchema(
    recipient,
    NETWORK.SCHEMA_ID,
    0n,
    100n
  )
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
        onBroadcast?.()
      }),
    onError: (_err, { label }, ctx) => {
      if (ctx) rollback(queryClient, label, ctx)
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
        onBroadcast?.()
      }),
    onError: (_err, { label }, ctx) => {
      if (ctx) rollback(queryClient, label, ctx)
    },
    onSuccess: (_data, { label }) => {
      void updateAttestationCount(label, -1, false)
    }
  })
}
