import { type AppEntry } from '../../state/apps/types'
import { ProductCard } from '../product-card'

interface PlaceholderCardProps {
  /** Label as typed, shown on the card so it tracks the input. */
  label: string
  /** Where a tap goes. Differs from {@link PlaceholderCardProps.label} mid-name, as for `host-`. */
  target: string
  onGo: (label: string) => void
}

/**
 * The line under the address, matching the fallback every other card uses.
 *
 * Never blank, or the card reads as broken beside neighbours that carry a
 * description, and it claims nothing about whether the domain exists, which keeps
 * it true even when the lookup never completed.
 */
const NO_DESCRIPTION = 'No description'

/**
 * Stands in for the app at a typed address, before we know there is one.
 *
 * The same component the list uses, so the typed address is not a lesser result.
 * The caller swaps in a wired card once the address resolves to something
 * published, which is why nothing here bookmarks, recommends, or shares.
 *
 * The entry carries the target as its label and the typed text as its name, so the
 * card reads back what was typed while every action, including the tooltip, names
 * the address a tap actually reaches.
 */
export function PlaceholderCard({ label, target, onGo }: PlaceholderCardProps) {
  const app: AppEntry = {
    label: target,
    name: `${label}.dot`,
    description: NO_DESCRIPTION,
    iconCid: null,
    contentHash: null,
    isLive: false,
    attestationCount: null,
    hasUserAttested: false,
    certificates: [],
    publishedAt: null
  }

  return <ProductCard app={app} index={-1} showMenu={false} isPlaceholder onClick={onGo} />
}
