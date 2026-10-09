// Wallet and chain plumbing for Cardworks: the Robinhood Chain config, the wallet connection (wagmi core + Reown
// AppKit's modal) and friendly wallet errors. Sending and waiting for transactions: tx.ts.
//
// The connection is the standard stack: wagmi core holds the connection state (persisted in localStorage and restored
// on reload without a prompt), viem does the RPC, and Reown AppKit draws the modal. Wallets come from EIP-6963
// discovery (every installed extension, with its own name and icon), WalletConnect (QR code on desktop, deep links on
// phones) and Coinbase Wallet. Robinhood Chain is the only network; the wallet is asked to add or switch to it when
// the user connects. WalletConnect and the AppKit modal need VITE_REOWN_PROJECT_ID; without it, see REOWN_PROJECT_ID.
//
// Nothing in this module sends a transaction or asks for a signature: it connects, reads, and switches chain.

import {
  createPublicClient, defineChain, erc20Abi, formatUnits, http, BaseError, ChainMismatchError, InsufficientFundsError,
  UserRejectedRequestError, type Address, type PublicClient, type Transport, type WalletClient,
} from "viem";
import {
  connect as wagmiConnect, createConfig, disconnect as wagmiDisconnect, getAccount as wagmiGetAccount,
  getWalletClient as wagmiGetWalletClient, injected, reconnect, switchChain, watchAccount as wagmiWatchAccount, type Config,
} from "@wagmi/core";
import { coinbaseWallet } from "@wagmi/connectors";
// AppKit is loaded only when there's a project id (dynamic import in start())
import type { AppKit } from "@reown/appkit";
import type { AppKitNetwork } from "@reown/appkit/networks";

// ---------- chain

/** VITE_CHAIN=testnet: Robinhood Chain testnet (46630), play tokens only. */
export const TESTNET = import.meta.env.VITE_CHAIN === "testnet";
export const PUBLIC_RPC = TESTNET ? "https://rpc.testnet.chain.robinhood.com/rpc" : "https://rpc.mainnet.chain.robinhood.com";
export const EXPLORER = TESTNET ? "https://explorer.testnet.chain.robinhood.com" : "https://robinhoodchain.blockscout.com";
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
/** What the site reads through (may be a private RPC from VITE_RPC_URL). Never handed to a wallet. */
export const READ_RPC = import.meta.env.VITE_RPC_URL || PUBLIC_RPC;

/** What the site reads through (may be a private RPC from VITE_RPC_URL). */
export const robinhood = defineChain({
  id: TESTNET ? 46630 : 4663,
  name: TESTNET ? "Robinhood Chain Testnet" : "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [READ_RPC] } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER } },
  testnet: TESTNET,
});
/** What we ever hand to a user's wallet (wallet_addEthereumChain): only the public RPC, never a private URL. */
export const robinhoodPublic = defineChain({ ...robinhood, rpcUrls: { default: { http: [PUBLIC_RPC] } } });

/** The site's tokens (18 decimals). */
export const PAPER: Address = "0x06420168Ed7e368dd8dcB30C79CdD0D8F4ccb3e6";
export const PLANK: Address = "0x69420eaf0eBF43E08F621B014f25cEfDfA7e2DDc";

// ---------- connection

/** Public (not a secret): identifies the site to Reown/WalletConnect. Without it there is no WalletConnect and no
 *  AppKit modal: initWallet() falls back to plain wagmi with the installed (EIP-6963) wallets and Coinbase Wallet,
 *  and the page draws its own short wallet list from listWallets(). */
export const REOWN_PROJECT_ID = import.meta.env.VITE_REOWN_PROJECT_ID?.trim() || "";
/** The live site (what wallets show as the requesting site there). */
export const SITE_URL = "https://web-mu-mocha-95.vercel.app";

export type WalletAccount = {
  /** "connected" only once the wallet has given an address. */
  status: "connected" | "connecting" | "reconnecting" | "disconnected";
  address?: Address;
  chainId?: number;
  /** Connected and on Robinhood Chain. */
  onRobinhood: boolean;
  /** The wallet's own name, e.g. "MetaMask" or "Rabby Wallet". */
  walletName?: string;
};
/** A wallet the user can pick (fallback mode, no AppKit): the installed extensions, then Coinbase Wallet. */
export type WalletChoice = { id: string; name: string; icon?: string; installed: boolean };

