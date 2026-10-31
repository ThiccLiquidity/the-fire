// The market (FireMarket): what's listed and every sale. Listings here are what was listed and not yet sold or taken
// down; the site still checks each against the chain (the seller may have moved the card since).
import { ponder } from "ponder:registry";
import { cardListing, packListing, sale } from "ponder:schema";
import { eq } from "ponder";

const lower = (a: string) => a.toLowerCase() as `0x${string}`;
const id = (e: { transaction: { hash: string }; log: { logIndex: number } }) => `${e.transaction.hash}-${e.log.logIndex}`;

ponder.on("FireMarket:CardListed", async ({ event, context }) => {
  const { serial, seller, price } = event.args, at = Number(event.block.timestamp);
  await context.db.insert(cardListing).values({ serial, seller: lower(seller), price, at }).onConflictDoUpdate({ seller: lower(seller), price, at });
});
ponder.on("FireMarket:CardUnlisted", async ({ event, context }) => {
  await context.db.delete(cardListing, { serial: event.args.serial });
});
ponder.on("FireMarket:CardSold", async ({ event, context }) => {
  const a = event.args;
  await context.db.delete(cardListing, { serial: a.serial });
  await context.db.insert(sale).values({ id: id(event), kind: "card", serial: a.serial, amount: 1, seller: lower(a.seller), buyer: lower(a.buyer), price: a.price, royalty: a.royalty, at: Number(event.block.timestamp) });
});
ponder.on("FireMarket:PacksListed", async ({ event, context }) => {
  const a = event.args;
  await context.db.insert(packListing).values({ id: a.id, seller: lower(a.seller), fire: Number(a.series), amount: a.amount, pricePer: a.pricePer, at: Number(event.block.timestamp) });
});
ponder.on("FireMarket:PacksUnlisted", async ({ event, context }) => {
  await context.db.delete(packListing, { id: event.args.id });
});
ponder.on("FireMarket:PacksSold", async ({ event, context }) => {
  const a = event.args;
  const row = await context.db.find(packListing, { id: a.id });
  if (row && row.amount > a.amount) await context.db.update(packListing, { id: a.id }).set({ amount: row.amount - a.amount });
  else await context.db.delete(packListing, { id: a.id });
  await context.db.insert(sale).values({ id: id(event), kind: "packs", fire: Number(a.series), amount: Number(a.amount), seller: lower(a.seller), buyer: lower(a.buyer), price: a.amount * a.pricePer, royalty: a.royalty, at: Number(event.block.timestamp) });
});
// the seller ended everything: their listings can't be bought any more
ponder.on("FireMarket:AllCancelled", async ({ event, context }) => {
  const s = lower(event.args.seller);
  await context.db.sql.delete(cardListing).where(eq(cardListing.seller, s));
  await context.db.sql.delete(packListing).where(eq(packListing.seller, s));
});
