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

  return (
    <div class='category-tabs'>
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
