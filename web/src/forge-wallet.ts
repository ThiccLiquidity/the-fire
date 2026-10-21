// The Forge's wallet bundle (vite.wallet.config.ts → art/factory/forge/vendor/wallet.js). The Forge is plain static JS,
// so this exposes the wallet as window.ForgeWallet and fires "forgewallet:ready" on window once it's there.
//
// ForgeWallet is read-only: it connects, shows the address and the PAPER balance, and switches chain. It never sends a
// transaction or asks for a signature, and it never opens anything until the user clicks.
//
// window.ForgeChain is the live site: the card contracts' reads and writes (src/lib/chain). Only a page opened with
// ?live=testnet or ?live=mainnet (or a build with VITE_LIVE) can load it; otherwise ForgeChain.live is null and the
// page stays in demo mode with nothing chain-related loaded. Every write goes through the wallet, which asks the user.
//
// This entry is tiny. The wallet stack (wagmi, and AppKit when there's a project id) loads on the first click, or
// right away for someone who was connected last visit, so their connection comes back by itself.

type Hex = `0x${string}`;
type WalletLib = typeof import("./lib/wallet");
type WalletAccount = import("./lib/wallet").WalletAccount;
export type WalletChoice = import("./lib/wallet").WalletChoice;

export type ForgeWalletState = {
  status: WalletAccount["status"];
  connected: boolean;
  address: string | null;
  /** 0x1234…abcd */
  short: string | null;
  /** On Robinhood Chain. */
  chainOk: boolean;
  chainName: string;
  walletName: string | null;
  /** The PAPER balance, formatted ("1,250.5"), or null while unknown. */
  paper: string | null;
  paperRaw: bigint | null;
  /** The wallet modal is AppKit's (a Reown project id is set). False: the page shows wallets() itself. */
  modal: boolean | null;
};

const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
type Listener = (s: ForgeWalletState) => void;
const listeners = new Set<Listener>();
let lib: WalletLib | undefined;
let acct: WalletAccount = { status: "disconnected", onRobinhood: false };
let paperRaw: bigint | null = null;
let paperFor: string | null = null; // the address paperRaw belongs to

function state(): ForgeWalletState {
  const connected = acct.status === "connected" && !!acct.address;
  const paperOk = connected && paperFor === acct.address && paperRaw !== null;
  return {
    status: acct.status, connected,
    address: connected ? acct.address! : null,
    short: connected ? shortAddress(acct.address!) : null,
    chainOk: acct.onRobinhood, chainName: lib?.robinhood.name ?? "Robinhood Chain",
    walletName: acct.walletName ?? null,
    paper: paperOk && lib ? lib.formatAmount(paperRaw!) : null,
    paperRaw: paperOk ? paperRaw : null,
    modal: lib ? lib.hasModal() : null,
  };
}
function emit() { const s = state(); listeners.forEach((l) => { try { l(s); } catch (e) { console.error(e); } }); }

let seq = 0;
async function refreshPaper() {
  const a = acct.address;
  if (!lib || acct.status !== "connected" || !a) return;
  const n = ++seq;
  try {
    const raw = await lib.readBalance(lib.PAPER, a);
    if (n === seq && acct.address === a) { paperRaw = raw; paperFor = a; emit(); }
  } catch (e) { console.warn("Couldn't read the PAPER balance", e); }
}

let timer: ReturnType<typeof setInterval> | undefined;
function onAccount(a: WalletAccount) {
  const changed = a.address !== acct.address || a.chainId !== acct.chainId;
  acct = a;
  if (a.status !== "connected") { paperRaw = null; paperFor = null; }
  emit();
  if (a.status === "connected" && changed) refreshPaper();
  clearInterval(timer);
  if (a.status === "connected") timer = setInterval(() => { if (!document.hidden) refreshPaper(); }, 30_000);
}

let loading: Promise<WalletLib> | undefined;
function load(): Promise<WalletLib> {
  return (loading ??= import("./lib/wallet").then(async (w) => {
    await w.initWallet({ icon: new URL("ui/omni-mark.webp", document.baseURI).href });
    lib = w;
    w.watchAccount(onAccount);
    onAccount(w.getAccount());
    return w;
  }).catch((e) => { loading = undefined; throw e; }));
}

/** wagmi's persisted state says a wallet was connected last visit (no wallet is asked). */
function hadSession(): boolean {
  try { return !!JSON.parse(localStorage.getItem("wagmi.store") || "null")?.state?.current; } catch { return false; }
}

