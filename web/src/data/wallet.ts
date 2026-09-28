// Shared wallet plumbing for the live site (chain.ts and Swap.tsx). Never imported by the demo's code paths at
// runtime: nothing here runs unless a live-mode action calls it.

import {
  createWalletClient, custom, defineChain, BaseError, ContractFunctionRevertedError, WaitForTransactionReceiptTimeoutError,
  type Hex, type PublicClient, type WalletClient,
} from "viem";

export const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";
export const EXPLORER = "https://robinhoodchain.blockscout.com";
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;

/** What the site reads through (may be a private RPC from VITE_RPC_URL). */
export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [import.meta.env.VITE_RPC_URL || PUBLIC_RPC] } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER } },
});
/** What we ever hand to a user's wallet: only the public RPC, never a private key-bearing URL. */
export const robinhoodPublic = defineChain({ ...robinhood, rpcUrls: { default: { http: [PUBLIC_RPC] } } });

type EthereumProvider = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown>; on?: (ev: string, fn: (arg: unknown) => void) => void };
declare global { interface Window { ethereum?: EthereumProvider } }

/** True if any error in the cause chain carries this code (EIP-1193 / JSON-RPC). */
export function hasCode(e: unknown, code: number): boolean {
  for (let x = e as { code?: unknown; cause?: unknown } | undefined, i = 0; x && i < 10; x = x.cause as typeof x, i++) {
    if (x.code === code) return true;
  }
  return false;
}

/** Ask the wallet for an account and put it on Robinhood Chain. Adds the chain only if the wallet doesn't know it. */
export async function connectWallet(): Promise<{ wc: WalletClient; account: `0x${string}` }> {
  if (!window.ethereum) throw new Error("No wallet found. Install MetaMask.");
  const wc = createWalletClient({ chain: robinhood, transport: custom(window.ethereum) });
  const [account] = await wc.requestAddresses();
  if (!account) throw new Error("No account selected in your wallet.");
  try { await wc.switchChain({ id: robinhood.id }); }
  catch (e) {
    if (!hasCode(e, 4902)) throw e; // user said no, or something else went wrong: don't guess
    await wc.addChain({ chain: robinhoodPublic });
    await wc.switchChain({ id: robinhood.id });
  }
  return { wc, account };
}

/** A transaction that hasn't landed after 3 minutes. `later` settles when it finally does (true = success). */
export class TxPending extends Error {
  hash: Hex; later: Promise<boolean>;
  constructor(hash: Hex, what: string, later: Promise<boolean>) {
    super(`Still pending: ${what}. It may still land — check it on the explorer.`);
    this.hash = hash; this.later = later;
  }
}

/** Wait for a receipt and insist it succeeded. Throws TxPending after 180s, and a plain error if it reverted. */
export async function waitOk(pub: PublicClient, hash: Hex, what: string): Promise<void> {
  let status: "success" | "reverted";
  try { status = (await pub.waitForTransactionReceipt({ hash, timeout: 180_000 })).status; }
  catch (e) {
    if (e instanceof WaitForTransactionReceiptTimeoutError || (e as Error)?.name === "WaitForTransactionReceiptTimeoutError") {
      const later = pub.waitForTransactionReceipt({ hash, timeout: 3_600_000 }).then((r) => r.status === "success", () => false);
      throw new TxPending(hash, what, later);
    }
    throw e;
  }
  if (status !== "success") throw new Error(`${what[0].toUpperCase()}${what.slice(1)} failed on-chain. Nothing more was sent.`);
}

export const PRICE_MOVED = "The price moved at tonight's storm — check the new price and try again.";
const NAMED: Record<string, string> = {
  PriceMoved: PRICE_MOVED,
  Over: "The game has ended. Buying is closed.",
  RollPending: "The storm is rolling in. Try again once it lands.",
  DailyCap: "That's over your 500 a day.",
  TxCap: "Up to 10 a buy.",
  StaleFeed: "ETH is paused (price feed late). Pay with PAPER or USDG.",
  Nothing: "Nothing to claim.",
  BadAmount: "Not enough sent for this buy.",
};

/** A short, human reason for a failed wallet action. */
export function friendly(e: unknown): string {
  if (e instanceof TxPending) return e.message;
  if (hasCode(e, 4001)) return "You cancelled in your wallet.";
  if (e instanceof BaseError) {
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = rev?.data?.errorName;
    if (name && NAMED[name]) return NAMED[name];
    return (e.shortMessage || e.message).split("\n")[0].slice(0, 160);
  }
  return ((e as Error)?.message ?? String(e)).split("\n")[0].slice(0, 160);
}
