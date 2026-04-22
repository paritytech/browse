import { decode as decodeContentHashLib, getCodec } from '@ensdomains/content-hash'
import { keccak_256 } from '@noble/hashes/sha3.js'

function toHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

function uint256Hex(n: number | bigint): string {
  return BigInt(n).toString(16).padStart(64, '0')
}

function padRight(hex: string, byteLen: number): string {
  return hex.padEnd(byteLen * 2, '0')
}

function stripPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex
}

function hexToBytes(hex: string): Uint8Array {
  const h = stripPrefix(hex)
  const bytes = new Uint8Array(h.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export function namehash(name: string): `0x${string}` {
  let node = new Uint8Array(32)
  if (name === '') return toHex(node)
  const labels = name.split('.').reverse()
  for (const label of labels) {
    const labelHash = keccak_256(new TextEncoder().encode(label))
    const combined = new Uint8Array(64)
    combined.set(node, 0)
    combined.set(labelHash, 32)
    node = new Uint8Array(keccak_256(combined))
  }
  return toHex(node)
}

function computeSelector(sig: string): string {
  const hash = keccak_256(new TextEncoder().encode(sig))
  return toHex(hash.slice(0, 4)).slice(2)
}

const SEL = {
  getAllDeployedStores: computeSelector('getAllDeployedStores()'),
  getValues: computeSelector('getValues()'),
  contenthash: computeSelector('contenthash(bytes32)'),
  text: computeSelector('text(bytes32,string)'),
  aggregate3: computeSelector('aggregate3((address,bool,bytes)[])'),
  countByRecipientAndSchema: computeSelector('countByRecipientAndSchema(address,uint256)'),
  isActiveAny: computeSelector('isActiveAny(address,uint256,address[])'),
  owner: computeSelector('owner()')
} as const

export function encodeGetAllDeployedStores(): `0x${string}` {
  return `0x${SEL.getAllDeployedStores}`
}

export function encodeOwner(): `0x${string}` {
  return `0x${SEL.owner}`
}

export function encodeGetValues(): `0x${string}` {
  return `0x${SEL.getValues}`
}

export function encodeContenthash(node: `0x${string}`): `0x${string}` {
  return `0x${SEL.contenthash}${stripPrefix(node).padStart(64, '0')}`
}

export function encodeText(node: `0x${string}`, key: string): `0x${string}` {
  const nodeHex = stripPrefix(node).padStart(64, '0')
  const offset = uint256Hex(64)

  const keyBytes = new TextEncoder().encode(key)
  const keyHex = Array.from(keyBytes, (b) => b.toString(16).padStart(2, '0')).join('')
  const paddedKeyLen = Math.ceil(keyBytes.length / 32) * 32
  const keyEncoded = uint256Hex(keyBytes.length) + padRight(keyHex, paddedKeyLen)

  return `0x${SEL.text}${nodeHex}${offset}${keyEncoded}`
}

export interface MulticallTarget {
  target: string
  callData: `0x${string}`
}

export function encodeAggregate3(calls: MulticallTarget[]): `0x${string}` {
  const n = calls.length

  let result = SEL.aggregate3 + uint256Hex(32)
  result += uint256Hex(n)

  const encodedElements: string[] = []
  for (const call of calls) {
    const addr = stripPrefix(call.target).toLowerCase().padStart(64, '0')
    const allow = uint256Hex(1)
    const bytesOffset = uint256Hex(96)

    const callDataHex = stripPrefix(call.callData)
    const callDataBytes = callDataHex.length / 2
    const paddedLen = Math.ceil(callDataBytes / 32) * 32
    const bytesEncoded = uint256Hex(callDataBytes) + padRight(callDataHex, paddedLen)

    encodedElements.push(addr + allow + bytesOffset + bytesEncoded)
  }

  let currentOffset = n * 32
  for (const elem of encodedElements) {
    result += uint256Hex(currentOffset)
    currentOffset += elem.length / 2
  }

  for (const elem of encodedElements) {
    result += elem
  }

  return `0x${result}`
}

export function decodeAddress(data: `0x${string}`): string {
  const hex = stripPrefix(data)
  return '0x' + hex.slice(24, 64)
}

export function decodeAddressArray(data: `0x${string}`): string[] {
  const hex = stripPrefix(data)
  if (hex.length < 128) return []

  const offset = parseInt(hex.slice(0, 64), 16) * 2
  const length = parseInt(hex.slice(offset, offset + 64), 16)
  const addresses: string[] = []

  for (let i = 0; i < length; i++) {
    const start = offset + 64 + i * 64
    addresses.push('0x' + hex.slice(start + 24, start + 64))
  }

  return addresses
}

export function decodeStringArray(data: `0x${string}`): string[] {
  const hex = stripPrefix(data)
  if (hex.length < 128) return []

  const arrayOffset = parseInt(hex.slice(0, 64), 16) * 2
  const length = parseInt(hex.slice(arrayOffset, arrayOffset + 64), 16)
  const strings: string[] = []

  for (let i = 0; i < length; i++) {
    const offsetPos = arrayOffset + 64 + i * 64
    const strOffset = parseInt(hex.slice(offsetPos, offsetPos + 64), 16) * 2
    const strStart = arrayOffset + 64 + strOffset
    const strLen = parseInt(hex.slice(strStart, strStart + 64), 16)

    if (strLen === 0) {
      strings.push('')
      continue
    }

    const strHex = hex.slice(strStart + 64, strStart + 64 + strLen * 2)
    strings.push(new TextDecoder().decode(hexToBytes(strHex)))
  }

  return strings
}

export function decodeBytes(data: `0x${string}`): `0x${string}` {
  const hex = stripPrefix(data)
  if (hex.length < 128) return '0x'
  const offset = parseInt(hex.slice(0, 64), 16) * 2
  const length = parseInt(hex.slice(offset, offset + 64), 16) * 2
  return `0x${hex.slice(offset + 64, offset + 64 + length)}`
}

export function decodeString(data: `0x${string}`): string {
  const hex = stripPrefix(data)
  if (hex.length < 128) return ''
  const offset = parseInt(hex.slice(0, 64), 16) * 2
  const strLen = parseInt(hex.slice(offset, offset + 64), 16)
  if (strLen === 0) return ''
  const strHex = hex.slice(offset + 64, offset + 64 + strLen * 2)
  return new TextDecoder().decode(hexToBytes(strHex))
}

export interface AggregateResult {
  success: boolean
  returnData: `0x${string}`
}

export function decodeAggregate3Result(data: `0x${string}`): AggregateResult[] {
  const hex = stripPrefix(data)
  if (hex.length < 128) return []

  const arrayOffset = parseInt(hex.slice(0, 64), 16) * 2
  const length = parseInt(hex.slice(arrayOffset, arrayOffset + 64), 16)
  const results: AggregateResult[] = []

  for (let i = 0; i < length; i++) {
    const offsetPos = arrayOffset + 64 + i * 64
    const elemOffset = parseInt(hex.slice(offsetPos, offsetPos + 64), 16) * 2
    const elemStart = arrayOffset + 64 + elemOffset

    const success = parseInt(hex.slice(elemStart, elemStart + 64), 16) !== 0
    const bytesOffset = parseInt(hex.slice(elemStart + 64, elemStart + 128), 16) * 2
    const bytesStart = elemStart + bytesOffset
    const bytesLen = parseInt(hex.slice(bytesStart, bytesStart + 64), 16) * 2
    const returnData = hex.slice(bytesStart + 64, bytesStart + 64 + bytesLen)

    results.push({
      success,
      returnData: `0x${returnData}`
    })
  }

  return results
}

export function nodeToSubject(node: `0x${string}`): `0x${string}` {
  const hex = stripPrefix(node).padStart(64, '0')
  return `0x${hex.slice(24)}`
}

export function encodeCountByRecipientAndSchema(
  recipient: `0x${string}`,
  schemaId: bigint
): `0x${string}` {
  return `0x${SEL.countByRecipientAndSchema}${stripPrefix(recipient).padStart(64, '0')}${uint256Hex(schemaId)}`
}

export function encodeIsActiveAny(
  recipient: `0x${string}`,
  schemaId: bigint,
  attesters: `0x${string}`[]
): `0x${string}` {
  // head: recipient(32) + schemaId(32) + offset-to-array(32) = 96 bytes
  const recipientPadded = stripPrefix(recipient).toLowerCase().padStart(64, '0')
  const schemaPadded = uint256Hex(schemaId)
  const arrayOffset = uint256Hex(96)
  const length = uint256Hex(attesters.length)
  const addresses = attesters.map((a) => stripPrefix(a).toLowerCase().padStart(64, '0')).join('')
  return `0x${SEL.isActiveAny}${recipientPadded}${schemaPadded}${arrayOffset}${length}${addresses}`
}

export function decodeUint64(data: `0x${string}`): number | null {
  const hex = stripPrefix(data)
  if (hex.length < 64) return null
  return Number(BigInt('0x' + hex.slice(48, 64)))
}

export function decodeBool(data: `0x${string}`): boolean {
  const hex = stripPrefix(data)
  if (hex.length < 64) return false
  return BigInt('0x' + hex.slice(0, 64)) !== 0n
}

export function decodeIpfsContenthash(contenthashHex: string): string | null {
  const hex = stripPrefix(contenthashHex)
  if (!hex || hex === '0' || hex.length < 4) return null
  try {
    if (getCodec(hex) !== 'ipfs') return null
    return decodeContentHashLib(hex) || null
  } catch {
    return null
  }
}
