// The market (FireMarket): what's listed and every sale. Listings here are what was listed and not yet sold or taken
// down; the site still checks each against the chain (the seller may have moved the card since).
import { ponder } from "ponder:registry";
import { cardListing, offer, packListing, sale } from "ponder:schema";
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
// offers: made, cancelled, accepted (all or part of one)
ponder.on("FireMarket:OfferMade", async ({ event, context }) => {
  const a = event.args;
  await context.db.insert(offer).values({ id: a.id, buyer: lower(a.buyer), kind: Number(a.kind), target: a.target, price: a.price, qty: a.qty, expiry: Number(a.expiry), at: Number(event.block.timestamp) });
});
ponder.on("FireMarket:OfferCancelled", async ({ event, context }) => {
  await context.db.delete(offer, { id: event.args.id });
});
ponder.on("FireMarket:OfferAccepted", async ({ event, context }) => {
  const a = event.args;
  const row = await context.db.find(offer, { id: a.id });
  if (row && row.qty > a.amount) await context.db.update(offer, { id: a.id }).set({ qty: row.qty - a.amount });
  else await context.db.delete(offer, { id: a.id });
  const packs = row?.kind === 2;
  await context.db.insert(sale).values({ id: id(event), kind: packs ? "packs" : "card", ...(packs ? { fire: Number(a.item) } : { serial: a.item }), amount: Number(a.amount), seller: lower(a.seller), buyer: lower(a.buyer), price: a.amount * a.price, royalty: a.royalty, at: Number(event.block.timestamp) });
});

// a wallet ended everything: its listings and offers can't be bought or accepted any more
ponder.on("FireMarket:AllCancelled", async ({ event, context }) => {
  const s = lower(event.args.seller);
  await context.db.sql.delete(cardListing).where(eq(cardListing.seller, s));
  await context.db.sql.delete(packListing).where(eq(packListing.seller, s));
  await context.db.sql.delete(offer).where(eq(offer.buyer, s));
});
