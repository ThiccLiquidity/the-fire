// ABIs of the card contracts (contracts/src/cards). The names are historical: FirePacks = sealed packs, FireCards =
// cards, FireSale = the pack sale, FirePsa = cases and PDA grading. FireCredits holds free pack credits, card burning
// and character suggestions (PAPER is still approved to FireSale). RecipeDealer holds each Series' recipe (card types,
// pack slots, characters) and deals it. PaperBurner turns case and grading fees into a PAPER burn; PlankBurner holds a
// sale's PLANK burn share when its swap can't run and burns it later; CardsRenderer writes each card's metadata.
// Regenerate from contracts/out after any contract change.

import type { Abi } from "viem";
import cards from "./abi/fireCardsAbi.json";
import packs from "./abi/firePacksAbi.json";
import psa from "./abi/firePsaAbi.json";
import sale from "./abi/fireSaleAbi.json";
import credits from "./abi/fireCreditsAbi.json";
import dealer from "./abi/recipeDealerAbi.json";
import burner from "./abi/paperBurnerAbi.json";
import plankBurner from "./abi/plankBurnerAbi.json";
import renderer from "./abi/cardsRendererAbi.json";

export const cardsAbi = cards as unknown as Abi;
export const packsAbi = packs as unknown as Abi;
export const psaAbi = psa as unknown as Abi;
export const saleAbi = sale as unknown as Abi;
export const creditsAbi = credits as unknown as Abi;
export const dealerAbi = dealer as unknown as Abi;
export const burnerAbi = burner as unknown as Abi;
export const plankBurnerAbi = plankBurner as unknown as Abi;
export const rendererAbi = renderer as unknown as Abi;
