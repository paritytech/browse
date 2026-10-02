import { useQueryClient } from '@tanstack/react-query'

import { setCertificateAuthoritySelected } from '../../db/certificate-authorities'
import {
  SELECTED_CERTIFICATE_AUTHORITIES_KEY,
  useCertificateAuthorities,
  useSelectedCertificateAuthorities
} from '../../state/certificate-authorities/queries'
import { CertificateBadge } from '../certificate-badge'
import { Switch } from '../switch'
import './styles.css'

interface TrustListProps {
  /** Whether Relevant is the active sort, which slides the list in. */
  open: boolean
  /** Certificate names by lowercased resolver, for authorities the catalog leaves unnamed. */
  certificateNames: Map<string, string>
}

/**
 * The trusted developers, one switch each, under the Relevant sort option.
 *
 * Stays mounted and slides open or shut with Relevant, so choosing it animates
 * the list in rather than popping it into place.
 */
export function TrustList({ open, certificateNames }: TrustListProps) {
  const queryClient = useQueryClient()
  const { data: authorities = [], isPending } = useCertificateAuthorities()
  const { data: selected = [] } = useSelectedCertificateAuthorities()
  const selectedSet = new Set(selected.map((resolver) => resolver.toLowerCase()))

  async function toggle(resolver: string, next: boolean) {
    await setCertificateAuthoritySelected(resolver, next)
    await queryClient.invalidateQueries({ queryKey: SELECTED_CERTIFICATE_AUTHORITIES_KEY })
  }

  return (
    <div class={`trust-slide${open ? ' trust-slide--open' : ''}`} aria-hidden={!open} inert={!open}>
      <div class='trust-slide__inner'>
        <div class='trust-list'>
          {isPending && authorities.length === 0 && (
            <div class='trust-list__row' aria-busy='true'>
              <span class='trust-list__icon skeleton-pulse' />
              <span class='trust-list__name skeleton-pulse'>Loading badges…</span>
            </div>
          )}
          {authorities.map((authority) => {
            const name =
              authority.name ?? certificateNames.get(authority.resolver) ?? 'Unnamed badge'
            return (
              <div key={authority.resolver} class='trust-list__row'>
                <span class='trust-list__icon'>
                  <CertificateBadge cid={authority.badgeIconCid} size={16} />
                </span>
                <span class='trust-list__name'>{name}</span>
                <Switch
                  checked={selectedSet.has(authority.resolver)}
                  onChange={(next) => void toggle(authority.resolver, next)}
                  label={`Trust ${name}`}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
