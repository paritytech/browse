import { ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AccountId, type SS58String } from 'polkadot-api'

import { namehash, nodeToSubject } from '../../lib/abi'
import { attestationService } from '../../lib/attestation-service'
import { BACKEND } from '../../lib/config'
import { type AppEntry } from '../apps/types'

const PCF_KEY = ['apps', 'pcf'] as const
const ALL_KEY = ['apps', 'all'] as const

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
  pcf: AppEntry[] | undefined
  all: AppEntry[] | undefined
  attestation: AttestationQueryData | undefined
}

function snapshot(queryClient: ReturnType<typeof useQueryClient>, label: string): MutationCtx {
  return {
    pcf: queryClient.getQueryData<AppEntry[]>(PCF_KEY),
    all: queryClient.getQueryData<AppEntry[]>(ALL_KEY),
    attestation: queryClient.getQueryData<AttestationQueryData>(attestationKey(label))
  }
}

function rollback(
  queryClient: ReturnType<typeof useQueryClient>,
  label: string,
  ctx: MutationCtx
): void {
  if (ctx.pcf !== undefined) queryClient.setQueryData(PCF_KEY, ctx.pcf)
  if (ctx.all !== undefined) queryClient.setQueryData(ALL_KEY, ctx.all)
  if (ctx.attestation !== undefined)
    queryClient.setQueryData(attestationKey(label), ctx.attestation)
}

export function describeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('NotEnoughFunds') || msg.includes('"type": "Payment"')) {
    return 'Not enough funds'
  }
  return 'Failed'
}

export async function attestLabel(label: string, onPermitted?: () => void) {
  const recipient = nodeToSubject(namehash(`${label}.dot`))
  return attestationService.attest(BACKEND.SCHEMA_ID, recipient, 0n, true, 0n, '0x', onPermitted)
}

async function getAttesterH160(): Promise<string> {
  const { publicKey } = await attestationService.getSigner()
  const ss58 = AccountId().dec(publicKey)
  return (ss58ToEthereum(ss58 as SS58String) as `0x${string}`).toLowerCase()
}

export async function revokeLabel(label: string, onPermitted?: () => void) {
  const recipient = nodeToSubject(namehash(`${label}.dot`))
  const ids = await attestationService.listByRecipientAndSchema(
    recipient,
    BACKEND.SCHEMA_ID,
    0n,
    100n
  )
  if (ids.length === 0) throw new Error('No attestation to revoke')

  const attesterH160 = await getAttesterH160()
  const attestations = await Promise.all(ids.map((id) => attestationService.getAttestationById(id)))
  const match = ids.find((_, i) => attestations[i].attester.toLowerCase() === attesterH160)
  if (match === undefined) throw new Error('No attestation to revoke')

  return attestationService.revoke(BACKEND.SCHEMA_ID, match, onPermitted)
}

export async function getAttestationId(label: string): Promise<bigint | null> {
  const recipient = nodeToSubject(namehash(`${label}.dot`))
  const ids = await attestationService.listByRecipientAndSchema(
    recipient,
    BACKEND.SCHEMA_ID,
    0n,
    100n
  )
  if (ids.length === 0) return null

  const attesterH160 = await getAttesterH160()
  const attestations = await Promise.all(ids.map((id) => attestationService.getAttestationById(id)))
  const idx = ids.findIndex((_, i) => attestations[i].attester.toLowerCase() === attesterH160)
  return idx === -1 ? null : ids[idx]
}

export function useAttestApp() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, string, MutationCtx>({
    mutationFn: (label) =>
      attestLabel(label, () => {
        queryClient.setQueryData<AppEntry[]>(PCF_KEY, (prev) => updateApp(prev, label, attestPatch))
        queryClient.setQueryData<AppEntry[]>(ALL_KEY, (prev) => updateApp(prev, label, attestPatch))
        queryClient.setQueryData<AttestationQueryData>(attestationKey(label), (prev) =>
          prev
            ? { attestationCount: prev.attestationCount + 1, hasUserAttested: true }
            : { attestationCount: 1, hasUserAttested: true }
        )
      }),
    onMutate: (label) => snapshot(queryClient, label),
    onError: (_err, label, ctx) => {
      if (ctx) rollback(queryClient, label, ctx)
    }
  })
}

export function useRevokeApp() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, string, MutationCtx>({
    mutationFn: (label) =>
      revokeLabel(label, () => {
        queryClient.setQueryData<AppEntry[]>(PCF_KEY, (prev) => updateApp(prev, label, revokePatch))
        queryClient.setQueryData<AppEntry[]>(ALL_KEY, (prev) => updateApp(prev, label, revokePatch))
        queryClient.setQueryData<AttestationQueryData>(attestationKey(label), (prev) =>
          prev
            ? { attestationCount: Math.max(0, prev.attestationCount - 1), hasUserAttested: false }
            : { attestationCount: 0, hasUserAttested: false }
        )
      }),
    onMutate: (label) => snapshot(queryClient, label),
    onError: (_err, label, ctx) => {
      if (ctx) rollback(queryClient, label, ctx)
    }
  })
}
