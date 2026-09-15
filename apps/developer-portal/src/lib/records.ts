/**
 * DotNS record reads for one label.
 *
 * A project is described by resolver records on its `<label>.dot` node: the
 * `manifest` text record, the legacy `name` and `description` text records,
 * and the root contenthash. One multicall batch reads all four.
 */

import {
  decodeBytes,
  decodeIpfsContenthash,
  decodeString,
  encodeContenthash,
  encodeText,
  MODALITIES,
  type Modality,
  type MulticallTarget,
  namehash,
  parseRootManifest,
  type RootManifest,
  tryDecode
} from '@parity/browse-sdk'
import { encodeFunctionData, parseAbi } from 'viem'

import type { Identity } from './account'
import { ensureBrowseSdk } from './chain'
import { NETWORK } from './config'
import { submitReviveCall, type TxResult } from './publisher'

export interface ProjectRecords {
  manifest: RootManifest | null
  /** Optional `version` field of the raw manifest JSON, outside the parsed shape. */
  manifestVersion: string | null
  name: string | null
  description: string | null
  contentHash: string | null
  /** Raw contenthash payload, kept so a revert can replay it byte for byte. */
  contentHashHex: `0x${string}` | null
}

/** Read the manifest, legacy name and description, and contenthash of a label. */
export async function readProjectRecords(label: string): Promise<ProjectRecords> {
  const node = namehash(`${label}.dot`)
  const resolver = NETWORK.CONTENT_RESOLVER
  const calls: MulticallTarget[] = [
    { target: resolver, callData: encodeText(node, 'manifest') },
    { target: resolver, callData: encodeText(node, 'name') },
    { target: resolver, callData: encodeText(node, 'description') },
    { target: resolver, callData: encodeContenthash(node) }
  ]
  const sdk = await ensureBrowseSdk()
  const [manifestRes, nameRes, descriptionRes, contenthashRes] = await sdk.multicall(calls)
  const rawManifest = tryDecode(manifestRes, decodeString) ?? ''
  const contentHashHex = tryDecode(contenthashRes, decodeBytes) as `0x${string}` | null
  return {
    manifest: parseRootManifest(rawManifest),
    manifestVersion: rawManifestVersion(rawManifest),
    name: tryDecode(nameRes, decodeString) || null,
    description: tryDecode(descriptionRes, decodeString) || null,
    contentHash: contentHashHex ? decodeIpfsContenthash(contentHashHex) : null,
    contentHashHex
  }
}

function rawManifestVersion(raw: string): string | null {
  try {
    const json = JSON.parse(raw) as Record<string, unknown>
    return typeof json.version === 'string' && json.version ? json.version : null
  } catch {
    return null
  }
}

const RESOLVER_WRITE_ABI = parseAbi([
  'function setText(bytes32 node, string key, string value)',
  'function setContenthash(bytes32 node, bytes hash)'
])

/** The metadata a save writes: the manifest fields, with the icon optional. */
export interface MetadataEdit {
  displayName: string
  description: string
  icon: RootManifest['icon'] | null
}

function describeRecordRevert(label: string): string {
  return `This account cannot edit the records of ${label}.dot.`
}

/**
 * Write the metadata records of a label, signed by the connected account.
 *
 * Writes the `$v: 1` manifest when an icon is available, then the legacy
 * `name` and `description` text records the browse client still reads. Each
 * record is one dry-run gated transaction. Returns the settled transactions
 * in order.
 */
export async function writeProjectMetadata(
  label: string,
  edit: MetadataEdit,
  identity: Identity
): Promise<TxResult[]> {
  const node = namehash(`${label}.dot`)
  const writes: `0x${string}`[] = []
  if (edit.icon) {
    const manifest: RootManifest = {
      $v: 1,
      displayName: edit.displayName,
      description: edit.description,
      icon: edit.icon
    }
    writes.push(
      encodeFunctionData({
        abi: RESOLVER_WRITE_ABI,
        functionName: 'setText',
        args: [node, 'manifest', JSON.stringify(manifest)]
      })
    )
  }
  writes.push(
    encodeFunctionData({
      abi: RESOLVER_WRITE_ABI,
      functionName: 'setText',
      args: [node, 'name', edit.displayName]
    }),
    encodeFunctionData({
      abi: RESOLVER_WRITE_ABI,
      functionName: 'setText',
      args: [node, 'description', edit.description]
    })
  )
  const results: TxResult[] = []
  for (const data of writes) {
    results.push(
      await submitReviveCall(NETWORK.CONTENT_RESOLVER, data, identity, () =>
        describeRecordRevert(label)
      )
    )
  }
  return results
}

/** Re-point the root contenthash of a label at a remembered CID hex payload. */
export async function writeContenthash(
  label: string,
  hashHex: `0x${string}`,
  identity: Identity
): Promise<TxResult> {
  const data = encodeFunctionData({
    abi: RESOLVER_WRITE_ABI,
    functionName: 'setContenthash',
    args: [namehash(`${label}.dot`), hashHex]
  })
  return submitReviveCall(NETWORK.CONTENT_RESOLVER, data, identity, () =>
    describeRecordRevert(label)
  )
}

export type ModalityContent = Record<Modality, string | null>

/**
 * Read the contenthash of each modality subname of a label.
 *
 * The convention is `<modality>.<label>.dot`, matching `listAppsByModality`
 * in the browse sdk. A subname without content maps to null.
 */
export async function readModalityContenthashes(label: string): Promise<ModalityContent> {
  const calls: MulticallTarget[] = MODALITIES.map((modality) => ({
    target: NETWORK.CONTENT_RESOLVER,
    callData: encodeContenthash(namehash(`${modality}.${label}.dot`))
  }))
  const sdk = await ensureBrowseSdk()
  const results = await sdk.multicall(calls)
  const out = {} as ModalityContent
  MODALITIES.forEach((modality, i) => {
    out[modality] = tryDecode(results[i], (data) => decodeIpfsContenthash(decodeBytes(data)))
  })
  return out
}
