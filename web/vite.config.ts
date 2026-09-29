import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/** Production build guards. The site's CSP (vercel.json connect-src) must allow the RPC it reads through, or every read
 *  is blocked in production only (vite preview doesn't apply vercel.json). And a live build without a swap fee wallet
 *  silently charges no fee: say so loudly. */
function launchChecks(mode: string): Plugin {
  return {
    name: 'the-fire-launch-checks',
    apply: 'build',
    buildStart() {
      const env = loadEnv(mode, process.cwd(), 'VITE_')
      if (env.VITE_RPC_URL) {
        let host: string
        try { host = new URL(env.VITE_RPC_URL).host } catch { throw new Error(`VITE_RPC_URL isn't a URL: ${env.VITE_RPC_URL}`) }
        const csp = (JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as { headers: { headers: { key: string; value: string }[] }[] })
          .headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')?.value ?? ''
        const allowed = (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src')) ?? '').split(/\s+/).slice(1)
          .filter((src) => src.startsWith('https://')).map((src) => new URL(src.replace('*.', 'wildcard.')).host)
        const ok = allowed.some((a) => a.startsWith('wildcard.') ? host.endsWith(a.slice('wildcard'.length)) : a === host)
        if (!ok) throw new Error(`VITE_RPC_URL's host (${host}) isn't in vercel.json's connect-src, so the live site couldn't read the chain. Add https://${host} to connect-src, or leave VITE_RPC_URL empty.`)
      }
      if (env.VITE_FIRE_ADDRESS && /SWAP_FEE_WALLET[^=]*=\s*undefined/.test(readFileSync(new URL('./src/data/types.ts', import.meta.url), 'utf8'))) {
        const bar = '!'.repeat(78)
        console.warn(`\n${bar}\n  LIVE BUILD WITHOUT A SWAP FEE WALLET: SWAP_FEE_WALLET in src/data/types.ts is undefined,\n  so swaps charge no fee. Set it to the owner's fee wallet before the mainnet build.\n${bar}\n`)
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), launchChecks(mode)],
  // viem is most of the bundle; one ~600 kB chunk (~190 kB gzipped) is expected
  build: { chunkSizeWarningLimit: 800 },
}))
