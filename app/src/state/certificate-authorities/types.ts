/**
 * The shared identity of a certificate: which authority issues it and how it
 * presents.
 *
 * A {@link CertificateAuthority} is the issuer view of this identity, aggregated
 * across products. An {@link AppCertificate} is one issued instance on a single
 * product.
 */
export interface CertificateIdentity {
  /** Lowercased resolver contract address, the authority key. */
  resolver: string
  /** Trusted attester address that signs the certificate. */
  attester: string
  /** Certificate name, or null when unknown. */
  name: string | null
  /** Description document CID, or null. */
  contentCid: string | null
  /** Badge image CID, or null. */
  badgeIconCid: string | null
}

/**
 * A certificate authority: a trusted attester whose compliance attestations put
 * a badge on products.
 *
 * Authorities are discovered by enumerating schemas. The identity fields are
 * sampled from one of the authority attestations, since that metadata lives in
 * attestation data rather than the schema.
 */
export interface CertificateAuthority extends CertificateIdentity {
  /** Schema id as a decimal string, kept JSON-safe. */
  schemaId: string
  /** Number of products certified by this authority, populated by discovery. */
  certifiedCount?: number
}