type Kit = { config: Config; modal?: AppKit };
let kit: Kit | undefined;
let starting: Promise<Kit> | undefined;

export type WalletOptions = {
  /** Absolute or page-relative URL of the site icon shown in the modal and in the wallet. */
  icon?: string;
  /** Turns WalletConnect and the AppKit modal on; defaults to VITE_REOWN_PROJECT_ID. */
  projectId?: string;
};

/** Is there a connection from an earlier visit to restore? (wagmi's persisted state; no wallet is asked.) */
export function hadSession(): boolean {
  try { return !!JSON.parse(localStorage.getItem("wagmi.store") || "null")?.state?.current; } catch { return false; }
}

/** Set up wagmi (and the AppKit modal when there's a project id), then quietly restore last visit's connection: the
 *  wallet is asked for its accounts with eth_accounts, which never prompts. Safe to call more than once. */
export function initWallet(opts: WalletOptions = {}): Promise<Kit> {
  return (starting ??= start(opts).then((k) => (kit = k)));
}

async function start(opts: WalletOptions): Promise<Kit> {
  const projectId = opts.projectId ?? REOWN_PROJECT_ID;
  const icon = new URL(opts.icon ?? "/forge/ui/omni-mark.webp", location.href).href;
  const metadata = {
    name: "Omni Cardworks",
    description: "Wood in. Packs out. Trading cards forged on Robinhood Chain.",
    // must match the page's origin or WalletConnect's Verify flags the site; on the live site this is SITE_URL
    url: location.origin,
    icons: [icon],
  };
  // reads go through the site's RPC; the wallet only ever sees the public one (robinhoodPublic)
  const transports: Record<number, Transport> = { [robinhood.id]: http(READ_RPC) };
  // Coinbase Wallet as a regular wallet (no smart wallet: the start of a sale is for regular wallets only),
  // without the SDK's telemetry (it injects an inline script, which the CSP blocks anyway)
  const coinbase = coinbaseWallet({ appName: metadata.name, appLogoUrl: icon, preference: { options: "eoaOnly", telemetry: false } });

  if (!projectId) {
    // multiInjectedProviderDiscovery (EIP-6963) is on by default: every installed wallet shows up by name and icon
    const config = createConfig({ chains: [robinhoodPublic], connectors: [coinbase], transports: transports as Record<typeof robinhood.id, Transport> });
    watchAfterConnect(config);
    await reconnect(config).catch(() => []);
    return { config };
  }

  const [{ createAppKit }, { WagmiAdapter }, { OptionsController }] = await Promise.all([
    import("@reown/appkit"), import("@reown/appkit-adapter-wagmi"), import("@reown/appkit-controllers"),
  ]);
  const network = { ...robinhoodPublic, caipNetworkId: `eip155:${robinhood.id}`, chainNamespace: "eip155" } as AppKitNetwork;
  const adapter = new WagmiAdapter({ networks: [network], projectId, transports, connectors: [coinbase] });
  // no Base Account (a smart-contract wallet) either; createAppKit has no option for it in this version
  OptionsController.setEnableBaseAccount(false);
  const modal = createAppKit({
    adapters: [adapter],
    networks: [network],
    defaultNetwork: network,
    projectId,
    metadata,
    // connect and look only: no email or social logins, no swaps, on-ramp, send or receive, no history, no analytics
    features: {
      email: false, socials: false, swaps: false, onramp: false, send: false, receive: false, history: false,
      analytics: false, emailShowWallets: false, pay: false, reownAuthentication: false, smartSessions: false,
      connectorTypeOrder: ["injected", "recent", "walletConnect", "featured", "custom", "external", "recommended"],
    },
    // shown first in the list (WalletGuide ids, as in AppKit's PresetsUtil): MetaMask, Coinbase Wallet, OKX Wallet.
    // Installed wallets (EIP-6963) are always listed on top by their own name and icon.
    featuredWalletIds: [
      "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96",
      "d0ca99ff52b99abc48743dad0f7fc891e041be73574f7fac4afe5d4bb83845c8",
      "971e689d0a5be527bac79629b4ee9b925e82208e5168b733496a09c0faed0709",
    ],
    enableWalletConnect: true,
    enableEIP6963: true,
    enableInjected: true,
    // Coinbase Wallet is our own connector above; AppKit's would load the SDK with telemetry on
    enableCoinbase: false,
    enableNetworkSwitch: true,
    allowUnsupportedChain: false,
    tokens: { [`eip155:${robinhood.id}`]: { address: PAPER } },
    chainImages: { [robinhood.id]: icon },
    themeMode: "dark",
    themeVariables: {
      "--w3m-font-family": "Nunito, system-ui, sans-serif",
      "--w3m-accent": "#e9b45a",
      "--w3m-color-mix": "#1f1710",
      "--w3m-color-mix-strength": 32,
      "--w3m-border-radius-master": "3px",
      "--w3m-z-index": 1000,
      "--w3m-qr-color": "#15100c",
    },
  });
  watchAfterConnect(adapter.wagmiConfig);
  return { config: adapter.wagmiConfig, modal };
}

