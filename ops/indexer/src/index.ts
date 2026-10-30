import { ponder } from "ponder:registry";
import { burner, card, packBalance, purchase } from "ponder:schema";

const ZERO = "0x0000000000000000000000000000000000000000";
const lower = (a: string) => a.toLowerCase() as `0x${string}`;

// a card is dealt: minted to the opener in the same transaction (Transfer below sets its owner)
ponder.on("FireCards:CardDealt", async ({ event, context }) => {
  const a = event.args;
  await context.db.insert(card).values({
    serial: a.serial, owner: ZERO, fire: Number(a.fire), cardType: Number(a.cardType), character: Number(a.character),
    holoFrame: a.holoFrame, holoPicture: a.holoPicture, openIndex: Number(a.openIndex), dealtAt: Number(event.block.timestamp),
  }).onConflictDoUpdate({ fire: Number(a.fire), cardType: Number(a.cardType), character: Number(a.character), holoFrame: a.holoFrame, holoPicture: a.holoPicture, openIndex: Number(a.openIndex) });
});

// ownership: mint (from 0x0), trades, burns (to 0x0). The mint can come before CardDealt in the same transaction.
ponder.on("FireCards:Transfer", async ({ event, context }) => {
  const { from, to, tokenId } = event.args;
  const burned = to === ZERO;
  await context.db.insert(card).values({
    serial: tokenId, owner: lower(to), fire: 0, cardType: 0, character: 0, holoFrame: false, holoPicture: false, openIndex: 0,
    dealtAt: Number(event.block.timestamp), burned,
  }).onConflictDoUpdate((row) => ({ owner: lower(to), burned, moves: from !== ZERO && !burned ? row.moves + 1 : row.moves }));
});

ponder.on("FireCards:Cased", async ({ event, context }) => {
  await context.db.update(card, { serial: event.args.tokenId }).set({ cased: true });
});
ponder.on("FirePsa:Graded", async ({ event, context }) => {
  await context.db.update(card, { serial: event.args.serial }).set({ grade: Number(event.args.grade) });
});

// sealed packs (ERC-1155: id = the Series)
async function movePacks(context: any, from: string, to: string, id: bigint, value: bigint) {
  const fire = Number(id);
  if (from !== ZERO) await context.db.insert(packBalance).values({ owner: lower(from), fire, count: -value }).onConflictDoUpdate((r: any) => ({ count: r.count - value }));
  if (to !== ZERO) await context.db.insert(packBalance).values({ owner: lower(to), fire, count: value }).onConflictDoUpdate((r: any) => ({ count: r.count + value }));
}
ponder.on("FirePacks:TransferSingle", async ({ event, context }) => {
  await movePacks(context, event.args.from, event.args.to, event.args.id, event.args.value);
});
ponder.on("FirePacks:TransferBatch", async ({ event, context }) => {
  for (let i = 0; i < event.args.ids.length; i++) await movePacks(context, event.args.from, event.args.to, event.args.ids[i]!, event.args.values[i]!);
});

ponder.on("FireSale:PacksBought", async ({ event, context }) => {
  const a = event.args;
  await context.db.insert(purchase).values({ id: event.id, fire: Number(a.fire), group: Number(a.group), buyer: lower(a.buyer), count: Number(a.count), free: false, at: Number(event.block.timestamp) });
});
ponder.on("FireSale:CreditsUsed", async ({ event, context }) => {
  const a = event.args;
  await context.db.insert(purchase).values({ id: event.id, fire: Number(a.fire), group: -1, buyer: lower(a.buyer), count: Number(a.count), free: true, at: Number(event.block.timestamp) });
});

ponder.on("FireCredits:CardsBurned", async ({ event, context }) => {
  const a = event.args;
  await context.db.insert(burner).values({ wallet: lower(a.holder), burned: Number(a.count), credits: Number(a.creditsEarned) })
    .onConflictDoUpdate((r) => ({ burned: r.burned + Number(a.count), credits: r.credits + Number(a.creditsEarned) }));
});
