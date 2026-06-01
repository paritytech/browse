export const MODALITIES = ['app', 'widget', 'worker'] as const
export type Modality = (typeof MODALITIES)[number]

export type IconFormat = 'jpeg' | 'png'

export interface RootManifest {
  $v: 1
  displayName: string
  description: string
  icon: { cid: string; format: IconFormat }
}

export interface AppListing {
  label: string
  /**
   * IPFS CID for the queried modality. When the listing comes from a modality
   * filter (`listAppsByModality`) this is the contenthash of
   * `<modality>.<label>.dot`. Otherwise it's the bare `<label>.dot`
   * contenthash (the "app" modality by convention).
   */
  contentHash: string
  manifest: RootManifest
}

export interface NetworkAddresses {
  PUBLISHER: `0x${string}`
  REGISTRAR: `0x${string}`
  CONTENT_RESOLVER: `0x${string}`
  MULTICALL3: `0x${string}`
}