// A local test chain only (web/scripts/forge-e2e): the test sets globalThis.__FORGE_NET__ (name "local") and
// __FORGE_TEST__ = { key } before the page loads, and "Connect" signs with that anvil dev account instead of a wallet
// (drand is stood in for too: the dev router takes any signature). Inert on any real network: wallet.ts refuses a
// local signer unless the chain is "local", and nothing on the site sets either global.
const testKey = (): Hex | null => {
  const t = (globalThis as { __FORGE_TEST__?: { key?: string } }).__FORGE_TEST__;
  return globalThis.__FORGE_NET__?.name === "local" && /^0x[0-9a-f]{64}$/i.test(t?.key ?? "") ? (t!.key as Hex) : null;
};
async function connectTestSigner(key: Hex) {
  const [w, c, { privateKeyToAccount }, { keccak256, toHex }] = await Promise.all([load(), ForgeChain.lib(), import("viem/accounts"), import("viem")]);
  w.setLocalSigner(privateKeyToAccount(key));
  c.setSignatureSource(async (round) => (keccak256(toHex(`r${round}a`)) + keccak256(toHex(`r${round}b`)).slice(2)) as Hex);
  onAccount(w.getAccount());
}

const ForgeWallet = {
  /** Open the wallet modal: wallet list if disconnected, account view (copy, disconnect) if connected.
   *  Resolves "modal" when AppKit showed it, or "list" when the page should show wallets() itself (no project id). */
  async open(): Promise<"modal" | "list"> {
    const k = testKey();
    if (k) { await connectTestSigner(k); return "modal"; }
    return (await (await load()).connect()) ? "modal" : "list";
  },
  /** Fallback mode: the installed wallets (EIP-6963, real names and icons) and Coinbase Wallet. */
  async wallets(): Promise<WalletChoice[]> { return (await load()).listWallets(); },
  async connectWith(id: string): Promise<void> { await (await load()).connectWith(id); },
  async disconnect(): Promise<void> {
    const w = await load();
    if (testKey()) { w.setLocalSigner(undefined); onAccount(w.getAccount()); return; }
    await w.disconnect();
  },
  async switchNetwork(): Promise<void> { await (await load()).switchToRobinhood(); },
  /** A short, human reason for a failed wallet action. */
  friendly: (e: unknown): string => lib ? lib.friendly(e) : String((e as Error)?.message ?? e),
  refresh: () => refreshPaper(),
  state,
  /** Called now and on every change. Returns an unsubscribe function. */
  onChange(cb: Listener): () => void { listeners.add(cb); cb(state()); return () => listeners.delete(cb); },
  shortAddress,
};
export type ForgeWalletApi = typeof ForgeWallet;
declare global { interface Window { ForgeWallet?: ForgeWalletApi } }

window.ForgeWallet = ForgeWallet;

// ---------- live mode

type ChainLib = typeof import("./lib/chain");
const liveWanted: "testnet" | "mainnet" | null = (() => {
  const v = new URLSearchParams(location.search).get("live") ?? ((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_LIVE ?? "");
  return v === "testnet" || v === "mainnet" ? v : null;
})();
let chainLoading: Promise<ChainLib> | undefined;
const ForgeChain = {
  /** The network the page asked for (?live=testnet / mainnet), or null: demo mode. */
  live: liveWanted,
  /** The chain layer (reads and writes), loaded on first use; rejects in demo mode or when that network has no card
   *  contracts yet (mainnet before the deploy). Writes need a connected wallet (ForgeWallet). */
  lib(): Promise<ChainLib> {
    if (!liveWanted) return Promise.reject(new Error("The site is in demo mode."));
    return (chainLoading ??= import("./lib/chain").then((c) => {
      if (!c.isDeployed(c.NET) || (c.NET.name !== liveWanted && c.NET.name !== "local")) throw new Error(`The cards aren't deployed on ${c.NET.label} yet.`);
      return c;
    }).catch((e) => { chainLoading = undefined; throw e; }));
  },
  /** The connected wallet's address, or null. */
  me: (): string | null => state().address,
};
export type ForgeChainApi = typeof ForgeChain;
declare global { interface Window { ForgeChain?: ForgeChainApi } }
window.ForgeChain = ForgeChain;
addEventListener("focus", () => refreshPaper());
if (hadSession()) {
  acct = { status: "reconnecting", onRobinhood: false };
  load().catch((e) => { console.error("Wallet setup failed", e); acct = { status: "disconnected", onRobinhood: false }; emit(); });
}
dispatchEvent(new Event("forgewallet:ready"));
