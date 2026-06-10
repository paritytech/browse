import { type RefObject } from 'preact'

import { useLayoutEffect, useRef } from 'preact/hooks'

const FLIP_ID = 'flip-reorder'
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'
const EASE_IN_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)'

const clamp = (lo: number, v: number, hi: number) => Math.max(lo, Math.min(v, hi))

/**
 * Animates list items to their new positions when `orderKey` changes, so a
 * re-sort glides instead of snapping.
 *
 * The card named by `heroRef` is the one the user just acted on, and it leads
 * the motion. It lifts with a soft shadow and a slight scale as it travels, and
 * rides above the rest. The displaced cards ease out around it with a small
 * distance-based stagger, so the list yields rather than moving in lockstep.
 *
 * Items are matched across renders by their `data-label`. An item with no
 * previous position has just mounted, so it keeps its own entry animation.
 * `prefers-reduced-motion` skips the glide and lets the reorder land at once.
 */
export function useFlipReorder<T extends HTMLElement>(
  containerRef: RefObject<T>,
  orderKey: string,
  heroRef?: RefObject<string | null>
): void {
  const prevRects = useRef<Map<string, DOMRect>>(new Map())

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) {
      prevRects.current = new Map()
      return
    }

    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-label]'))
    const measure = () => {
      const rects = new Map<string, DOMRect>()
      for (const el of cards) {
        const label = el.dataset.label
        if (label) rects.set(label, el.getBoundingClientRect())
      }
      return rects
    }

    // Reduced motion: the reorder still lands, just without the glide.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      prevRects.current = measure()
      if (heroRef) heroRef.current = null
      return
    }

    // Cancel any flip still in flight so positions read at their true layout
    // spot, not mid-glide. Match only our own animations by id. This leaves the
    // entry animation and the upvote pop untouched.
    for (const el of cards) {
      for (const anim of el.getAnimations()) {
        if (anim.id === FLIP_ID) anim.cancel()
      }
    }

    const nextRects = measure()
    const hero = heroRef?.current ?? null
    let yielded = 0

    for (const el of cards) {
      const label = el.dataset.label
      if (!label) continue
      const prev = prevRects.current.get(label)
      const next = nextRects.get(label)
      if (!prev || !next) continue
      const dx = prev.left - next.left
      const dy = prev.top - next.top
      if (dx === 0 && dy === 0) continue

      const dist = Math.hypot(dx, dy)

      if (label === hero) {
        // The protagonist floats up, lifts, and settles while riding above the rest.
        el.style.zIndex = '2'
        const anim = el.animate(
          [
            {
              transform: `translate(${dx}px, ${dy}px) scale(1)`,
              boxShadow: '0 0 0 rgb(var(--fg-rgb) / 0)',
              easing: EASE_IN_OUT
            },
            {
              transform: `translate(${dx / 2}px, ${dy / 2}px) scale(1.045)`,
              boxShadow: '0 12px 32px rgb(var(--fg-rgb) / 0.22)',
              offset: 0.5,
              easing: EASE_OUT
            },
            { transform: 'translate(0, 0) scale(1)', boxShadow: '0 0 0 rgb(var(--fg-rgb) / 0)' }
          ],
          { duration: clamp(340, 340 + dist * 0.3, 520), fill: 'backwards', id: FLIP_ID }
        )
        const clearZ = () => {
          el.style.zIndex = ''
        }
        anim.onfinish = clearZ
        anim.oncancel = clearZ
      } else {
        // The crowd yields: a calm glide with a faint cascade.
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          {
            duration: clamp(240, 240 + dist * 0.4, 420),
            delay: Math.min(yielded * 14, 70),
            easing: EASE_OUT,
            fill: 'backwards',
            id: FLIP_ID
          }
        )
        yielded += 1
      }
    }

    prevRects.current = nextRects
    if (heroRef) heroRef.current = null
  }, [orderKey])
}
