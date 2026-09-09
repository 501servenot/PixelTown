/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PLAYER_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
