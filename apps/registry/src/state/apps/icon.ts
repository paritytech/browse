import { useEffect, useState } from 'preact/hooks'

import { cidToBlake2b256DigestHex } from '@parity/browse-sdk/snapshots'
import { getPreimageManager, type HostSubscription } from '@parity/product-sdk/host'

import type { IconFormat } from './manifest'

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
    let cancelled = false
    let subscription: HostSubscription | undefined
    const mime = format ? `image/${format}` : undefined

    void getPreimageManager().then((preimageManager) => {
      if (cancelled) return
      if (!preimageManager) {
        setFailed(true)
        return
      }
      subscription = preimageManager.lookup(key, (bytes) => {
        if (resolved) return
        if (!bytes) return
        resolved = true
        // Copy into a fresh ArrayBuffer.
        const buf = new ArrayBuffer(bytes.byteLength)
        new Uint8Array(buf).set(bytes)
        const blob = mime ? new Blob([buf], { type: mime }) : new Blob([buf])
        currentBlobUrl = URL.createObjectURL(blob)
        setUrl(currentBlobUrl)
        subscription?.unsubscribe()
      })
      subscription.onInterrupt(() => {
        if (resolved) return
        setFailed(true)
      })
    })

    return () => {
      cancelled = true
      subscription?.unsubscribe()
      if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl)
    }
  }, [cid, format])

  return {
    url,
    failed,
    markFailed: () => setFailed(true)
  }
}
