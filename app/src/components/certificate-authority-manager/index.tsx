import { useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Info, X } from 'lucide-preact'

import {
  resetSelectedCertificateAuthorities,
  setCertificateAuthoritySelected
} from '../../db/certificate-authorities'
import { DEFAULT_CERTIFICATES } from '../../lib/config'
import { ALL_APPS_KEY } from '../../state/apps/queries'
import {
  SELECTED_CERTIFICATE_AUTHORITIES_KEY,
  useCertificateAuthorities,
  useSelectedCertificateAuthorities
} from '../../state/certificate-authorities/queries'
import type { CertificateAuthority } from '../../state/certificate-authorities/types'
import { Switch } from '../switch'
import './styles.css'

const INFO_TEXT =
  'Badges show which trusted organizations have verified an app. Turn one off to hide its badge.'

interface CertificateAuthorityManagerProps {
  visible: boolean
  onDismiss: () => void
}

const DEFAULT_SET = new Set(DEFAULT_CERTIFICATES)

export function CertificateAuthorityManager({
  visible,
  onDismiss
}: CertificateAuthorityManagerProps) {
  const queryClient = useQueryClient()
  const { data: authorities = [], isLoading } = useCertificateAuthorities()
  const { data: selected = [] } = useSelectedCertificateAuthorities()
  const selectedSet = new Set(selected.map((resolver) => resolver.toLowerCase()))

  // Selected first, then named authorities, then unknown address-only ones.
  const sorted = [...authorities].sort((a, b) => {
    const at = selectedSet.has(a.resolver) ? 0 : 1
    const bt = selectedSet.has(b.resolver) ? 0 : 1
    if (at !== bt) return at - bt
    return (a.name ?? '￿').localeCompare(b.name ?? '￿')
  })

  const divergedFromDefaults =
    selectedSet.size !== DEFAULT_SET.size || [...DEFAULT_SET].some((r) => !selectedSet.has(r))

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: SELECTED_CERTIFICATE_AUTHORITIES_KEY })
    await queryClient.invalidateQueries({ queryKey: ALL_APPS_KEY })
  }

  async function toggle(authority: CertificateAuthority, selected: boolean) {
    await setCertificateAuthoritySelected(authority.resolver, selected)
    await refresh()
  }

  async function reset() {
    await resetSelectedCertificateAuthorities()
    await refresh()
  }

  return (
    <div
      class={`ca-modal-overlay${visible ? ' ca-modal-overlay--visible' : ''}`}
      onClick={onDismiss}
    >
      <div class='ca-modal' onClick={(e) => e.stopPropagation()}>
        <div class='ca-modal__header'>
          <div class='ca-modal__heading'>
            <span class='ca-modal__title'>Badges</span>
            <span class='ca-modal__info' tabIndex={0} aria-label={INFO_TEXT}>
              <Info size={15} />
              <span class='ca-modal__tooltip' role='tooltip'>
                {INFO_TEXT}
              </span>
            </span>
          </div>
          {divergedFromDefaults && (
            <button type='button' class='ca-modal__reset' onClick={reset}>
              Reset
            </button>
          )}
          <button class='ca-modal__close' onClick={onDismiss} aria-label='Close'>
            <X size={22} />
          </button>
        </div>

        <div class='ca-modal__body'>
          {isLoading && authorities.length === 0 ? (
            <div class='ca-modal__loading'>
              <span class='loading-dots__dot' />
              <span class='loading-dots__dot' />
              <span class='loading-dots__dot' />
            </div>
          ) : sorted.length === 0 ? (
            <p class='ca-modal__state'>No certificate authorities found.</p>
          ) : (
            sorted.map((authority) => {
              const displayName = authority.name ?? 'Certificate authority'
              const isDefault = DEFAULT_SET.has(authority.resolver)
              const isSelected = selectedSet.has(authority.resolver)
              const metaParts = [
                authority.name === null ? 'Unverified' : null,
                authority.certifiedCount !== undefined
                  ? `${authority.certifiedCount} certified`
                  : null
              ].filter(Boolean)
              return (
                <div key={authority.resolver} class='ca-modal__row'>
                  <span class='ca-modal__badge'>
                    <BadgeCheck size={24} />
                  </span>
                  <div class='ca-modal__row-text'>
                    <span class='ca-modal__name'>
                      {displayName}
                      {isDefault && <span class='ca-modal__default'>Default</span>}
                    </span>
                    {metaParts.length > 0 && (
                      <span class='ca-modal__meta'>{metaParts.join(' · ')}</span>
                    )}
                  </div>
                  <Switch
                    checked={isSelected}
                    onChange={(next) => void toggle(authority, next)}
                    label={`Enable ${displayName}`}
                  />
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
