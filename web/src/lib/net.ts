// Which chain the site talks to, decided once when the chain code first loads.
//
//   ?live=testnet   Robinhood Chain testnet (46630, deployments/46630.json), play tokens: the testnet run
//   ?live=mainnet   Robinhood Chain (4663, deployments/4663.json), only once that file has contracts
//   ?live=off       demo mode, whatever the build says
//   no ?live        VITE_LIVE (unset until launch day), else the site stays in demo mode: nothing here is loaded
//                   (the build writes VITE_LIVE into forge/index.html's <meta name="forge-live"> for live.js)
//
// Tests set globalThis.__FORGE_NET__ before importing (a local anvil chain with its own deployments file).
// VITE_CHAIN=testnet (older builds) still means testnet when VITE_LIVE isn't set.

import mainnetDeployment from "../../../deployments/4663.json";
import testnetDeployment from "../../../deployments/46630.json";
import type { Deployment } from "./config";

export type NetName = "mainnet" | "testnet" | "local";

export interface Net {
  name: NetName;
  chainId: number;
  /** The chain's name, as wallets show it. */
  label: string;
  /** Reads sent together go as one JSON-RPC batch of up to this many (VITE_RPC_BATCH); 0 = one request each. Off by
   *  default: the public testnet RPC refused big batches. Turn on with a paid RPC that takes them (try 10). */
  readBatch: number;
  /** Multicall3 on this chain: reads made together (in the same few milliseconds) go as one eth_call through it.
   *  Robinhood Chain and its testnet have it at the usual address; undefined = one eth_call per read. */
  multicall3?: `0x${string}`;
  /** What the site reads through (may be a private RPC from VITE_RPC_URL). Never handed to a wallet. */
  readRpc: string;
  /** What a wallet is given (wallet_addEthereumChain): the public RPC only. */
  publicRpc: string;
  /** The block explorer (Blockscout); "" when there is none (a local chain). */
  explorer: string;
  deployment: Deployment;
  /** drand relays (the signatures for card opens and grading). */
  drandUrls: string[];
  testnet: boolean;
}

const env = ((import.meta as { env?: Record<string, string | undefined> }).env ?? {}) as Record<string, string | undefined>;
const DRAND = ["https://api.drand.sh", "https://api2.drand.sh", "https://api3.drand.sh"];
/** Multicall3's address on nearly every EVM chain (Robinhood Chain and its testnet included). */
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export const MAINNET: Net = {
  name: "mainnet", chainId: 4663, label: "Robinhood Chain", readRpc: env.VITE_RPC_URL || "https://rpc.mainnet.chain.robinhood.com", readBatch: Math.max(0, Number(env.VITE_RPC_BATCH) || 0),
  publicRpc: "https://rpc.mainnet.chain.robinhood.com", explorer: "https://robinhoodchain.blockscout.com",
  deployment: mainnetDeployment as Deployment, drandUrls: DRAND, testnet: false, multicall3: MULTICALL3,
};
export const TESTNET_NET: Net = {
  name: "testnet", chainId: 46630, label: "Robinhood Chain Testnet",
  readRpc: env.VITE_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com/rpc", readBatch: Math.max(0, Number(env.VITE_RPC_BATCH) || 0), publicRpc: "https://rpc.testnet.chain.robinhood.com/rpc",
  explorer: "https://explorer.testnet.chain.robinhood.com", deployment: testnetDeployment as Deployment, drandUrls: DRAND, testnet: true,
  multicall3: MULTICALL3,
};

declare global { var __FORGE_NET__: Net | undefined }

/** "testnet" / "mainnet" from the page's ?live=..., or null. */
export function liveParam(search: string = typeof location !== "undefined" ? location.search : ""): NetName | null {
  const v = new URLSearchParams(search).get("live");
  return v === "testnet" || v === "mainnet" ? v : null;
}

/** Has this network's deployments file got the card contracts? (mainnet's is empty until the deploy) */
export const isDeployed = (n: Net) => !!n.deployment.contracts?.FireSale && !!n.deployment.contracts?.FireCards;

/** The network the page asked for, or null for demo mode. Mainnet without contracts is demo mode too. */
export function chosenNet(): Net | null {
  if (globalThis.__FORGE_NET__) return globalThis.__FORGE_NET__;
  if (typeof location !== "undefined" && new URLSearchParams(location.search).get("live") === "off") return null;
  const flag = (typeof document !== "undefined" ? document.querySelector<HTMLMetaElement>('meta[name="forge-live"]')?.content : "") || env.VITE_LIVE;
  const want = liveParam() ?? (flag === "mainnet" || flag === "testnet" ? flag : null);
  if (want === "testnet") return TESTNET_NET;
  if (want === "mainnet") return isDeployed(MAINNET) ? MAINNET : null;
  return null;
}

/** The network the wallet and chain modules use: the chosen one, else (demo mode, connect-only) VITE_CHAIN's. */
export const NET: Net = chosenNet() ?? (env.VITE_CHAIN === "testnet" ? TESTNET_NET : MAINNET);
