// Shared by the doors (/doors/) and the Printing Press (/press/): live or demo, and the way home.
//
// Live or demo follows the Forge's rule (core.js LIVE_NET, net.ts, forge-wallet.ts): ?live=testnet|mainnet, else
// ?live=off (the demo), else the build's VITE_LIVE (empty = the demo).

export type LiveNet = "testnet" | "mainnet" | null;

export function liveNet(): LiveNet {
  const ok = (v: string | null | undefined): LiveNet => (v === "testnet" || v === "mainnet" ? v : null);
  const q = new URLSearchParams(location.search).get("live");
  if (q === "off") return null;
  return ok(q) ?? ok(document.querySelector<HTMLMetaElement>('meta[name="forge-live"]')?.content)
    ?? ok(import.meta.env.VITE_LIVE); // these pages are built by vite: the build's VITE_LIVE
}

/** Where "Home" goes: the two doors. /doors/ until the owner switches "/" to the doors (then <meta name="site-home"
 *  content="/">). */
export function homeUrl(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="site-home"]')?.content || "/doors/";
}

/** Remember (this tab) that the visitor came through the doors, so Cardworks shows its Home button too
 *  (forge/home.js reads the same key). */
export function markDoors(): void {
  try { sessionStorage.setItem("omni.doors", "1"); } catch { /* private window */ }
}

/** Keep ?live= on links between the sides, so a live session stays live. */
export function withMode(href: string): string {
  const q = new URLSearchParams(location.search).get("live");
  if (!q) return href;
  const u = new URL(href, location.href);
  u.searchParams.set("live", q);
  return u.pathname + u.search + u.hash;
}

export const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;
