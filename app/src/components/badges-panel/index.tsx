import { useState } from 'preact/hooks'

import { useQueryClient } from '@tanstack/react-query'

import { setCertificateAuthoritySelected } from '../../db/certificate-authorities'
import { ALL_APPS_KEY } from '../../state/apps/queries'
import {
  SELECTED_CERTIFICATE_AUTHORITIES_KEY,
  useCertificateAuthorities,
  useSelectedCertificateAuthorities
} from '../../state/certificate-authorities/queries'
import type { CertificateAuthority } from '../../state/certificate-authorities/types'
import { CertificateBadge } from '../certificate-badge'
import { type StackItem, StackPanel } from '../stack-panel'

interface BadgesPanelProps {
  /** Whether the badge search input is expanded, owned by the parent. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Certificate names by lowercased resolver, for authorities the catalog leaves unnamed. */
  certificateNames: Map<string, string>
}

/**
 * The badges panel inlined under the category tabs on the All tab.
 *
 * The authorities whose badges show on cards sit as a stack of their badge
 * icons. Removing one hides its badge, and the + grows into a search over the
 * authorities that are switched off. See {@link StackPanel}.
 */
export function BadgesPanel({ open, onOpenChange, certificateNames }: BadgesPanelProps) {
  const queryClient = useQueryClient()
  const { data: authorities = [], isLoading } = useCertificateAuthorities()
  const { data: selected = [] } = useSelectedCertificateAuthorities()
  const [input, setInput] = useState('')

  const authorityLabel = (authority: CertificateAuthority) =>
    authority.name ?? certificateNames.get(authority.resolver) ?? 'Unnamed badge'
  const toStackItem = (authority: CertificateAuthority): StackItem => ({
    key: authority.resolver,
    label: authorityLabel(authority),
    avatar: <CertificateBadge cid={authority.badgeIconCid} size={28} />
  })

  const selectedSet = new Set(selected.map((resolver) => resolver.toLowerCase()))
  const shown = authorities.filter((authority) => selectedSet.has(authority.resolver))
  const hidden = authorities.filter((authority) => !selectedSet.has(authority.resolver))
  const query = input.trim().toLowerCase()
  const results = hidden.filter((authority) =>
    authorityLabel(authority).toLowerCase().includes(query)
  )

  async function select(resolver: string, next: boolean) {
    await setCertificateAuthoritySelected(resolver, next)
    await queryClient.invalidateQueries({ queryKey: SELECTED_CERTIFICATE_AUTHORITIES_KEY })
    await queryClient.invalidateQueries({ queryKey: ALL_APPS_KEY })
  }

  // Collapse back to the stack on add: the new badge appearing there is the
  // confirmation.
  function add(resolver: string) {
    void select(resolver, true)
    onOpenChange(false)
  }

  return (
    <StackPanel
      variant='stack-panel--badges'
      items={shown.map(toStackItem)}
      open={open}
      onOpenChange={onOpenChange}
      onRemove={(resolver) => void select(resolver, false)}
      input={input}
      onInput={setInput}
      addLabel='Show a badge'
      removeLabel={(item) => `Hide ${item.label} badge`}
      moreLabel={(count) => `Show all ${count} badges`}
      placeholder='badge'
    >
      {open &&
        (isLoading && authorities.length === 0 ? (
          <p class='stack-panel__state'>Loading…</p>
        ) : results.length > 0 ? (
          results.map((authority) => (
            <button
              key={authority.resolver}
              type='button'
              class='stack-panel__option'
              onClick={() => add(authority.resolver)}
            >
              <span class='stack-panel__avatar'>
                <CertificateBadge cid={authority.badgeIconCid} size={30} />
              </span>
              <span class='stack-panel__row-label'>{authorityLabel(authority)}</span>
            </button>
          ))
        ) : hidden.length === 0 ? (
          <p class='stack-panel__state'>Every badge is already shown</p>
        ) : (
          <p class='stack-panel__state'>No badges match “{query}”</p>
        ))}
    </StackPanel>
  )
}
