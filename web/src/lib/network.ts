// The wrong-network check: is the connected wallet on Robinhood Chain? For the banner ("Your wallet is on another
// network") and as a guard before anything is sent. Reads only; switching is wallet.switchToRobinhood().

import { getAccount, robinhood, watchAccount, type WalletAccount } from "./wallet";

export type NetworkState = {
  /** Connected, but on another chain: show the banner and block sending. */
  wrong: boolean;
  /** The wallet's chain id, when connected. */
  chainId?: number;
  /** Robinhood Chain's id (mainnet, or testnet with VITE_CHAIN=testnet). */
  expected: number;
  /** For the banner. */
  message?: string;
};

export const WRONG_NETWORK = `Your wallet is on another network. Switch it to ${robinhood.name}.`;

/** The network state for an account (a disconnected wallet is never "wrong": it's just not connected). */
export function networkOf(a: WalletAccount = getAccount()): NetworkState {
  const wrong = a.status === "connected" && a.chainId !== robinhood.id;
  return { wrong, chainId: a.chainId, expected: robinhood.id, message: wrong ? WRONG_NETWORK : undefined };
}

/** Calls cb now and on every account or chain change; returns unwatch. */
export function watchNetwork(cb: (s: NetworkState) => void): () => void {
  cb(networkOf());
  return watchAccount((a) => cb(networkOf(a)));
}

export class WrongNetworkError extends Error {
  constructor() { super(WRONG_NETWORK); this.name = "WrongNetworkError"; }
}

/** Throws WrongNetworkError unless the wallet is connected and on Robinhood Chain. */
export function assertRobinhood(a: WalletAccount = getAccount()): void {
  if (a.status !== "connected") throw new Error("Connect your wallet first.");
  if (a.chainId !== robinhood.id) throw new WrongNetworkError();
}
