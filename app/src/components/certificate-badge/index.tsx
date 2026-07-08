import { useEffect, useState } from 'preact/hooks'

import { preimageManager } from '@novasamatech/host-api-wrapper'
import { BadgeCheck } from 'lucide-preact'

import { cidToBlake2b256DigestHex } from '../../state/apps/icon'
import './styles.css'

// One authority badge image repeats across every certified card, the badge pill,
// and the modal. Resolve each CID blob URL once and share it for the session, so
// a badge is fetched from the preimage host a single time rather than per mount.
// Distinct badge CIDs are few, so the un-revoked blob URLs are bounded.
const badgeUrlCache = new Map<string, string | null>()
const badgeInflight = new Map<string, Promise<string | null>>()

function loadBadge(cid: string): Promise<string | null> {
  const cached = badgeUrlCache.get(cid)
  if (cached !== undefined) return Promise.resolve(cached)
  const existing = badgeInflight.get(cid)
  if (existing) return existing

  const promise = new Promise<string | null>((resolve) => {
    let key: `0x${string}`
    try {
      key = cidToBlake2b256DigestHex(cid)
    } catch {
      resolve(null)
      return
    }
    let done = false
    const finish = (url: string | null) => {
      if (done) return
      done = true
      subscription.unsubscribe()
      badgeUrlCache.set(cid, url)
      badgeInflight.delete(cid)
      resolve(url)
    }
    const subscription = preimageManager.lookup(key, (bytes) => {
      if (!bytes) return
      const buffer = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(buffer).set(bytes)
      // A typeless blob won't render as SVG (browsers need the MIME to parse
      // markup); raster formats sniff fine. Detect a leading '<' for SVG/XML.
      const isMarkup = bytes[0] === 0x3c
      const blob = isMarkup ? new Blob([buffer], { type: 'image/svg+xml' }) : new Blob([buffer])
      finish(URL.createObjectURL(blob))
    })
    subscription.onInterrupt(() => finish(null))
  })
  badgeInflight.set(cid, promise)
  return promise
}

interface CertificateBadgeProps {
  /** Badge image CID from the attestation; a generic mark shows when absent. */
  cid: string | null
  size?: number
}

/** A certificate badge, the stored image cached per CID, or a generic mark. */
export function CertificateBadge({ cid, size = 14 }: CertificateBadgeProps) {
  const [url, setUrl] = useState<string | null>(() =>
    cid ? (badgeUrlCache.get(cid) ?? null) : null
  )

  useEffect(() => {
    if (!cid) {
      setUrl(null)
      return
    }
    // Cache hit renders synchronously; a miss resolves once and populates it.
    const cachedNow = badgeUrlCache.get(cid)
    if (cachedNow !== undefined) {
      setUrl(cachedNow)
      return
    }
    let active = true
    void loadBadge(cid).then((resolved) => {
      if (active) setUrl(resolved)
    })
    return () => {
      active = false
    }
  }, [cid])

  if (cid && url) {
    return <img class='certificate-badge__img' src={url} width={size} height={size} alt='' />
  }
  return <BadgeCheck size={size} />
}
