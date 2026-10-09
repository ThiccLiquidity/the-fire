// ForgeData over the Blockscout v2 REST API (the Robinhood Chain explorer): NFTs held by a wallet, and recent pack
// and card transfers. Read-only, no key. The explorer hosts are in the CSP's connect-src (vercel.json).
//
// Endpoints:
//   GET /api/v2/addresses/{owner}/nft?type=ERC-721,ERC-1155            NFTs held (filtered to our two contracts)
//   GET /api/v2/tokens/{contract}/transfers                            a collection's transfers
//   GET /api/v2/addresses/{owner}/token-transfers?type=...&token=...   one wallet's transfers of a collection
// Paging: each response carries next_page_params; they go back as query parameters for the next page.
// Each request gives up after TIMEOUT_MS; a 429 (rate limited) or 503 waits (Retry-After, else a growing backoff) and
// is tried again a few times. An ERC-1155 batch transfer (several pack Series in one) comes back as one item with a
// list of totals (or token_ids + amounts): each token id becomes its own Activity.

import { getAddress, zeroAddress, type Address, type Hex } from "viem";
import type { Activity, ActivityKind, ForgeContracts, ForgeData, OwnedCard, OwnedPack, Page } from "./data";
import { EXPLORER } from "./wallet";

type Json = Record<string, unknown>;
type BsToken = { address?: string; address_hash?: string; type?: string };
type BsNft = { id?: string; value?: string; image_url?: string | null; metadata?: Json | null; token?: BsToken; token_type?: string };
type BsTotal = { token_id?: string | null; value?: string | null };
type BsTransfer = {
  from?: { hash?: string }; to?: { hash?: string }; token?: BsToken; type?: string; method?: string | null; timestamp?: string;
  transaction_hash?: string; tx_hash?: string; total?: BsTotal | BsTotal[] | null;
  /** ERC-1155 batch transfers, in Blockscout versions that list them this way. */
  token_ids?: (string | null)[] | null; amounts?: (string | null)[] | null;
};
type BsPage<T> = { items?: T[]; next_page_params?: Json | null };

const tokenAddr = (t?: BsToken) => (t?.address_hash ?? t?.address ?? "").toLowerCase();
const big = (v: unknown) => { try { return BigInt(String(v ?? "0")); } catch { return 0n; } };
const encodeNext = (p?: Json | null) => (p ? btoa(JSON.stringify(p)) : undefined);
const decodeNext = (s?: string): Json => { try { return s ? JSON.parse(atob(s)) : {}; } catch { return {}; } };

export class BlockscoutError extends Error {
  /** The HTTP status; 0 when it timed out or the network failed. */
  status: number;
  constructor(status: number, path: string) {
    super(status ? `The explorer didn't answer (${status}) for ${path}.` : `The explorer didn't answer in time for ${path}.`);
    this.name = "BlockscoutError"; this.status = status;
  }
}

/** How long one request may take. */
export const TIMEOUT_MS = 15_000;
/** How many more tries a rate-limited (429) or unavailable (503) request gets. */
const RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** How long to wait before trying again: Retry-After (seconds or a date), else 1 s, 2 s, 4 s; at most 30 s. */
function backoff(r: Response, attempt: number): number {
  const ra = r.headers.get("retry-after")?.trim();
  const ms = ra ? (/^\d+$/.test(ra) ? Number(ra) * 1000 : Date.parse(ra) - Date.now()) : NaN;
  return Math.min(30_000, Math.max(250, Number.isFinite(ms) ? ms : 1000 * 2 ** attempt));
}

export class BlockscoutData implements ForgeData {
  private base: string;
  private packs: string;
  private cards: string;
  private c: ForgeContracts;
  private fetcher: typeof fetch;

  /** base: the explorer (default: Robinhood Chain's Blockscout, or its testnet with VITE_CHAIN=testnet). */
  constructor(contracts: ForgeContracts, base: string = EXPLORER, fetcher: typeof fetch = (...a) => fetch(...a)) {
    this.fetcher = fetcher;
    this.base = base.replace(/\/$/, "");
    this.c = contracts;
    this.packs = contracts.packs.toLowerCase();
    this.cards = contracts.cards.toLowerCase();
  }

  private async get<T>(path: string, query: Record<string, unknown> = {}): Promise<T> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
    const url = `${this.base}/api/v2${path}${q.size ? "?" + q : ""}`;
    for (let attempt = 0; ; attempt++) {
      let r: Response;
      try { r = await this.fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
      catch { throw new BlockscoutError(0, path); } // timed out, or the network failed
      if (r.ok) return r.json() as Promise<T>;
      if ((r.status === 429 || r.status === 503) && attempt < RETRIES) { await sleep(backoff(r, attempt)); continue; }
      throw new BlockscoutError(r.status, path);
    }
  }

