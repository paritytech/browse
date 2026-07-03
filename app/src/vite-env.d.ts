/// <reference types="vite/client" />

import type { QueryClient } from '@tanstack/react-query'

interface ImportMetaEnv {
  readonly NETWORK_GENESIS_HASH?: string
  readonly APP_DOTNS_DOMAIN?: string
  readonly APP_DEBUG?: string
  readonly APP_DOMAINS_SNAPSHOT_CID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare global {
  interface Window {
    /** TanStack Query client, exposed in dev builds so e2e specs can invalidate queries. */
    __queryClient?: QueryClient
    /** Installed by the host container to resume chain connections on foreground. */
    __resumeConnections__?: () => void
  }
}

declare module '@fontsource-variable/inter'
declare module '@fontsource-variable/manrope'
declare module '@fontsource-variable/martian-mono'
