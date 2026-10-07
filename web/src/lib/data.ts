// The live site's data adapter: one interface for "what does this wallet own" and "what happened lately", so the
// pages never talk to an indexer directly. Today it's Blockscout's API (blockscout.ts); Ponder or another indexer
// can replace it later behind the same interface.

import type { Address, Hex } from "viem";

/** Sealed packs (FirePacks, ERC-1155: one token id per Series) a wallet holds. */
export type OwnedPack = { series: number; count: bigint; image?: string };

/** One card (FireCards, ERC-721: token id = the card's serial) a wallet holds, with its metadata when the indexer
 *  has it. Traits are as the contract writes them (Character, Material, Holo, Series, Edition, PDA, ...). */
export type OwnedCard = {
  tokenId: bigint;
  name?: string;
  image?: string;
  traits: Record<string, string | number>;
};

export type ActivityKind = "mint" | "transfer" | "burn";
/** One NFT transfer: a mint (pack bought or card dealt), a move between wallets, or a burn (pack opened, card burned). */
export type Activity = {
  kind: ActivityKind;
  /** Which collection. */
  token: "packs" | "cards";
  tokenId: bigint;
  /** ERC-1155 amount (packs); 1 for cards. */
  amount: bigint;
  from: Address;
  to: Address;
  tx: Hex;
  /** Block time (ms). */
  at: number;
  /** The contract function, when the indexer knows it ("buy", "openPacks"...). */
  method?: string;
};

/** A page of results; pass `next` back to get the following page (undefined: that was the last). */
export type Page<T> = { items: T[]; next?: string };

export interface ForgeData {
  /** Sealed packs held by `owner`, by Series. */
  packsOf(owner: Address): Promise<OwnedPack[]>;
  /** Cards held by `owner`, newest first, a page at a time. */
  cardsOf(owner: Address, next?: string): Promise<Page<OwnedCard>>;
  /** Recent pack and card transfers, newest first: the whole Forge, or one wallet's when `owner` is given. */
  activity(opts?: { owner?: Address; next?: string }): Promise<Page<Activity>>;
}

/** The two collections the adapter reads. */
export type ForgeContracts = { packs: Address; cards: Address };
