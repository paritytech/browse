import { type FilterMode } from '../../state/apps/types'
import './styles.css'

interface CategoryTab {
  id: FilterMode
  label: string
  enabled: boolean
}

const BASE_CATEGORIES: CategoryTab[] = [
  { id: 'bookmarks', label: 'Bookmarks', enabled: true },
  { id: 'all', label: 'All', enabled: true }
]

const SIGNED_CATEGORIES: CategoryTab[] = [
  { id: 'bookmarks', label: 'Bookmarks', enabled: true },
  { id: 'following', label: 'Following', enabled: true },
  { id: 'all', label: 'All', enabled: true }
]

interface CategoryTabsProps {
  active: FilterMode[]
  isSignedIn: boolean
  onSwitch: (mode: FilterMode) => void
}

export function CategoryTabs({ active, isSignedIn, onSwitch }: CategoryTabsProps) {
  const categories = isSignedIn ? SIGNED_CATEGORIES : BASE_CATEGORIES
  const activeSet = new Set(active)

  return (
    <div class='category-tabs'>
      {categories.map((tab) => (
        <button
          key={tab.id}
          class={`category-tab${activeSet.has(tab.id) ? ' category-tab--active' : ''}${!tab.enabled ? ' category-tab--disabled' : ''}`}
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
