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
