import { useLayoutEffect, useRef, useState } from 'preact/hooks'

import { type FilterMode } from '../../state/apps/types'
import './styles.css'

interface CategoryTab {
  id: FilterMode
  label: string
  enabled: boolean
}

const CATEGORIES: CategoryTab[] = [
  { id: 'bookmarks', label: 'Bookmarks', enabled: true },
  { id: 'following', label: 'Following', enabled: true },
  { id: 'all', label: 'All', enabled: true }
]

interface CategoryTabsProps {
  active: FilterMode[]
  onSwitch: (mode: FilterMode) => void
  disabled?: boolean
}

export function CategoryTabs({ active, onSwitch, disabled = false }: CategoryTabsProps) {
  const categories = CATEGORIES
  const activeSet = new Set(active)
  const activeId = categories.find((tab) => activeSet.has(tab.id))?.id
  const listRef = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)

  // Position the sliding indicator under the active tab. Measured (not derived
  // from a fixed width) because the three labels differ in width, and re-run on
  // any reflow — a late web-font load shifts the widths after first paint.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const measure = () => {
      const el = list.querySelector<HTMLButtonElement>(`[data-mode="${activeId}"]`)
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [activeId])

  return (
    <div class='category-tabs' ref={listRef}>
      {pill && (
        <span
          class='category-tabs__indicator'
          style={{ transform: `translateX(${pill.left}px)`, width: `${pill.width}px` }}
        />
      )}
      {categories.map((tab) => {
        const enabled = tab.enabled && !disabled
        return (
          <button
            key={tab.id}
            class={`category-tab${activeSet.has(tab.id) ? ' category-tab--active' : ''}${!enabled ? ' category-tab--disabled' : ''}`}
            data-mode={tab.id}
            disabled={!enabled}
            onClick={() => enabled && onSwitch(tab.id)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
