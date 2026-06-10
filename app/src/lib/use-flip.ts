import { type RefObject } from 'preact'

import { useLayoutEffect, useRef } from 'preact/hooks'

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
const DURATION_MS = 320

/**
 * When `orderKey` changes, glide each list item from its previous layout
 * position to the new one instead of snapping. Items with no previous position
 * (just mounted) are left alone so their own entry animation plays.
 *
 * Items are matched across renders by their `data-label` attribute.
 */
export function useFlipReorder<T extends HTMLElement>(
  containerRef: RefObject<T>,
  orderKey: string
): void {
  const prevRects = useRef<Map<string, DOMRect>>(new Map())

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) {
      prevRects.current = new Map()
      return
    }

    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-label]'))

    // Honor reduced motion: the reorder must still land, but instantly — no
    // glide. Recording the new positions keeps later runs measuring correctly.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const rects = new Map<string, DOMRect>()
      for (const el of cards) {
        const label = el.dataset.label
        if (label) rects.set(label, el.getBoundingClientRect())
      }
      prevRects.current = rects
      return
    }

    // Cancel any in-flight transform so positions are read at their true layout
    // spot, not mid-animation. This snaps an interrupted glide to its end.
    for (const el of cards) {
      el.style.transition = 'none'
      el.style.transform = ''
    }

    const nextRects = new Map<string, DOMRect>()
    for (const el of cards) {
      const label = el.dataset.label
      if (label) nextRects.set(label, el.getBoundingClientRect())
    }

    for (const el of cards) {
      const label = el.dataset.label
      if (!label) continue
      const prev = prevRects.current.get(label)
      const next = nextRects.get(label)
      if (!prev || !next) continue
      const dx = prev.left - next.left
      const dy = prev.top - next.top
      if (dx === 0 && dy === 0) continue

      // Invert: jump back to where the item was, with no transition…
      el.style.transform = `translate(${dx}px, ${dy}px)`
      // …force a reflow so the jump lands before we animate…
      void el.getBoundingClientRect()
      // …then play forward to its new resting spot.
      requestAnimationFrame(() => {
        el.style.transition = `transform ${DURATION_MS}ms ${EASE}`
        el.style.transform = ''
      })
      const clear = (e: TransitionEvent) => {
        if (e.propertyName !== 'transform') return
        el.style.transition = ''
        el.style.transform = ''
        el.removeEventListener('transitionend', clear)
      }
      el.addEventListener('transitionend', clear)
    }

    prevRects.current = nextRects
  }, [orderKey])
}
