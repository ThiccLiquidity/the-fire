// The Omni Cardworks indexer (docs/indexer.md): every pack, card, pull, grade and burn from the chain, in Postgres,
// so the site reads a wallet's cards and the feeds in one fast call instead of scanning the chain or waiting on the
// block explorer. Addresses and the start block come from deployments/<CHAIN_ID>.json (the same file the site and the
// keepers use). Env: CHAIN_ID (4663 mainnet, 46630 testnet), PONDER_RPC_URL, DATABASE_URL (Postgres; none = a local
// PGlite file, fine for trying it out), DEPLOYMENTS_FILE (another deployments file, e.g. a rehearsal's).
import { readFileSync } from "node:fs";
import { createConfig } from "ponder";
import { FireCardsAbi } from "./abis/FireCards";
import { FireCreditsAbi } from "./abis/FireCredits";
import { FirePacksAbi } from "./abis/FirePacks";
import { FirePsaAbi } from "./abis/FirePsa";
import { FireSaleAbi } from "./abis/FireSale";
import { FireMarketAbi } from "./abis/FireMarket";

const chainId = Number(process.env.CHAIN_ID ?? 46630);
const file = process.env.DEPLOYMENTS_FILE || new URL(`../../deployments/${chainId}.json`, import.meta.url); // DEPLOYMENTS_FILE: a rehearsal's
const dep = JSON.parse(readFileSync(file, "utf8"));
const at = (name: string) => {
  const a = dep.contracts?.[name];
  if (!a) throw new Error(`deployments/${chainId}.json has no ${name}`);
  return a as `0x${string}`;
};
const startBlock = Number(process.env.START_BLOCK ?? dep.startBlock ?? 0);
const chain = { chain: "robinhood" as const, startBlock };

export default createConfig({
  chains: {
    robinhood: { id: chainId, rpc: process.env.PONDER_RPC_URL, pollingInterval: 2_000 },
  },
  contracts: {
    FireCards: { ...chain, abi: FireCardsAbi, address: at("FireCards") },
    FirePacks: { ...chain, abi: FirePacksAbi, address: at("FirePacks") },
    FirePsa: { ...chain, abi: FirePsaAbi, address: at("FirePsa") },
    FireSale: { ...chain, abi: FireSaleAbi, address: at("FireSale") },
    FireCredits: { ...chain, abi: FireCreditsAbi, address: at("FireCredits") },
    FireMarket: { ...chain, abi: FireMarketAbi, address: at("FireMarket") },
  },
});
