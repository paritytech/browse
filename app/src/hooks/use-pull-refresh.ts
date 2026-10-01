import { type RefObject } from 'preact'

import { useEffect, useRef } from 'preact/hooks'

// The offsets and rubber band follow the stock iOS refresh control, which Nova
// Wallet uses unstyled. Refresh fires once the content has moved this far.
const TRIGGER_OFFSET = 100
// Where the content rests while the refresh runs, leaving room for the spinner.
const HOLD_OFFSET = 60
const RUBBER_BAND = 0.55
const SETTLE_MS = 350
const SETTLE_EASING = 'cubic-bezier(0.25, 1, 0.5, 1)'
// How much wheel past the bottom counts as a deliberate push, so a stray tick
// at the end does not trigger.
const PUSH_THRESHOLD = 120
const AT_EDGE_EPS = 2

export type RefreshGesture = 'pull' | 'push'

interface PullRefreshOptions {
  contentRef: RefObject<HTMLElement>
  indicatorRef: RefObject<HTMLElement>
  onRefresh: (gesture: RefreshGesture) => void
  /** Blocks a new gesture without cutting short one already running. */
  disabled: boolean
  /** Holds the pulled content and the spinner until it turns false. */
  refreshing: boolean
}

function rubberBand(distance: number, dimension: number) {
  return (1 - 1 / ((distance * RUBBER_BAND) / dimension + 1)) * dimension
}

/**
 * Refreshes on a pull down from the top of the page, in the manner of the iOS
 * refresh control, or on a wheel, PageDown or End push past the bottom.
 *
 * The pull moves `contentRef` with rubber-band resistance while the ticks in
 * `indicatorRef` appear one by one. Crossing the trigger fires `onRefresh`
 * with the finger still down and taps the haptic where the platform has one.
 * On release the content rests at a smaller offset with the spinner turning
 * until `refreshing` turns false, then settles back. The push is for pointer
 * devices and moves nothing.
 */
export function usePullRefresh({
  contentRef,
  indicatorRef,
  onRefresh,
  disabled,
  refreshing
}: PullRefreshOptions) {
  const latest = useRef({ onRefresh, disabled, refreshing })
  latest.current = { onRefresh, disabled, refreshing }
  const onRefreshingChange = useRef<(refreshing: boolean) => void>(() => {})

  useEffect(() => {
    const scroller = () => document.scrollingElement ?? document.documentElement
    const atTop = () => scroller().scrollTop <= 0
    const atBottom = () => {
      const el = scroller()
      return el.scrollTop + el.clientHeight >= el.scrollHeight - AT_EDGE_EPS
    }

    let phase: 'idle' | 'pulling' | 'refreshing' | 'settling' = 'idle'
    let startY: number | null = null
    let tracking = false
    let settleTimer: ReturnType<typeof setTimeout> | undefined

    const render = (offset: number, animate: boolean) => {
      const content = contentRef.current
      const indicator = indicatorRef.current
      const transition = animate ? `transform ${SETTLE_MS}ms ${SETTLE_EASING}` : 'none'
      if (content) {
        content.style.transition = transition
        content.style.transform = offset > 0 ? `translateY(${offset}px)` : ''
      }
      if (indicator) {
        indicator.style.transition = animate ? `height ${SETTLE_MS}ms ${SETTLE_EASING}` : 'none'
        indicator.style.setProperty('--pull-offset', `${offset}px`)
        indicator.style.setProperty('--pull-progress', `${Math.min(offset / TRIGGER_OFFSET, 1)}`)
      }
    }

    const setIndicatorState = (state: 'idle' | 'spinning' | 'ending') => {
      const indicator = indicatorRef.current
      if (!indicator) return
      indicator.classList.toggle('pull-refresh--spinning', state !== 'idle')
      indicator.classList.toggle('pull-refresh--ending', state === 'ending')
    }

    const settle = () => {
      phase = 'settling'
      render(0, true)
      clearTimeout(settleTimer)
      settleTimer = setTimeout(() => {
        phase = 'idle'
        setIndicatorState('idle')
      }, SETTLE_MS)
    }

    const finish = () => {
      setIndicatorState('ending')
      settle()
    }

    const fire = () => {
      phase = 'refreshing'
      setIndicatorState('spinning')
      if ('vibrate' in navigator) navigator.vibrate(10)
      latest.current.onRefresh('pull')
    }

    onRefreshingChange.current = (isRefreshing) => {
      if (phase === 'refreshing' && !isRefreshing && !tracking) finish()
    }

    const onTouchStart = (e: TouchEvent) => {
      const content = contentRef.current
      const canPull =
        phase === 'idle' &&
        !latest.current.disabled &&
        e.touches.length === 1 &&
        !!content &&
        content.contains(e.target as Node) &&
        atTop()
      startY = canPull ? (e.touches[0]?.clientY ?? null) : null
    }

    const onTouchMove = (e: TouchEvent) => {
      if (startY === null) return
      const distance = (e.touches[0]?.clientY ?? startY) - startY
      if (!tracking) {
        if (distance === 0) return
        if (distance < 0 || !atTop()) {
          startY = null
          return
        }
        tracking = true
        phase = 'pulling'
      }
      e.preventDefault()
      const offset = rubberBand(Math.max(distance, 0), window.innerHeight)
      render(offset, false)
      if (phase === 'pulling' && offset >= TRIGGER_OFFSET) fire()
    }

    const onTouchEnd = () => {
      startY = null
      if (!tracking) return
      tracking = false
      if (phase === 'pulling') settle()
      else if (latest.current.refreshing) render(HOLD_OFFSET, true)
      else finish()
    }

    let pushed = 0
    let pushFired = false
    const push = (delta: number) => {
      if (!atBottom()) {
        pushed = 0
        return
      }
      if (pushFired || latest.current.disabled) return
      pushed += delta
      if (pushed >= PUSH_THRESHOLD) {
        pushFired = true
        latest.current.onRefresh('push')
      }
    }

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY > 0) push(e.deltaY)
    }

    const onScroll = () => {
      if (!atBottom()) {
        pushed = 0
        pushFired = false
      }
    }

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if ((e.key === 'PageDown' || e.key === 'End') && atBottom()) push(PUSH_THRESHOLD)
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(settleTimer)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('keydown', onKey)
    }
  }, [contentRef, indicatorRef])

  useEffect(() => {
    onRefreshingChange.current(refreshing)
  }, [refreshing])
}
