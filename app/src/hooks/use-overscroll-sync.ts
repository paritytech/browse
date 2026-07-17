import { useEffect } from 'preact/hooks'

// How much "past the end" intent (px of wheel/drag beyond the bottom) counts as
// a deliberate pull, so a stray scroll tick at the end doesn't trigger.
const OVERSCROLL_THRESHOLD = 120
const AT_BOTTOM_EPS = 2

/**
 * Calls `onTrigger` when the user deliberately pushes *past* the bottom of the
 * page. That means a rubber-band/overscroll on touch, a continued wheel-down,
 * or PageDown/End while already at the end. This is intent ("that's all? get
 * more"), not mere arrival at the bottom, so it won't fire just from scrolling
 * down.
 *
 * The window is the scroll container (the app list is a plain flex column).
 * Pass `disabled` while a sync is already running or irrelevant. The listeners
 * re-arm each time `disabled` flips back to false, after a sync finishes.
 */
export function useOverscrollSync(onTrigger: () => void, disabled = false) {
  useEffect(() => {
    if (disabled) return

    const scroller = () => document.scrollingElement ?? document.documentElement
    const atBottom = () => {
      const el = scroller()
      return el.scrollTop + el.clientHeight >= el.scrollHeight - AT_BOTTOM_EPS
    }

    let acc = 0
    let fired = false

    const push = (delta: number) => {
      if (!atBottom()) {
        acc = 0
        return
      }
      if (fired) return
      acc += delta
      if (acc >= OVERSCROLL_THRESHOLD) {
        fired = true
        onTrigger()
      }
    }

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY > 0) push(e.deltaY)
    }

    let touchY = 0
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? 0
      acc = 0
      fired = false
    }
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0
      const dy = touchY - y // finger moving up = trying to pull content up past the end
      touchY = y
      if (dy > 0) push(dy)
    }
    const onTouchEnd = () => {
      acc = 0
    }

    const onScroll = () => {
      if (!atBottom()) {
        acc = 0
        fired = false
      }
    }

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (!fired && (e.key === 'PageDown' || e.key === 'End') && atBottom()) {
        fired = true
        onTrigger()
      }
    }

    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('keydown', onKey)
    }
  }, [onTrigger, disabled])
}
