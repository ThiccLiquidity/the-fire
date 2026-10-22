// The Printing Press, live. Not wired in yet: the paper's contract (MorningWood, contracts/src/press) is being built
// alongside. Until its ABI lands in src/lib/abi, a live page (?live=testnet, or a VITE_LIVE build) shows the paper
// as "not open yet" and only connects the wallet (the Forge's wallet bundle, /forge/vendor/wallet.js, shared with
// Cardworks).
//
// TODO(MorningWood): the ABI is at src/lib/abi/morningWoodAbi.json (ERC-1155, token id = issue number). Next:
//   - its address in deployments/<chainId>.json, and reads/writes in src/lib/chain like the card contracts':
//     onSale(issue) / issueOf(issue) (opensAt, the 24h WINDOW) and uri(issue) for today's paper; quote(issue, 1, pay)
//     for the price (1 PAPER + usdPerCopy, pay = ETH or USDG); balanceOfBatch(owner, issues) for the shelf;
//     buy(issue, 1, pay, maxCost) and submitLetter(issue, text) (letterPaper PAPER, MAX_LETTER_BYTES) through
//     src/lib/tx.ts, approving PAPER with src/lib/approve.ts;
//   - expose them on window.ForgeChain (src/forge-wallet.ts), so this page and Cardworks share one bundle;
//   - fill PressLive below from them, read each issue's issue.json from uri(issue) (ipfs://) instead of
//     /press/issues/, and the streak from the holder's past issues (balanceOfBatch over the last 30).

import type { ForgeWalletApi } from "../forge-wallet.ts";

export interface PressLive {
  /** The MorningWood contract's address on this network, or null while it isn't deployed. */
  contract: `0x${string}` | null;
}

export const pressLive: PressLive = { contract: null };

let loading: Promise<ForgeWalletApi> | null = null;
/** The Forge's wallet bundle (window.ForgeWallet), loaded once, on demand. */
export function wallet(): Promise<ForgeWalletApi> {
  return (loading ??= new Promise((ok, no) => {
    if (window.ForgeWallet) return ok(window.ForgeWallet);
    addEventListener("forgewallet:ready", () => ok(window.ForgeWallet!), { once: true });
    const s = document.createElement("script");
    s.type = "module"; s.src = "/forge/vendor/wallet.js";
    s.onerror = () => { loading = null; no(new Error("The wallet didn't load. Check your connection.")); };
    document.head.append(s);
  }));
}
