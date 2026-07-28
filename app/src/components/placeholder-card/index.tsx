import { type AppEntry, type DestinationResolution } from '../../state/apps/types'
import { ProductCard } from '../product-card'

interface PlaceholderCardProps {
  /** Label as typed, shown on the card so it tracks the input. */
  label: string
  /** Where a tap goes. Differs from {@link PlaceholderCardProps.label} mid-name, as for `host-`. */
  target: string
  /** What the resolver found, or undefined when it has not been asked. */
  resolution?: DestinationResolution
  onGo: (label: string) => void
}

/** Only a registered name with nothing published earns a line. Everything else stays silent. */
function descriptionFor(resolution: DestinationResolution | undefined): string {
  return resolution?.status === 'registered' ? 'Registered, nothing published' : ''
}

/**
 * Stands in for the app at a typed address, before we know there is one.
 *
 * The same component the list uses, so the typed address is not a lesser result.
 * The caller swaps in a wired card once the address resolves to something
 * published, which is why nothing here bookmarks, recommends, or shares.
 */
export function PlaceholderCard({ label, target, resolution, onGo }: PlaceholderCardProps) {
  const app: AppEntry = {
    label,
    name: null,
    description: descriptionFor(resolution),
    iconCid: null,
    contentHash: null,
    isLive: false,
    attestationCount: null,
    hasUserAttested: false,
    certificates: [],
    publishedAt: null
  }

  return (
    <ProductCard app={app} index={-1} showMenu={false} isPlaceholder onClick={() => onGo(target)} />
  )
}
