import type { ComponentChildren } from 'preact'

import { useMemo, useState } from 'preact/hooks'

import { marked } from 'marked'

import { useMarkdownFromCid } from '../../hooks/use-markdown-from-cid'
import type { AppCertificate } from '../../state/apps/types'
import { CertificateBadge } from '../certificate-badge'
import './styles.css'

interface CertificateModalProps {
  visible: boolean
  /** Display name of the certified product. */
  subjectName: string | null
  /** `<label>.dot` of the certified product. */
  subjectDomain: string | null
  /** Attestation details. Null shows only the default certificate document. */
  certificate: AppCertificate | null
  onDismiss: () => void
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
}

function Row({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class='certificate-modal__row'>
      <span class='certificate-modal__row-label'>{label}</span>
      <span class='certificate-modal__row-value'>{children}</span>
    </div>
  )
}

/** Copies a long value to the clipboard. The full value shows on hover. */
function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type='button'
      class='certificate-modal__copy'
      title={value}
      onClick={() => {
        void navigator.clipboard?.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export function CertificateModal({
  visible,
  subjectName,
  subjectDomain,
  certificate,
  onDismiss
}: CertificateModalProps) {
  const title = certificate?.name ?? (certificate ? 'Certificate' : '')

  // Download the certificate markdown, the per-product content set by the
  // authority. Gated on `subjectDomain`, which is set on first open and kept
  // afterwards, so the content survives the close animation and never prefetches.
  const cid = certificate?.contentCid ?? null
  const { text: remote, failed } = useMarkdownFromCid(subjectDomain ? cid : null)
  const aboutLoading = !!cid && !remote && !failed

  // The markdown is authored by the trusted attester, so it is rendered as-is.
  const aboutHtml = useMemo(() => (remote ? marked.parse(remote, { async: false }) : ''), [remote])

  return (
    <>
      <div
        class={`certificate-modal__scrim${visible ? ' certificate-modal__scrim--visible' : ''}`}
        onClick={onDismiss}
      />
      <div
        class={`certificate-modal${visible ? ' certificate-modal--visible' : ''}`}
        role='dialog'
        aria-modal='true'
        aria-label={title}
      >
        <button class='certificate-modal__close' onClick={onDismiss} aria-label='Close'>
          ✕
        </button>
        <div class='certificate-modal__hero'>
          <span class='certificate-modal__badge'>
            <CertificateBadge cid={certificate?.badgeIconCid ?? null} size={64} />
          </span>
          <span class='certificate-modal__title'>{title}</span>
        </div>

        <div class='certificate-modal__body'>
          <section class='certificate-modal__section'>
            <h3 class='certificate-modal__section-title'>Issued to</h3>
            {subjectName && <Row label='Name'>{subjectName}</Row>}
            {subjectDomain && (
              <Row label='Domain'>
                <span class='certificate-modal__mono'>{subjectDomain}</span>
              </Row>
            )}
          </section>

          {certificate && (
            <section class='certificate-modal__section'>
              <h3 class='certificate-modal__section-title'>Issued by</h3>
              <Row label='Attester Address'>
                <CopyValue value={certificate.attester} />
              </Row>
            </section>
          )}

          {certificate && (
            <section class='certificate-modal__section'>
              <h3 class='certificate-modal__section-title'>Validity</h3>
              <Row label='Issued'>{formatDate(certificate.issuedAt)}</Row>
              <Row label='Expires'>
                {certificate.expiresAt ? formatDate(certificate.expiresAt) : 'Never'}
              </Row>
            </section>
          )}

          {certificate && (
            <section class='certificate-modal__section'>
              <h3 class='certificate-modal__section-title'>Fingerprint</h3>
              <Row label='Attestation Hash'>
                <CopyValue value={certificate.id} />
              </Row>
            </section>
          )}

          <section class='certificate-modal__section'>
            <h3 class='certificate-modal__section-title'>Description</h3>
            {aboutLoading ? (
              <div class='certificate-modal__loading'>
                <span class='loading-dots__dot' />
                <span class='loading-dots__dot' />
                <span class='loading-dots__dot' />
              </div>
            ) : (
              <div
                class='certificate-modal__about'
                dangerouslySetInnerHTML={{ __html: aboutHtml }}
              />
            )}
          </section>
        </div>
      </div>
    </>
  )
}
