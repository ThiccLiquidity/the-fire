/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_RPC_URL?: string; readonly VITE_CHAIN?: string }
interface ImportMeta { readonly env: ImportMetaEnv }
