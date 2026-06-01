/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ACTIVE_GENESIS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '@fontsource-variable/inter'
declare module '@fontsource-variable/manrope'
declare module '@fontsource-variable/martian-mono'
