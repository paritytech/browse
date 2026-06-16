import { useState } from 'preact/hooks'

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
  onAttestationSettled?: () => void
}

export function ProductCardWithAttestation({
  app,
  index,
  bookmarked,
  isSignedIn,
  showMenu,
  onClick,
  onBookmark,
  onShare,
  onAttestationSettled
}: ProductCardWithAttestationProps) {
  const attestProduct = useAttestProduct()
  const revokeApp = useRevokeApp()
  const { showToast } = useToast()

  // True from the moment the tx broadcasts until it confirms in a best block, so
  // the bubbling spans the whole in-flight window and ends with the toast.
  const [recommending, setRecommending] = useState(false)

  const handleAttestation = useEvent(() => {
    if (!isSignedIn) {
      showToast('Sign in to recommend')
      return
    }
    if (app.hasUserAttested) {
      revokeApp.mutate(
        { label: app.label },
        {
          onSuccess: () => {
            showToast('Unrecommended!')
            onAttestationSettled?.()
          },
          onError: (err) => showToast(describeError(err))
        }
      )
    } else {
      attestProduct.mutate(
        // The count goes up and the bubbling starts the moment the tx broadcasts.
        { label: app.label, onBroadcast: () => setRecommending(true) },
        {
          onSuccess: () => {
            setRecommending(false)
            showToast('Recommended!')
            onAttestationSettled?.()
          },
          onError: (err) => {
            setRecommending(false)
            showToast(describeError(err))
          }
        }
      )
    }
  })

  return (
    <ProductCard
      app={app}
      index={index}
      bookmarked={bookmarked}
      showMenu={showMenu}
      recommended={app.hasUserAttested}
      attestationPending={attestProduct.isPending || revokeApp.isPending}
      // Pulse the whole recommend.
      provisioning={attestProduct.isPending && !recommending}
      recommending={recommending}
      onClick={onClick}
      onBookmark={onBookmark}
      onShare={onShare}
      onClickAttestation={handleAttestation}
    />
  )
}