const ready = (): Promise<Kit> => kit ? Promise.resolve(kit) : initWallet();

/** True when the AppKit modal is available (a project id is set); otherwise use listWallets() + connectWith(). */
export const hasModal = (): boolean => !!kit?.modal;

/** Open the wallet modal: the wallet list when disconnected, the account view (copy address, disconnect) when
 *  connected. Connected on the wrong chain: asks the wallet to switch first. Returns false in fallback mode (no
 *  modal): the page shows listWallets() instead. */
export async function connect(): Promise<boolean> {
  const { modal, config } = await ready();
  const a = wagmiGetAccount(config);
  if (a.status === "connected" && a.chainId !== robinhood.id) {
    try { await switchToRobinhood(); return true; } catch { /* they said no: show the account view */ }
  }
  if (!modal) return false;
  await modal.open({ view: a.status === "connected" ? "Account" : "Connect" });
  return true;
}

/** The wallets to offer (fallback mode): EIP-6963 extensions with their own names and icons, then Coinbase Wallet. */
export async function listWallets(): Promise<WalletChoice[]> {
  const { config } = await ready();
  const out: WalletChoice[] = [];
  const six = config.connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  for (const c of six) out.push({ id: c.id, name: c.name, icon: c.icon, installed: true });
  // a wallet that injects window.ethereum but doesn't announce itself (EIP-6963)
  if (!six.length && (window as { ethereum?: unknown }).ethereum) out.push({ id: "injected", name: "Browser wallet", installed: true });
  for (const c of config.connectors.filter((c) => c.type !== "injected")) out.push({ id: c.id, name: c.name, icon: c.icon, installed: false });
  return out;
}

/** Connect one wallet from listWallets() and put it on Robinhood Chain (adding the chain if the wallet lacks it). */
export async function connectWith(id: string): Promise<void> {
  const { config } = await ready();
  let connector = config.connectors.find((c) => c.id === id);
  if (!connector && id === "injected") connector = config._internal.connectors.setup(injected());
  if (!connector) throw new Error("That wallet isn't available any more.");
  await wagmiConnect(config, { connector, chainId: robinhood.id });
}

/** Forget the connection (the wallet itself stays unlocked). */
export async function disconnect(): Promise<void> {
  const { modal, config } = await ready();
  if (modal) await modal.disconnect().catch(() => {});
  if (wagmiGetAccount(config).status !== "disconnected") await wagmiDisconnect(config);
}

function toAccount(a: ReturnType<typeof wagmiGetAccount>): WalletAccount {
  if (a.status !== "connected") return { status: a.status, onRobinhood: false };
  return { status: "connected", address: a.address, chainId: a.chainId, onRobinhood: a.chainId === robinhood.id, walletName: a.connector.name };
}

/** The connection now ("disconnected" until initWallet() has finished). */
export function getAccount(): WalletAccount {
  return kit ? toAccount(wagmiGetAccount(kit.config)) : { status: "disconnected", onRobinhood: false };
}

/** Called on every change: connect, disconnect, another account picked in the wallet, another chain. Returns unwatch. */
export function watchAccount(cb: (a: WalletAccount) => void): () => void {
  let off: (() => void) | undefined, gone = false;
  ready().then(({ config }) => { if (!gone) off = wagmiWatchAccount(config, { onChange: (a) => cb(toAccount(a)) }); });
  return () => { gone = true; off?.(); };
}

