import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { launchChecks } from './vite.config.ts'

// The Forge's wallet bundle: src/forge-wallet.ts → art/factory/forge/vendor/wallet.js, plus chunks in vendor/wallet/
// that load only when needed (wagmi on the first click; AppKit too when VITE_REOWN_PROJECT_ID is set). An ES module
// with code splitting, loaded by the Forge with <script type="module" src="vendor/wallet.js"> (CSP script-src 'self').
//
// `npm run build:wallet` writes the copy in art/factory/forge/vendor (then run art/factory/sync_forge.sh).
// `npm run build` (what Vercel runs) builds it again straight into dist/forge/vendor with --outDir, so the deploy's
// VITE_* env (VITE_REOWN_PROJECT_ID, VITE_CHAIN, VITE_RPC_URL) is what ships.
export default defineConfig(({ mode }) => ({
  plugins: [launchChecks(mode)],
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL('./art/factory/forge/vendor', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    sourcemap: false,
    lib: {
      entry: fileURLToPath(new URL('./src/forge-wallet.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'wallet.js',
    },
    rollupOptions: {
      output: { chunkFileNames: 'wallet/[name]-[hash].js' },
    },
  },
}))
