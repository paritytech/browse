import { ProductCard } from './index'
import { type AppEntry } from '../../state/apps/types'
import { useAttestApp, useRevokeApp } from '../../state/attestations/mutations'
import { useGetAppAttestation } from '../../state/attestations/queries'
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
  const { data } = useGetAppAttestation(app.label)
  const attestApp = useAttestApp()
  const revokeApp = useRevokeApp()
  const { showToast } = useToast()

  const mergedApp = data
    ? { ...app, attestationCount: data.attestationCount, hasUserAttested: data.hasUserAttested }
    : app

  function handleAttestation() {
    if (mergedApp.hasUserAttested) {
      revokeApp.mutate(app.label, { onSuccess: () => showToast('Unrecommended!') })
    } else {
      attestApp.mutate(app.label, { onSuccess: () => showToast('Recommended!') })
    }
  }

  return (
    <ProductCard
      app={mergedApp}
      index={index}
      starred={starred}
      showStar={showStar}
      recommended={mergedApp.hasUserAttested}
      onClick={onClick}
      onStar={onStar}
      onClickAttestation={handleAttestation}
    />
  )
}
