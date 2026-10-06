// ABIs of the card contracts (contracts/src/cards). The names are historical: FirePacks = sealed packs, FireCards =
// cards, FireSale = the pack sale, FirePsa = cases and PDA grading. RecipeDealer holds each Series' recipe (card types,
// pack slots, characters) and deals it. PaperBurner turns case and grading fees into a PAPER burn; CardsRenderer writes
// each card's metadata. Regenerate from contracts/out after any contract change.

import type { Abi } from "viem";
import cards from "./abi/fireCardsAbi.json";
import packs from "./abi/firePacksAbi.json";
import psa from "./abi/firePsaAbi.json";
import sale from "./abi/fireSaleAbi.json";
import dealer from "./abi/recipeDealerAbi.json";
import burner from "./abi/paperBurnerAbi.json";
import renderer from "./abi/cardsRendererAbi.json";

export const cardsAbi = cards as unknown as Abi;
export const packsAbi = packs as unknown as Abi;
export const psaAbi = psa as unknown as Abi;
export const saleAbi = sale as unknown as Abi;
export const dealerAbi = dealer as unknown as Abi;
export const burnerAbi = burner as unknown as Abi;
export const rendererAbi = renderer as unknown as Abi;
