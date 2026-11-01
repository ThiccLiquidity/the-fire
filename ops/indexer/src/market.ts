// The market (FireMarket): what's listed and every sale. Listings here are what was listed and not yet sold, taken
// down, moved or changed (index.ts drops a card's listing when it moves, is cased or goes for grading); the site still
// checks each against the chain before showing it.
import { ponder } from "ponder:registry";
import { cardListing, marketApproval, offer, packListing, sale } from "ponder:schema";
import { and, desc, eq, gte } from "ponder";

const DAY = 86400;
/** A card sale that looks like trading with yourself: the same wallet on both sides, or the card went from this buyer
 *  to this seller within the last 30 days (A to B, then back to A). Internal: it keeps the price numbers honest. */
async function washy(context: any, serial: bigint | null, seller: `0x${string}`, buyer: `0x${string}`, at: number): Promise<boolean> {
  if (seller === buyer) return true;
  if (serial == null) return false;
  const back = await context.db.sql.select({ id: sale.id }).from(sale)
    .where(and(eq(sale.serial, serial), eq(sale.seller, buyer), eq(sale.buyer, seller), gte(sale.at, at - 30 * DAY))).orderBy(desc(sale.at)).limit(1);
  return back.length > 0;
}

// the market's permission to move a wallet's cards / packs (only ApprovalForAll to FireMarket counts)
async function approval(context: any, owner: string, operator: string, approved: boolean, what: "cards" | "packs") {
  if (operator.toLowerCase() !== context.contracts.FireMarket.address.toLowerCase()) return;
  await context.db.insert(marketApproval).values({ owner: lower(owner), [what]: approved }).onConflictDoUpdate({ [what]: approved });
}

const lower = (a: string) => a.toLowerCase() as `0x${string}`;
const id = (e: { transaction: { hash: string }; log: { logIndex: number } }) => `${e.transaction.hash}-${e.log.logIndex}`;

ponder.on("FireCards:ApprovalForAll", async ({ event, context }) => {
  await approval(context, event.args.owner, event.args.operator, event.args.approved, "cards");
});
ponder.on("FirePacks:ApprovalForAll", async ({ event, context }) => {
  await approval(context, event.args.account, event.args.operator, event.args.approved, "packs");
});

ponder.on("FireMarket:CardListed", async ({ event, context }) => {
  const { serial, seller, price } = event.args, at = Number(event.block.timestamp);
  const expiry = Number(event.args.expiry), changes = event.args.changes;
  await context.db.insert(cardListing).values({ serial, seller: lower(seller), price, expiry, changes, at }).onConflictDoUpdate({ seller: lower(seller), price, expiry, changes, at });
});
ponder.on("FireMarket:CardUnlisted", async ({ event, context }) => {
  await context.db.delete(cardListing, { serial: event.args.serial });
});
ponder.on("FireMarket:CardSold", async ({ event, context }) => {
  const a = event.args;
  await context.db.delete(cardListing, { serial: a.serial });
  const at = Number(event.block.timestamp), wash = await washy(context, a.serial, lower(a.seller), lower(a.buyer), at);
  await context.db.insert(sale).values({ id: id(event), kind: "card", serial: a.serial, amount: 1, seller: lower(a.seller), buyer: lower(a.buyer), price: a.price, royalty: a.royalty, at, wash });
});
ponder.on("FireMarket:PacksListed", async ({ event, context }) => {
  const a = event.args;
  await context.db.insert(packListing).values({ id: a.id, seller: lower(a.seller), fire: Number(a.series), amount: a.amount, pricePer: a.pricePer, expiry: Number(a.expiry), at: Number(event.block.timestamp) });
});
ponder.on("FireMarket:PacksUnlisted", async ({ event, context }) => {
  await context.db.delete(packListing, { id: event.args.id });
});
ponder.on("FireMarket:PacksSold", async ({ event, context }) => {
  const a = event.args;
  const row = await context.db.find(packListing, { id: a.id });
  if (row && row.amount > a.amount) await context.db.update(packListing, { id: a.id }).set({ amount: row.amount - a.amount });
  else await context.db.delete(packListing, { id: a.id });
  await context.db.insert(sale).values({ id: id(event), kind: "packs", fire: Number(a.series), amount: Number(a.amount), seller: lower(a.seller), buyer: lower(a.buyer), price: a.amount * a.pricePer, royalty: a.royalty, at: Number(event.block.timestamp), wash: a.seller.toLowerCase() === a.buyer.toLowerCase() });
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
  const packs = row?.kind === 2, at = Number(event.block.timestamp);
  const wash = await washy(context, packs ? null : a.item, lower(a.seller), lower(a.buyer), at);
  await context.db.insert(sale).values({ id: id(event), kind: packs ? "packs" : "card", ...(packs ? { fire: Number(a.item) } : { serial: a.item }), amount: Number(a.amount), seller: lower(a.seller), buyer: lower(a.buyer), price: a.amount * a.price, royalty: a.royalty, at, wash });
});

// a wallet ended everything: its listings and offers can't be bought or accepted any more
ponder.on("FireMarket:AllCancelled", async ({ event, context }) => {
  const s = lower(event.args.seller);
  await context.db.sql.delete(cardListing).where(eq(cardListing.seller, s));
  await context.db.sql.delete(packListing).where(eq(packListing.seller, s));
  await context.db.sql.delete(offer).where(eq(offer.buyer, s));
});
