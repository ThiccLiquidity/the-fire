// ABIs of the card contracts (contracts/src/cards). The names are historical: FirePacks = sealed packs, FireCards =
// cards, FireSale = the pack sale, FirePsa = PDA reveals. Regenerate from contracts/out after any contract change.

import type { Abi } from "viem";
import cards from "./abi/fireCardsAbi.json";
import packs from "./abi/firePacksAbi.json";
import psa from "./abi/firePsaAbi.json";
import sale from "./abi/fireSaleAbi.json";

export const cardsAbi = cards as unknown as Abi;
export const packsAbi = packs as unknown as Abi;
export const psaAbi = psa as unknown as Abi;
export const saleAbi = sale as unknown as Abi;
