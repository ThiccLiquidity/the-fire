import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/** Production build guard: the site's CSP (vercel.json connect-src) must allow the RPC it reads through, or every read
 *  is blocked in production only (vite preview doesn't apply vercel.json). */
export function launchChecks(mode: string): Plugin {
  return {
    name: 'forge-launch-checks',
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
    },
  }
}

// The live site is the static Forge in public/forge (copied as-is into dist). index.html only points / at it;
// Vercel also redirects / to /forge/ (vercel.json). src/lib holds the chain, wallet, swap and card-ABI modules;
// `tsc -b` type-checks them. The wallet bundle for the Forge (src/forge-wallet.ts, vite.wallet.config.ts) is ready
// but not wired into the site yet; `npm run build:wallet` builds it.
// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [launchChecks(mode)],
}))