  /** Every NFT `owner` holds from one of our contracts (all pages). */
  private async nfts(owner: Address, type: string, contract: string, next?: string): Promise<{ items: BsNft[]; next?: string }> {
    const out: BsNft[] = [];
    let params = decodeNext(next), more: Json | null | undefined;
    // the endpoint can't filter by contract, so keep paging until a page has some of ours (or it runs out)
    for (let i = 0; i < 20; i++) {
      const page = await this.get<BsPage<BsNft>>(`/addresses/${owner}/nft`, { type, ...params });
      out.push(...(page.items ?? []).filter((n) => tokenAddr(n.token) === contract));
      more = page.next_page_params;
      if (!more || out.length) break;
      params = more;
    }
    return { items: out, next: encodeNext(more) };
  }

  async packsOf(owner: Address): Promise<OwnedPack[]> {
    const all: BsNft[] = [];
    let next: string | undefined;
    do { const p = await this.nfts(owner, "ERC-1155", this.packs, next); all.push(...p.items); next = p.next; } while (next);
    return all.map((n) => ({ series: Number(big(n.id)), count: big(n.value), image: n.image_url ?? undefined }))
      .filter((p) => p.count > 0n).sort((a, b) => b.series - a.series);
  }

  async cardsOf(owner: Address, next?: string): Promise<Page<OwnedCard>> {
    const p = await this.nfts(owner, "ERC-721", this.cards, next);
    const items = p.items.map((n): OwnedCard => {
      const m = n.metadata ?? {};
      const attrs = Array.isArray(m.attributes) ? (m.attributes as { trait_type?: string; value?: string | number }[]) : [];
      return {
        tokenId: big(n.id),
        name: typeof m.name === "string" ? m.name : undefined,
        image: n.image_url ?? (typeof m.image === "string" ? m.image : undefined),
        traits: Object.fromEntries(attrs.filter((a) => a.trait_type).map((a) => [a.trait_type!, a.value ?? ""])),
      };
    });
    return { items, next: p.next };
  }

  async activity(opts: { owner?: Address; next?: string } = {}): Promise<Page<Activity>> {
    const params = decodeNext(opts.next);
    let items: BsTransfer[], more: Json | null | undefined;
    if (opts.owner) {
      // one wallet: both collections in one list
      const page = await this.get<BsPage<BsTransfer>>(`/addresses/${opts.owner}/token-transfers`, { type: "ERC-721,ERC-1155", ...params });
      items = (page.items ?? []).filter((t) => [this.packs, this.cards].includes(tokenAddr(t.token)));
      more = page.next_page_params;
    } else {
      // the whole Forge: the two collections' feeds, merged newest first (each pages on its own)
      const { p: pp, c: cp } = params as { p?: Json | null; c?: Json | null };
      const none: BsPage<BsTransfer> = { items: [] };
      const [pk, cd] = await Promise.all([
        pp === null ? none : this.get<BsPage<BsTransfer>>(`/tokens/${this.c.packs}/transfers`, pp ?? {}),
        cp === null ? none : this.get<BsPage<BsTransfer>>(`/tokens/${this.c.cards}/transfers`, cp ?? {}),
      ]);
      items = [...(pk.items ?? []), ...(cd.items ?? [])];
      const np = pk.next_page_params ?? null, nc = cd.next_page_params ?? null;
      more = np || nc ? { p: np, c: nc } : null;
    }
    const acts = items.flatMap((t) => this.toActivities(t)).sort((a, b) => b.at - a.at);
    return { items: acts, next: encodeNext(more) };
  }

  /** One transfer as Activity items: one per token id (an ERC-1155 batch moves several at once). */
  private toActivities(t: BsTransfer): Activity[] {
    const hash = (t.transaction_hash ?? t.tx_hash) as Hex | undefined;
    if (!hash) return [];
    const from = getAddress(t.from?.hash ?? zeroAddress), to = getAddress(t.to?.hash ?? zeroAddress);
    const kind: ActivityKind = t.type === "token_minting" || from === zeroAddress ? "mint"
      : t.type === "token_burning" || to === zeroAddress ? "burn" : "transfer";
    const packs = tokenAddr(t.token) === this.packs;
    const totals: BsTotal[] = Array.isArray(t.total) ? t.total
      : t.total ? [t.total]
      : Array.isArray(t.token_ids) ? t.token_ids.map((id, i) => ({ token_id: id, value: t.amounts?.[i] ?? "1" }))
      : [{}];
    return totals.map((x) => ({
      kind, token: packs ? "packs" : "cards", tokenId: big(x.token_id), amount: packs ? big(x.value ?? 1) : 1n,
      from, to, tx: hash, at: t.timestamp ? Date.parse(t.timestamp) : 0, method: t.method ?? undefined,
    }));
  }
}
