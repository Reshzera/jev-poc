/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sobrescreve o modelo. Padrão: jev-latest */
  readonly VITE_JEV_MODEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
