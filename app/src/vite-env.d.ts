/// <reference types="vite/client" />

import type { QueryClient } from '@tanstack/react-query'

interface ImportMetaEnv {
  readonly VITE_ACTIVE_GENESIS?: string
  readonly VITE_DEBUG?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare global {
  interface Window {
    /** TanStack Query client, exposed in dev builds so e2e specs can invalidate queries. */
    __queryClient?: QueryClient
  }
}

declare module '@fontsource-variable/inter'
declare module '@fontsource-variable/manrope'
declare module '@fontsource-variable/martian-mono'
