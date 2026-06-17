import { useEffect, useRef, useState } from 'preact/hooks'

// Once the dots appear, hold them this long even if the sync resolves sooner, so
// a fast query doesn't make them flash on and then immediately off.
const MIN_VISIBLE_MS = 2000

// Desktop pointers have no natural pull-to-refresh gesture, so the indicator
// reads as noise during the automatic first sync on open. Touch devices, where
// an overscroll pull is expected, keep that open-time feedback.
function isDesktop(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
  )
}

/**
 * Smooths the sync indicator. Two refinements over a raw `isFetching` gate:
 *
 * - On desktop, the first sync after mount is
 *   swallowed so the dots don't flash the moment the app opens.
 * - Once the dots show, they stay visible for at least `MIN_VISIBLE_MS`, so a
 *   sync that resolves quickly doesn't produce a jarring blink.
 */
export function useSyncIndicator(active: boolean): boolean {
  const [visible, setVisible] = useState(false)
  const shownAt = useRef(0)
  const firstSyncDone = useRef(false)
  const sawActive = useRef(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (active) {
      sawActive.current = true
      // Swallow the automatic open-time sync on desktop.
      if (!firstSyncDone.current && isDesktop()) return
      clearTimeout(hideTimer.current)
      if (!visible) {
        shownAt.current = performance.now()
        setVisible(true)
      }
    } else {
      // A sync cycle that actually ran has finished: the open-time sync is now
      // spent, so later syncs (e.g. an overscroll refresh) show normally.
      if (sawActive.current) firstSyncDone.current = true
      if (!visible) return
      const elapsed = performance.now() - shownAt.current
      hideTimer.current = setTimeout(() => setVisible(false), Math.max(0, MIN_VISIBLE_MS - elapsed))
    }
    return () => clearTimeout(hideTimer.current)
  }, [active, visible])

  return visible
}
