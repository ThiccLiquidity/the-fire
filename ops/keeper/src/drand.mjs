// drand evmnet: the chain OpenDrandRouter verifies (docs/randomness.md). Same constants as web/src/lib/drand.ts.

export const DRAND_CHAIN = "04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3";
export const DRAND_GENESIS = 1727521075n;
export const DRAND_PERIOD = 3n;
export const DEFAULT_DRAND_URLS = ["https://api.drand.sh", "https://api2.drand.sh", "https://api3.drand.sh"];

/** When drand publishes `round` (unix seconds). */
export const roundTime = (round) => DRAND_GENESIS + (BigInt(round) - 1n) * DRAND_PERIOD;

/** The round drand should have published by `nowSec` (unix seconds). */
export const roundAt = (nowSec) => (BigInt(nowSec) - DRAND_GENESIS) / DRAND_PERIOD + 1n;

const SIG = /^[0-9a-f]{128}$/i;

/**
 * Talks to the drand relays (`urls`, tried in order). Signatures are cached: a round never changes.
 * `fetchFn` is injectable for tests.
 */
export function drandClient(urls = DEFAULT_DRAND_URLS, fetchFn = globalThis.fetch, timeoutMs = 10_000) {
  const cache = new Map();
  const base = urls.map((u) => u.replace(/\/$/, ""));
  async function get(u) {
    const r = await fetchFn(u, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return undefined;
    return r.json();
  }
  return {
    urls: base,
    /** The round's signature (0x + 64 bytes hex), or undefined if no relay has it (yet). */
    async signature(round) {
      const key = String(round);
      if (cache.has(key)) return cache.get(key);
      for (const b of base) {
        try {
          const j = await get(`${b}/${DRAND_CHAIN}/public/${key}`);
          if (j && String(j.round) === key && SIG.test(j.signature)) {
            const sig = `0x${j.signature.toLowerCase()}`;
            cache.set(key, sig);
            return sig;
          }
        } catch { /* next relay */ }
      }
      return undefined;
    },
    /** The newest round any relay reports, or undefined if none answered. */
    async latest() {
      let best;
      for (const b of base) {
        try {
          const j = await get(`${b}/${DRAND_CHAIN}/public/latest`);
          if (j && j.round != null) {
            const r = BigInt(j.round);
            if (best === undefined || r > best) best = r;
          }
        } catch { /* next relay */ }
      }
      return best;
    },
  };
}
