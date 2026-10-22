import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, searchForWorkspaceRoot, type Plugin } from 'vite'

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

/** The Morning Wood's issues, served at /press/issues/<date>/ (issue.json + its pictures) with an index at
 *  /press/issues/index.json (newest first). Sources, by date: the paper pipeline's samples (../paper/samples/<date>/,
 *  made by the paper's own pipeline) win over the site's demo issues (press/demo/<date>/). The dev server serves them;
 *  the build copies them into dist/press/issues. Nothing here is read from the chain: the live paper (the MorningWood
 *  contract's issues) isn't wired in yet. */
export function pressIssues(): Plugin {
  const here = fileURLToPath(new URL('.', import.meta.url))
  const roots = [resolve(here, '../paper/samples'), resolve(here, 'press/demo')] // first wins
  const MIME: Record<string, string> = { '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.avif': 'image/avif' }
  const issues = () => {
    const byDate = new Map<string, string>()
    for (const r of roots) {
      if (!existsSync(r)) continue
      for (const d of readdirSync(r)) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && existsSync(join(r, d, 'issue.json')) && !byDate.has(d)) byDate.set(d, join(r, d))
    }
    return byDate
  }
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    // issue.json and its pictures only (the pipeline's working files next to it, like newspack.json, stay out)
    return statSync(p).isDirectory() ? files(p) : f === 'issue.json' || (MIME[extname(p).toLowerCase()] && extname(p) !== '.json') ? [p] : []
  })
  const index = () => JSON.stringify([...issues()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([date, dir]) => {
    const j = JSON.parse(readFileSync(join(dir, 'issue.json'), 'utf8')) as { number?: number; pages?: { stories?: { headline?: string }[] }[] }
    return { date, number: j.number ?? null, headline: j.pages?.[0]?.stories?.[0]?.headline ?? '' }
  }))
  return {
    name: 'press-issues',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/press\/issues\/(.+?)(\?.*)?$/.exec(req.url ?? '')
        if (!m) return next()
        const rel = decodeURIComponent(m[1])
        if (rel === 'index.json') { res.setHeader('content-type', 'application/json'); return res.end(index()) }
        const [date, ...rest] = rel.split('/'), dir = issues().get(date)
        const f = dir && resolve(dir, ...rest)
        if (!dir || !f || !f.startsWith(dir + sep) || !existsSync(f) || !statSync(f).isFile() || !MIME[extname(f).toLowerCase()] || (extname(f) === '.json' && rest.join('/') !== 'issue.json')) { res.statusCode = 404; return res.end() }
        res.setHeader('content-type', MIME[extname(f).toLowerCase()])
        res.end(readFileSync(f))
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'press/issues/index.json', source: index() })
      for (const [date, dir] of issues()) for (const f of files(dir)) {
        this.emitFile({ type: 'asset', fileName: `press/issues/${date}/${relative(dir, f).split(sep).join('/')}`, source: readFileSync(f) })
      }
    },
  }
}

// The live site is the static Forge in public/forge (copied as-is into dist). index.html only points / at it;
// Vercel also redirects / to /forge/ (vercel.json). src/lib holds the chain, wallet, swap and card-ABI modules;
// `tsc -b` type-checks them. The Forge's wallet bundle (src/forge-wallet.ts, vite.wallet.config.ts) is built by
// `npm run build` into dist/forge/vendor and loaded only in live mode (?live=testnet; forge/live.js).
// https://vite.dev/config/
// src/lib/config.ts reads ../deployments/<chainId>.json (the address file every tool shares): the dev server may serve it.
// The doors (doors/index.html, the landing with the Card Press and the Printing Press) and The Morning Wood
// (press/index.html) are pages of their own, built from src/doors and src/press.
export default defineConfig(({ mode }) => ({
  plugins: [launchChecks(mode), pressIssues()],
  server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), '../deployments'] } },
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        doors: fileURLToPath(new URL('./doors/index.html', import.meta.url)),
        press: fileURLToPath(new URL('./press/index.html', import.meta.url)),
      },
    },
  },
}))
