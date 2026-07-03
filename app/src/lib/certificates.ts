export interface Certificate {
  /** Shown as the badge label and the modal title. */
  name: string
  /** Who issues the certificate, shown under "Issued by". */
  issuer: string
  /**
   * CID of the certificate content.
   */
  contentCid: string
}

/**
 * The certificate bound to the compliance attestation. One
 * certificate today. Shaped so a future deployer can add more.
 */
export const CERTIFICATE: Certificate = {
  name: 'Parity User Interface Compliance',
  issuer: 'Parity Technologies',
  contentCid: 'bafk2bzaceba5zm52srzef7ao2hztv3w3n75wb6gqxx4xmg3aif33vnko36yry'
}
