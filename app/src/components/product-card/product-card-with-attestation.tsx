import { ProductCard } from './index'
import { useEvent } from '../../lib/use-event'
import { type AppEntry } from '../../state/apps/types'
import { describeError, useAttestApp, useRevokeApp } from '../../state/attestations/mutations'
import { useToast } from '../toast/context'

interface ProductCardWithAttestationProps {
  app: AppEntry
  index: number
  starred: boolean
  showStar?: boolean
  onClick: (label: string) => void
  onStar: (label: string) => void
}

export function ProductCardWithAttestation({
  app,
  index,
  starred,
  showStar,
  onClick,
  onStar
}: ProductCardWithAttestationProps) {
  const attestApp = useAttestApp()
  const revokeApp = useRevokeApp()
  const { showToast } = useToast()

  const handleAttestation = useEvent(() => {
    if (app.hasUserAttested) {
      revokeApp.mutate(app.label, {
        onSuccess: () => showToast('Unrecommended!'),
        onError: (err) => showToast(describeError(err), true)
      })
    } else {
      attestApp.mutate(app.label, {
        onSuccess: () => showToast('Recommended!'),
        onError: (err) => showToast(describeError(err), true)
      })
    }
  })

  return (
    <ProductCard
      app={app}
      index={index}
      starred={starred}
      showStar={showStar}
      recommended={app.hasUserAttested}
      onClick={onClick}
      onStar={onStar}
      onClickAttestation={handleAttestation}
    />
  )
}
