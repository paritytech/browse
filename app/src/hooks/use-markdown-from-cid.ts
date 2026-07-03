import { useEffect, useState } from 'preact/hooks'

import { preimageManager } from '@novasamatech/host-api-wrapper'

import { cidToBlake2b256DigestHex } from '../state/apps/icon'

export interface UseMarkdownResult {
  text: string | null
  failed: boolean
}

// How long to wait for the host preimage manager before giving up. Without an
// embedding host the lookup never resolves, so this bounds the wait.
const PREIMAGE_TIMEOUT_MS = 3000

/**
 * Fetch UTF-8 markdown stored at a `CIDv1(raw, blake2b-256)` via the host
 * preimage manager, the same path icons use. `failed` lets callers hide the
 * section when the host is absent or the lookup is interrupted.
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

    let key: `0x${string}` | null = null
    try {
      key = cidToBlake2b256DigestHex(cid)
    } catch {
      // Legacy/malformed CID: nothing to look up.
    }

    if (!key) {
      finish(null)
      return
    }

    const subscription = preimageManager.lookup(key, (bytes) => {
      if (bytes) finish(new TextDecoder().decode(bytes))
    })
    subscription.onInterrupt(() => finish(null))

    const timer = setTimeout(() => finish(null), PREIMAGE_TIMEOUT_MS)

    return () => {
      done = true
      clearTimeout(timer)
      subscription.unsubscribe()
    }
  }, [cid])

  return { text, failed }
}
