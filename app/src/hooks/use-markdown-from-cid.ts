import { useEffect, useState } from 'preact/hooks'

import { preimageManager } from '@novasamatech/host-api-wrapper'

import { NETWORK } from '../lib/config'
import { cidToBlake2b256DigestHex } from '../state/apps/icon'

export interface UseMarkdownResult {
  text: string | null
  failed: boolean
}

// How long to wait for the host preimage manager before falling back to the
// IPFS gateway. Standalone (no embedding host) the lookup never resolves, so the
// gateway is the only path.
const PREIMAGE_TIMEOUT_MS = 1500

/**
 * Fetch UTF-8 markdown stored at a `CIDv1(raw, blake2b-256)`.
 *
 * Prefers the host preimage manager (the same path icons use), then falls back
 * to the network IPFS gateway when the host is absent or the lookup is
 * interrupted. `failed` lets callers hide the section.
 */
export function useMarkdownFromCid(cid: string | null): UseMarkdownResult {
  const [text, setText] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setText(null)
    setFailed(false)
    if (!cid) return

    let done = false
    const finish = (value: string | null) => {
      if (done) return
      done = true
      if (value === null) setFailed(true)
      else setText(value)
    }

    async function fetchGateway() {
      try {
        const res = await fetch(`${NETWORK.IPFS_GATEWAY}/ipfs/${cid}`)
        finish(res.ok ? await res.text() : null)
      } catch {
        finish(null)
      }
    }

    let key: `0x${string}` | null = null
    try {
      key = cidToBlake2b256DigestHex(cid)
    } catch {
      // Legacy/malformed CID: skip the preimage path and try the gateway.
    }

    const subscription = key
      ? preimageManager.lookup(key, (bytes) => {
          if (bytes) finish(new TextDecoder().decode(bytes))
        })
      : null
    subscription?.onInterrupt(() => {
      if (!done) void fetchGateway()
    })

    const timer = setTimeout(() => {
      if (!done) void fetchGateway()
    }, PREIMAGE_TIMEOUT_MS)

    return () => {
      done = true
      clearTimeout(timer)
      subscription?.unsubscribe()
    }
  }, [cid])

  return { text, failed }
}
