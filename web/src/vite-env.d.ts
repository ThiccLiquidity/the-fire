/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_FIRE_ADDRESS?: string; readonly VITE_RPC_URL?: string; readonly VITE_PAPER_ADDRESS?: string }
interface ImportMeta { readonly env: ImportMetaEnv }
