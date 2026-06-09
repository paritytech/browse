import { useEffect, useState } from 'preact/hooks'

import { preimageManager } from '@novasamatech/host-api-wrapper'

import type { IconFormat } from './manifest'

// CIDv1 prefix for (codec=raw 0x55, multihash=blake2b-256 0xb220, digest length=32)
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

function toHexPrefixed(bytes: Uint8Array): `0x${string}` {
  let hex = '0x'
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return hex as `0x${string}`
}

/**
 * Decode a base32 CIDv1 and assert it is `CIDv1(raw, blake2b-256, 32-byte
 * digest)`, returning the digest as a hex string suitable for the host preimage.
 */
export function cidToBlake2b256DigestHex(cid: string): `0x${string}` {
  if (!cid.startsWith('b')) {
    throw new Error('icon CID is not a base32 CIDv1 (expected "b…" multibase prefix)')
  }
  const bytes = base32Decode(cid.slice(1))
  if (bytes.length !== BLAKE2B_256_RAW_CIDV1_PREFIX.length + DIGEST_BYTES) {
    throw new Error(
      `icon CID decoded to ${bytes.length} bytes, expected ${BLAKE2B_256_RAW_CIDV1_PREFIX.length + DIGEST_BYTES}`
    )
  }
  for (let i = 0; i < BLAKE2B_256_RAW_CIDV1_PREFIX.length; i++) {
    if (bytes[i] !== BLAKE2B_256_RAW_CIDV1_PREFIX[i]) {
      throw new Error(
        `icon CID is not CIDv1(raw, blake2b-256): byte ${i} = 0x${bytes[i].toString(16).padStart(2, '0')}, ` +
          `expected 0x${BLAKE2B_256_RAW_CIDV1_PREFIX[i].toString(16).padStart(2, '0')}`
      )
    }
  }
  return toHexPrefixed(bytes.slice(BLAKE2B_256_RAW_CIDV1_PREFIX.length))
}

interface UseIconBlobResult {
  url: string | null
  failed: boolean
  markFailed: () => void
}

/**
 * Fetch a product icon via the host preimage manager and expose it as a
 * Blob URL suitable for `<img src>`.
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
      // Legacy sha-256 CID, malformed CID, or any other shape the host SDK
      // can't resolve.
      setFailed(true)
      return
    }

    let currentBlobUrl: string | null = null
    let resolved = false
    const mime = format ? `image/${format}` : undefined

    const subscription = preimageManager.lookup(key, (bytes) => {
      if (resolved) return
      if (!bytes) return
      resolved = true
      // Copy into a fresh ArrayBuffer.
      const buf = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(buf).set(bytes)
      const blob = mime ? new Blob([buf], { type: mime }) : new Blob([buf])
      currentBlobUrl = URL.createObjectURL(blob)
      setUrl(currentBlobUrl)
      subscription.unsubscribe()
    })

    subscription.onInterrupt(() => {
      if (resolved) return
      setFailed(true)
    })

    return () => {
      subscription.unsubscribe()
      if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl)
    }
  }, [cid, format])

  return {
    url,
    failed,
    markFailed: () => setFailed(true)
  }
}
