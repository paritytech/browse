import { decode as decodeContentHashLib, getCodec } from '@ensdomains/content-hash'

/**
 * Decode an ENS-style contenthash blob into its IPFS CID string.
 *
 * Returns `null` for empty data, non-IPFS codecs, or any decode failure.
 */
export function decodeIpfsContenthash(contenthashHex: string): string | null {
  const hex = contenthashHex.startsWith('0x') ? contenthashHex.slice(2) : contenthashHex
  if (!hex || hex === '0' || hex.length < 4) return null
  try {
    if (getCodec(hex) !== 'ipfs') return null
    return decodeContentHashLib(hex) || null
  } catch {
    return null
  }
}
