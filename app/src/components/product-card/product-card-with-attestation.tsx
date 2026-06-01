import { ProductCard } from './index'
import { useEvent } from '../../lib/use-event'
import { type AppEntry } from '../../state/apps/types'
import { describeError, useAttestProduct, useRevokeApp } from '../../state/attestations/mutations'
import { useToast } from '../toast/context'

interface ProductCardWithAttestationProps {
  app: AppEntry
  index: number
  bookmarked: boolean
  isSignedIn: boolean
  showMenu?: boolean
  onClick: (label: string) => void
  onBookmark: (label: string) => void
  onShare: (app: AppEntry) => void
}

export function ProductCardWithAttestation({
  app,
  index,
  bookmarked,
  isSignedIn,
  showMenu,
  onClick,
  onBookmark,
  onShare
}: ProductCardWithAttestationProps) {
  const attestProduct = useAttestProduct()
  const revokeApp = useRevokeApp()
  const { showToast } = useToast()

  const handleAttestation = useEvent(() => {
    if (!isSignedIn) {
      showToast('Sign in to recommend')
      return
    }
    if (app.hasUserAttested) {
      revokeApp.mutate(app.label, {
        onSuccess: () => showToast('Unrecommended!'),
        onError: (err) => showToast(describeError(err), true)
      })
    } else {
      attestProduct.mutate(app.label, {
        onSuccess: () => showToast('Recommended!'),
        onError: (err) => showToast(describeError(err), true)
      })
    }
  })

  return (
    <ProductCard
      app={app}
      index={index}
      bookmarked={bookmarked}
      showMenu={showMenu}
      recommended={app.hasUserAttested}
      onClick={onClick}
      onBookmark={onBookmark}
      onShare={onShare}
      onClickAttestation={handleAttestation}
    />
  )
}
