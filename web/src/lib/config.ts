// Site-wide settings for the live Forge.

import mainnet from "../../../deployments/4663.json";
import testnet from "../../../deployments/46630.json";

/** Swap fee: 0.5% of what the buyer pays, sent by KyberSwap straight to SWAP_FEE_WALLET in the same transaction. */
export const SWAP_FEE_BPS = 50;
/** Swap fee wallet (public address only). Until it's set, swaps run with no fee: set it before the mainnet build. */
export const SWAP_FEE_WALLET: `0x${string}` | undefined = undefined;

// ---------- contract addresses: deployments/<chainId>.json at the repository root (written by the deploy scripts)

/** The deployments file's shape (contracts/script/Deployments.sol). Empty until the deploy has run. */
export interface Deployment {
  chainId: number;
  startBlock?: number;
  owner?: string;
  inputs: Partial<Record<"PAPER" | "PLANK" | "USDG" | "WETH" | "MILL" | "ETH_USD_FEED" | "PLANK_WETH_V2_PAIR" | "UNIV2_FACTORY" | "V2_ROUTER", string>>;
  contracts: Partial<Record<ContractName, string>>;
}
export type ContractName =
  | "PlankUsdTwap" | "OpenDrandRouter" | "PaperUsdTwap" | "FirePacks" | "FireCards" | "CardsRenderer" | "RecipeDealer"
  | "RecipeCompiler" | "PlankBurner" | "FireCredits" | "FireSale" | "PaperBurner" | "FirePsa" | "CardsAdapter" | "PsaAdapter";

/** This build's deployment (VITE_CHAIN=testnet: Robinhood Chain testnet). */
export const DEPLOYMENT: Deployment = (import.meta.env.VITE_CHAIN === "testnet" ? testnet : mainnet) as Deployment;

/** A deployed contract's address, or undefined before the deploy (the site stays in demo mode then). */
export function contractAddress(name: ContractName): `0x${string}` | undefined {
  const a = DEPLOYMENT.contracts[name];
  return a ? (a as `0x${string}`) : undefined;
}

/** A token or feed the contracts were deployed with (PAPER, PLANK, USDG, WETH, ...). */
export function inputAddress(name: keyof Deployment["inputs"]): `0x${string}` | undefined {
  const a = DEPLOYMENT.inputs[name];
  return a ? (a as `0x${string}`) : undefined;
}
