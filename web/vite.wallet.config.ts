import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { launchChecks } from './vite.config.ts'

const SOURCE_OUT = fileURLToPath(new URL('./art/factory/forge/vendor', import.meta.url))

/** The live switch for the static page: live.js reads <meta name="forge-live"> (the same rule as net.ts: ?live=,
 *  else VITE_LIVE). Only the deploy build (`npm run build`, --outDir dist/forge/vendor) writes it, into the copy in
 *  dist/forge/index.html; the source page keeps it empty, so an unset VITE_LIVE (the default) stays the demo. */
function liveFlag(mode: string): Plugin {
  let outDir = SOURCE_OUT
  return {
    name: 'forge-live-flag',
    apply: 'build',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir) },
    closeBundle() {
      if (outDir === SOURCE_OUT) return
      const page = resolve(dirname(outDir), 'index.html')
      if (!existsSync(page)) return
      const v = loadEnv(mode, process.cwd(), 'VITE_').VITE_LIVE ?? ''
      const live = v === 'testnet' || v === 'mainnet' ? v : ''
      const html = readFileSync(page, 'utf8')
      if (!/<meta name="forge-live" content="[^"]*">/.test(html)) throw new Error(`${page} has no <meta name="forge-live">: live.js couldn't see VITE_LIVE`)
      writeFileSync(page, html.replace(/<meta name="forge-live" content="[^"]*">/, `<meta name="forge-live" content="${live}">`))
    },
  }
}

// The Forge's wallet bundle: src/forge-wallet.ts → art/factory/forge/vendor/wallet.js, plus chunks in vendor/wallet/
// that load only when needed (wagmi on the first click; AppKit too when VITE_REOWN_PROJECT_ID is set). An ES module
// with code splitting, loaded by the Forge with <script type="module" src="vendor/wallet.js"> (CSP script-src 'self').
//
// `npm run build:wallet` writes the copy in art/factory/forge/vendor (then run art/factory/sync_forge.sh).
// `npm run build` (what Vercel runs) builds it again straight into dist/forge/vendor with --outDir, so the deploy's
// VITE_* env (VITE_REOWN_PROJECT_ID, VITE_CHAIN, VITE_RPC_URL, VITE_LIVE) is what ships; VITE_LIVE is also written
// into dist/forge/index.html for live.js (liveFlag).
export default defineConfig(({ mode }) => ({
  plugins: [launchChecks(mode), liveFlag(mode)],
  publicDir: false,
  build: {
    outDir: SOURCE_OUT,
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
