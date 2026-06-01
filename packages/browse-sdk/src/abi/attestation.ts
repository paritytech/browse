import { decodeAbiParameters, encodeAbiParameters, type Hex } from 'viem'

const LABEL_DATA_PARAMS = [{ type: 'string' as const }]

/**
 * Wrap a `.dot` label string in the attestation `data` payload format
 * expected by the browse attestation schema.
 */
export function encodeAttestationLabel(label: string): Hex {
  return encodeAbiParameters(LABEL_DATA_PARAMS, [label]) as Hex
}

/**
 * Decode an attestation `data` payload back to its label string, or `null`
 * if the payload is empty / malformed.
 */
export function decodeAttestationLabel(data: Hex | string | undefined): string | null {
  if (!data || data === '0x') return null
  try {
    const [label] = decodeAbiParameters(LABEL_DATA_PARAMS, data as Hex)
    return typeof label === 'string' && label.length > 0 ? label : null
  } catch {
    return null
  }
}
