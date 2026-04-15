import { useCallback, useEffect, useRef } from 'preact/hooks'

import { type FilterMode } from '../../state/apps/types'
import './styles.css'

interface CategoryTab {
  id: FilterMode
  label: string
  enabled: boolean
}

const BASE_CATEGORIES: CategoryTab[] = [
  { id: 'pcf', label: 'PCF', enabled: true },
  { id: 'bookmarks', label: 'Bookmarks', enabled: true },
  { id: 'all', label: 'All', enabled: true }
]

const SIGNED_CATEGORIES: CategoryTab[] = [
  { id: 'pcf', label: 'PCF', enabled: true },
  { id: 'bookmarks', label: 'Bookmarks', enabled: true },
  { id: 'following', label: 'Following', enabled: true },
  { id: 'all', label: 'All', enabled: true }
]

interface CategoryTabsProps {
  active: FilterMode
  signed?: boolean
  onSwitch: (mode: FilterMode) => void
}

export function CategoryTabs({ active, signed, onSwitch }: CategoryTabsProps) {
  const categories = signed ? SIGNED_CATEGORIES : BASE_CATEGORIES
  const containerRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)

  const positionIndicator = useCallback((animate = true) => {
    const container = containerRef.current
    const indicator = indicatorRef.current
    if (!container || !indicator) return

    const activeEl = container.querySelector<HTMLElement>('.category-tab--active')
    if (!activeEl) {
      indicator.style.opacity = '0'
      return
    }

    const containerRect = container.getBoundingClientRect()
    const activeRect = activeEl.getBoundingClientRect()

    if (!animate) indicator.style.transition = 'none'

    indicator.style.width = `${activeRect.width}px`
    indicator.style.transform = `translateX(${activeRect.left - containerRect.left}px)`
    indicator.style.opacity = '1'

    if (!animate) {
      void indicator.offsetHeight // force reflow
      indicator.style.transition = ''
    }
  }, [])

  useEffect(() => {
    requestAnimationFrame(() => positionIndicator(false))
  }, [])

  useEffect(() => {
    positionIndicator(true)
  }, [active, positionIndicator])

  return (
    <div class='category-tabs' ref={containerRef}>
      <div class='category-tabs__indicator' ref={indicatorRef} />
      {categories.map((tab) => (
        <button
          key={tab.id}
          class={`category-tab${tab.id === active ? ' category-tab--active' : ''}${!tab.enabled ? ' category-tab--disabled' : ''}`}
          data-mode={tab.id}
          disabled={!tab.enabled}
          onClick={() => tab.enabled && onSwitch(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