/** Ask the wallet to switch to Robinhood Chain; wagmi adds the chain first if the wallet doesn't know it (4902). */
export async function switchToRobinhood(): Promise<void> {
  const { config } = await ready();
  if (wagmiGetAccount(config).chainId === robinhood.id) return;
  await switchChain(config, { chainId: robinhood.id, addEthereumChainParameter: {
    chainName: robinhoodPublic.name, nativeCurrency: robinhoodPublic.nativeCurrency, rpcUrls: [PUBLIC_RPC], blockExplorerUrls: [EXPLORER],
  } });
}

/** After a user-initiated connect (not the silent reconnect on page load), make sure the wallet is on Robinhood Chain. */
function watchAfterConnect(config: Config) {
  wagmiWatchAccount(config, {
    onChange(a, prev) {
      const fresh = a.status === "connected" && prev.status === "connecting";
      if (fresh && a.chainId !== robinhood.id) switchToRobinhood().catch(() => { /* stays "wrong network" until they click */ });
    },
  });
}

let pub: PublicClient | undefined;
/** Reads Robinhood Chain through the site's RPC, whatever chain the wallet is on. Needs no wallet. */
export function getPublicClient(): PublicClient {
  return (pub ??= createPublicClient({ chain: robinhood, transport: http(READ_RPC) }) as PublicClient);
}

/** The connected wallet, on Robinhood Chain (for the live contract calls later). Throws if not connected. */
export async function getWalletClient(): Promise<WalletClient> {
  return (await wagmiGetWalletClient((await ready()).config, { chainId: robinhood.id })) as WalletClient;
}

/** An ERC-20 balance on Robinhood Chain (raw units). */
export async function readBalance(token: Address, owner: Address): Promise<bigint> {
  return getPublicClient().readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

/** A token amount for people: at most `digits` decimals, trailing zeros dropped, thousands separated. */
export function formatAmount(raw: bigint, decimals = 18, digits = 2): string {
  const [i, f = ""] = formatUnits(raw, decimals).split(".");
  const frac = f.slice(0, digits).replace(/0+$/, "");
  return BigInt(i).toLocaleString("en-US") + (frac ? "." + frac : "");
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// ---------- errors

/** True if any error in the cause chain carries this code (EIP-1193 / JSON-RPC). */
export function hasCode(e: unknown, code: number): boolean {
  for (let x = e as { code?: unknown; cause?: unknown } | undefined, i = 0; x && i < 10; x = x.cause as typeof x, i++) {
    if (x.code === code) return true;
  }
  return false;
}

const is = (e: unknown, name: string, code?: number) => e instanceof BaseError
  ? !!e.walk((x) => (x as Error)?.name === name || (code !== undefined && (x as { code?: unknown })?.code === code))
  : (e as Error)?.name === name || (code !== undefined && hasCode(e, code));

/** A short, human reason for a failed wallet action. Contract errors are errors.ts explain() (which falls back to
 *  this); sending and waiting for a transaction has one path, tx.ts sendTx. */
export function friendly(e: unknown): string {
  if (is(e, UserRejectedRequestError.name, UserRejectedRequestError.code) || is(e, "UserRejectedRequestError") || hasCode(e, 4001)) return "You cancelled in your wallet.";
  if (is(e, ChainMismatchError.name) || is(e, "ChainNotConfiguredError") || is(e, "SwitchChainNotSupportedError") || is(e, "ConnectorChainMismatchError")) {
    return `Your wallet is on another network. Switch it to ${robinhood.name} and try again.`;
  }
  if (is(e, InsufficientFundsError.name)) return `Not enough ETH on ${robinhood.name} to pay the network fee.`;
  if (is(e, "ConnectorNotConnectedError") || is(e, "ConnectorAccountNotFoundError") || hasCode(e, 4100)) return "Connect your wallet first.";
  if (hasCode(e, -32002)) return "Your wallet already has a request open. Check the wallet window.";
  if (e instanceof BaseError) return (e.shortMessage || e.message).split("\n")[0].slice(0, 160);
  return ((e as Error)?.message ?? String(e)).split("\n")[0].slice(0, 160);
}
