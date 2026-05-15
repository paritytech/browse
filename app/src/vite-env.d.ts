/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ACTIVE_GENESIS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
