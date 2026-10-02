/**
 * Product icon loading through the host preimage bridge.
 *
 * Icons are `CIDv1(raw, blake2b-256)` blocks on Bulletin, resolved by digest
 * through the host rather than fetched over HTTP. Ported from the browse
 * client.
 */

import { useEffect, useState } from 'preact/hooks'

import type { IconFormat } from '@parity/browse-sdk'
import { getPreimageManager, type HostSubscription } from '@parity/product-sdk/host'

const BLAKE2B_256_RAW_CIDV1_PREFIX = new Uint8Array([0x01, 0x55, 0xa0, 0xe4, 0x02, 0x20])
const DIGEST_BYTES = 32
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

function base32Decode(s: string): Uint8Array {
  const out: number[] = []
  let bits = 0
  let buf = 0
  for (let i = 0; i < s.length; i++) {
    const v = BASE32_ALPHABET.indexOf(s[i])
    if (v < 0) throw new Error(`Invalid base32 character: ${s[i]}`)
    buf = (buf << 5) | v
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((buf >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

/** Decode a base32 CIDv1 and return its blake2b-256 digest as a hex preimage key. */
export function cidToBlake2b256DigestHex(cid: string): `0x${string}` {
  if (!cid.startsWith('b')) throw new Error('CID is not a base32 CIDv1')
  const bytes = base32Decode(cid.slice(1))
  if (bytes.length !== BLAKE2B_256_RAW_CIDV1_PREFIX.length + DIGEST_BYTES) {
    throw new Error('unexpected CID length')
  }
  for (let i = 0; i < BLAKE2B_256_RAW_CIDV1_PREFIX.length; i++) {
    if (bytes[i] !== BLAKE2B_256_RAW_CIDV1_PREFIX[i]) {
      throw new Error('CID is not CIDv1(raw, blake2b-256)')
    }
  }
  const digest = bytes.slice(BLAKE2B_256_RAW_CIDV1_PREFIX.length)
  let hex = '0x'
  for (let i = 0; i < digest.length; i++) hex += digest[i].toString(16).padStart(2, '0')
  return hex as `0x${string}`
}

/** Encode a blake2b-256 digest hex as the base32 `CIDv1(raw, blake2b-256)`. */
export function digestHexToCid(digestHex: string): string {
  const hex = digestHex.replace(/^0x/, '')
  const bytes = [...BLAKE2B_256_RAW_CIDV1_PREFIX]
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16))
  let bits = 0
  let buf = 0
  let out = 'b'
  for (const byte of bytes) {
    buf = (buf << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += BASE32_ALPHABET[(buf >> bits) & 31]
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(buf << (5 - bits)) & 31]
  return out
}

interface UseIconBlobResult {
  url: string | null
  failed: boolean
}

/**
 * Resolve an icon CID to a Blob URL for `<img src>`.
 *
 * Stays `null` until the preimage resolves. Callers render their fallback
 * while the URL is null or after failure.
 */
export function useIconBlob(cid: string | null, format?: IconFormat): UseIconBlobResult {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setUrl(null)
    setFailed(false)
    if (!cid) return

    let key: `0x${string}`
    try {
      key = cidToBlake2b256DigestHex(cid)
    } catch {
      setFailed(true)
      return
    }

    let currentBlobUrl: string | null = null
    let resolved = false
    let cancelled = false
    let subscription: HostSubscription | undefined
    const mime = format ? `image/${format}` : undefined

    void getPreimageManager().then((manager) => {
      if (cancelled) return
      if (!manager) {
        setFailed(true)
        return
      }
      subscription = manager.lookup(key, (bytes) => {
        if (resolved || !bytes) return
        resolved = true
        const buf = new ArrayBuffer(bytes.byteLength)
        new Uint8Array(buf).set(bytes)
        const blob = mime ? new Blob([buf], { type: mime }) : new Blob([buf])
        currentBlobUrl = URL.createObjectURL(blob)
        setUrl(currentBlobUrl)
        subscription?.unsubscribe()
      })
      subscription.onInterrupt(() => {
        if (!resolved) setFailed(true)
      })
    })

    return () => {
      cancelled = true
      subscription?.unsubscribe()
      if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl)
    }
  }, [cid, format])

  return { url, failed }
}
