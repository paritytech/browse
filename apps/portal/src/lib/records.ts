/**
 * DotNS record reads for one label.
 *
 * A project is described by resolver records on its `<label>.<tld>` node. The
 * `manifest` text record is the source of truth for display name, description,
 * and icon. The legacy `name` and `description` records are read only so a
 * label that predates the manifest still shows something. One multicall batch
 * reads all four, alongside the root contenthash.
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
import { fullName, submitReviveCall, type TxResult } from './publisher'

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
  const node = namehash(fullName(label))
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

/** The metadata a save writes. Every field is a manifest field. */
export interface MetadataEdit {
  displayName: string
  description: string
  icon: RootManifest['icon']
}

function describeRecordRevert(label: string): string {
  return `This account cannot edit the records of ${fullName(label)}.`
}

/**
 * Write the manifest of a label, signed by the connected account.
 *
 * The manifest holds the display name, description, and icon together, so one
 * dry-run gated transaction carries any change to any of them. The legacy
 * `name` and `description` text records are read for display on labels that
 * predate the manifest, never written.
 */
export async function writeProjectMetadata(
  label: string,
  edit: MetadataEdit,
  identity: Identity
): Promise<TxResult> {
  const manifest: RootManifest = {
    $v: 1,
    displayName: edit.displayName,
    description: edit.description,
    icon: edit.icon
  }
  const data = encodeFunctionData({
    abi: RESOLVER_WRITE_ABI,
    functionName: 'setText',
    args: [namehash(fullName(label)), 'manifest', JSON.stringify(manifest)]
  })
  return submitReviveCall(NETWORK.CONTENT_RESOLVER, data, identity, () =>
    describeRecordRevert(label)
  )
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
    args: [namehash(fullName(label)), hashHex]
  })
  return submitReviveCall(NETWORK.CONTENT_RESOLVER, data, identity, () =>
    describeRecordRevert(label)
  )
}

export type ModalityContent = Record<Modality, string | null>

/**
 * Read the contenthash of each modality subname of a label.
 *
 * The convention is `<modality>.<label>.<tld>`, matching `listAppsByModality`
 * in the browse sdk. A subname without content maps to null.
 */
export async function readModalityContenthashes(label: string): Promise<ModalityContent> {
  const calls: MulticallTarget[] = MODALITIES.map((modality) => ({
    target: NETWORK.CONTENT_RESOLVER,
    callData: encodeContenthash(namehash(`${modality}.${fullName(label)}`))
  }))
  const sdk = await ensureBrowseSdk()
  const results = await sdk.multicall(calls)
  const out = {} as ModalityContent
  MODALITIES.forEach((modality, i) => {
    out[modality] = tryDecode(results[i], (data) => decodeIpfsContenthash(decodeBytes(data)))
  })
  return out
}
