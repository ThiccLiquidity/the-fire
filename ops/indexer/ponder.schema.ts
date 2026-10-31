import { index, onchainTable, primaryKey } from "ponder";

/** every card ever dealt: who holds it now (0x0 once burned), what it is, its grade */
export const card = onchainTable("card", (t) => ({
  serial: t.bigint().primaryKey(),
  owner: t.hex().notNull(),
  fire: t.integer().notNull(),
  cardType: t.integer().notNull(), // the recipe's type index (Paper, Wood, ... Full Art)
  character: t.integer().notNull(),
  holoFrame: t.boolean().notNull(),
  holoPicture: t.boolean().notNull(),
  openIndex: t.integer().notNull(),
  dealtAt: t.integer().notNull(), // unix seconds
  grade: t.integer(), // PDA grade, once graded
  cased: t.boolean().notNull().default(false),
  moves: t.integer().notNull().default(0), // trades between wallets (wear)
  burned: t.boolean().notNull().default(false),
}), (t) => ({ ownerIdx: index().on(t.owner), fireIdx: index().on(t.fire), dealtIdx: index().on(t.dealtAt) }));

/** sealed packs a wallet holds, per Series */
export const packBalance = onchainTable("pack_balance", (t) => ({
  owner: t.hex().notNull(),
  fire: t.integer().notNull(),
  count: t.bigint().notNull(),
}), (t) => ({ pk: primaryKey({ columns: [t.owner, t.fire] }), ownerIdx: index().on(t.owner) }));

/** each purchase (the Series board: who fed the fire) */
export const purchase = onchainTable("purchase", (t) => ({
  id: t.text().primaryKey(),
  fire: t.integer().notNull(),
  group: t.integer().notNull(),
  buyer: t.hex().notNull(),
  count: t.integer().notNull(),
  free: t.boolean().notNull(),
  at: t.integer().notNull(),
}), (t) => ({ fireIdx: index().on(t.fire), buyerIdx: index().on(t.buyer) }));

/** burns: cards burned per wallet (42 = a free pack) */
export const burner = onchainTable("burner", (t) => ({
  wallet: t.hex().primaryKey(),
  burned: t.integer().notNull(),
  credits: t.integer().notNull(),
}));

/** the market (FireMarket): a card for sale (the site checks each against the chain before showing it) */
export const cardListing = onchainTable("card_listing", (t) => ({
  serial: t.bigint().primaryKey(),
  seller: t.hex().notNull(),
  price: t.bigint().notNull(), // wei
  at: t.integer().notNull(),
}), (t) => ({ sellerIdx: index().on(t.seller) }));

/** the market: packs for sale (one listing = some of one Series' packs at a price each) */
export const packListing = onchainTable("pack_listing", (t) => ({
  id: t.bigint().primaryKey(),
  seller: t.hex().notNull(),
  fire: t.integer().notNull(),
  amount: t.bigint().notNull(), // packs left in it
  pricePer: t.bigint().notNull(),
  at: t.integer().notNull(),
}), (t) => ({ sellerIdx: index().on(t.seller) }));

/** every market sale (cards and packs) */
export const sale = onchainTable("market_sale", (t) => ({
  id: t.text().primaryKey(),
  kind: t.text().notNull(), // "card" | "packs"
  serial: t.bigint(), // a card's
  fire: t.integer(), // packs': the Series
  amount: t.integer().notNull(),
  seller: t.hex().notNull(),
  buyer: t.hex().notNull(),
  price: t.bigint().notNull(), // wei, the whole sale
  royalty: t.bigint().notNull(),
  at: t.integer().notNull(),
}), (t) => ({ atIdx: index().on(t.at) }));

/** the market: buy offers (WETH, still in the buyer's wallet). kind 0 card (target = serial), 1 any matching card
 *  (target = packed criteria), 2 packs (target = Series) */
export const offer = onchainTable("market_offer", (t) => ({
  id: t.bigint().primaryKey(),
  buyer: t.hex().notNull(),
  kind: t.integer().notNull(),
  target: t.bigint().notNull(),
  price: t.bigint().notNull(), // wei a card or a pack
  qty: t.bigint().notNull(),
  expiry: t.integer().notNull(),
  at: t.integer().notNull(),
}), (t) => ({ buyerIdx: index().on(t.buyer), targetIdx: index().on(t.target) }));
