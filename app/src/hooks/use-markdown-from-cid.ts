import { useEffect, useState } from 'preact/hooks'

import { preimageManager } from '@novasamatech/host-api-wrapper'

import { cidToBlake2b256DigestHex } from '../state/apps/icon'

export interface UseMarkdownResult {
  text: string | null
  failed: boolean
}

// Without an embedding host the preimage lookup never resolves, so this bounds
// the wait before the section is hidden.
const PREIMAGE_TIMEOUT_MS = 3000

/**
 * Fetch UTF-8 markdown stored at a `CIDv1(raw, blake2b-256)` via the host
 * preimage manager, the same path icons use.
 *
 * `failed` lets callers hide the section when the host is absent, the lookup is
 * interrupted, or the CID is malformed.
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

    let key: `0x${string}`
    try {
      key = cidToBlake2b256DigestHex(cid)
    } catch {
      // Legacy or malformed CID: nothing to look up.
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
