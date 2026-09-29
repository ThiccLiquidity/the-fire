/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_FIRE_ADDRESS?: string; readonly VITE_RPC_URL?: string; readonly VITE_CHAIN?: string; readonly VITE_PAPER_ADDRESS?: string; readonly VITE_PROFILES_ADDRESS?: string; readonly VITE_PROFILES_FROM_BLOCK?: string; readonly VITE_USDG_ADDRESS?: string }
interface ImportMeta { readonly env: ImportMetaEnv }
