// The indexer's API (the site reaches it through its own /api/idx proxy, so its security policy stays same-origin):
//   GET /cards/:owner            the wallet's cards, newest first (serial, Series, type, character, holo, grade, cased, wear)
//   GET /packs/:owner            its sealed packs per Series
//   GET /pulls?fire=&min=&limit= the newest pulls (type index >= min), with who pulled them
//   GET /board/:fire             who fed the fire in a Series (packs bought, by wallet)
//   GET /burners?limit=          the biggest burners
//   GET /market                  what can be bought on the market now (cards with their traits, packs) and open offers
//   GET /market/stats            per kind of card: listed count and lowest price; median of clean recent sales
//   GET /status                  (Ponder's own) the last block indexed: the site's "as of" and out-of-date banner
//   GET /sales?limit=            the newest market sales
//   /graphql, /sql/*             everything else (read-only)
import { db } from "ponder:api";
import schema from "ponder:schema";
import { and, desc, eq, gt, gte, sql } from "ponder";
import { Hono } from "hono";
import { client, graphql } from "ponder";

const app = new Hono();
const wallet = (s: string) => (/^0x[0-9a-fA-F]{40}$/.test(s) ? (s.toLowerCase() as `0x${string}`) : null);
const int = (v: string | undefined, d: number, max: number) => { const n = Number(v); return Number.isSafeInteger(n) && n >= 0 ? Math.min(n, max) : d; };
const big = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
const out = (c: any, body: unknown, maxAge = 2) => c.body(JSON.stringify(body, big), 200, { "content-type": "application/json", "cache-control": `public, max-age=${maxAge}` });

app.get("/cards/:owner", async (c) => {
  const w = wallet(c.req.param("owner")); if (!w) return c.json({ error: "bad wallet" }, 400);
  const rows = await db.select().from(schema.card).where(and(eq(schema.card.owner, w), eq(schema.card.burned, false))).orderBy(desc(schema.card.serial)).limit(5000);
  return out(c, { owner: w, cards: rows });
});
app.get("/packs/:owner", async (c) => {
  const w = wallet(c.req.param("owner")); if (!w) return c.json({ error: "bad wallet" }, 400);
  const rows = await db.select().from(schema.packBalance).where(and(eq(schema.packBalance.owner, w), sql`${schema.packBalance.count} > 0`));
  return out(c, { owner: w, packs: rows });
});
app.get("/pulls", async (c) => {
  const fire = c.req.query("fire"), min = int(c.req.query("min"), 0, 99), limit = int(c.req.query("limit"), 30, 200);
  const where = fire ? and(eq(schema.card.fire, int(fire, 0, 1e6)), gte(schema.card.cardType, min)) : gte(schema.card.cardType, min);
  return out(c, { pulls: await db.select().from(schema.card).where(where).orderBy(desc(schema.card.dealtAt), desc(schema.card.serial)).limit(limit) }, 5);
});
app.get("/board/:fire", async (c) => {
  const fire = int(c.req.param("fire"), 0, 1e6);
  const rows = await db.select({ buyer: schema.purchase.buyer, packs: sql<number>`sum(${schema.purchase.count})::int` }).from(schema.purchase)
    .where(eq(schema.purchase.fire, fire)).groupBy(schema.purchase.buyer).orderBy(desc(sql`sum(${schema.purchase.count})`)).limit(100);
  return out(c, { fire, rows }, 10);
});
app.get("/burners", async (c) => {
  return out(c, { rows: await db.select().from(schema.burner).orderBy(desc(schema.burner.burned)).limit(int(c.req.query("limit"), 50, 200)) }, 10);
});

// only what can be bought or accepted now: a card listing whose card is still with its seller (unmoved and unchanged:
// index.ts drops a listing when its card moves, is cased or goes for grading), not ended, with the market allowed to
// move the seller's cards; packs the seller still holds (and lets the market move); offers not expired. Each card
// listing carries the card's traits, so the site filters without reading every card from the chain. The site still
// re-reads a listing from the chain before any buy.
app.get("/market", async (c) => {
  const now = Math.floor(Date.now() / 1000);
  const L = schema.cardListing, C = schema.card, A = schema.marketApproval, P = schema.packListing, B = schema.packBalance;
  const [cards, packs, offers] = await Promise.all([
    db.select({ serial: L.serial, seller: L.seller, price: L.price, expiry: L.expiry, changes: L.changes, at: L.at,
      fire: C.fire, cardType: C.cardType, character: C.character, holoFrame: C.holoFrame, holoPicture: C.holoPicture,
      grade: C.grade, cased: C.cased, moves: C.moves, dealtAt: C.dealtAt })
      .from(L).innerJoin(C, eq(C.serial, L.serial)).innerJoin(A, eq(A.owner, L.seller))
      .where(and(gt(L.expiry, now), eq(C.owner, L.seller), eq(C.burned, false), eq(A.cards, true)))
      .orderBy(L.price).limit(5000),
    db.select({ id: P.id, seller: P.seller, fire: P.fire, amount: P.amount, pricePer: P.pricePer, expiry: P.expiry, at: P.at, held: B.count })
      .from(P).innerJoin(A, eq(A.owner, P.seller)).innerJoin(B, and(eq(B.owner, P.seller), eq(B.fire, P.fire)))
      .where(and(gt(P.expiry, now), eq(A.packs, true), sql`${B.count} > 0`)).orderBy(P.pricePer).limit(1000),
    db.select().from(schema.offer).where(gte(schema.offer.expiry, now)).orderBy(desc(schema.offer.price)).limit(2000),
  ]);
  return out(c, { cards, packs: packs.map((p) => ({ ...p, amount: p.amount < p.held ? p.amount : p.held })), offers }, 3);
});

// price guide numbers for each kind of card, from what's listed and what sold (prices only):
//   groups: per Series, type, graded or not: how many are listed and the lowest price
//   sold:   per Series, type, character, holo look, grade (0 = ungraded): the median of the clean sales in the last
//           60 days and how many sales it's based on (wash-flagged sales left out; fewer than 3: no median)
app.get("/market/stats", async (c) => {
  const now = Math.floor(Date.now() / 1000);
  const L = schema.cardListing, C = schema.card, A = schema.marketApproval, S = schema.sale;
  const graded = sql<boolean>`(${C.grade} is not null)`;
  const [groups, sold] = await Promise.all([
    db.select({ fire: C.fire, cardType: C.cardType, graded, listed: sql<number>`count(*)::int`, floor: sql<string>`min(${L.price})::text` })
      .from(L).innerJoin(C, eq(C.serial, L.serial)).innerJoin(A, eq(A.owner, L.seller))
      .where(and(gt(L.expiry, now), eq(C.owner, L.seller), eq(C.burned, false), eq(A.cards, true)))
      .groupBy(C.fire, C.cardType, graded),
    db.select({ fire: C.fire, cardType: C.cardType, character: C.character, holoFrame: C.holoFrame, holoPicture: C.holoPicture,
      grade: sql<number>`coalesce(${C.grade}, 0)::int`, sales: sql<number>`count(*)::int`,
      median: sql<string>`percentile_disc(0.5) within group (order by ${S.price})::text` })
      .from(S).innerJoin(C, eq(C.serial, S.serial))
      .where(and(eq(S.kind, "card"), eq(S.wash, false), gte(S.at, now - 60 * 86400)))
      .groupBy(C.fire, C.cardType, C.character, C.holoFrame, C.holoPicture, sql`coalesce(${C.grade}, 0)`),
  ]);
  return out(c, { groups, sold: sold.map((x) => (x.sales >= 3 ? x : { ...x, median: null })) }, 10);
});
app.get("/sales", async (c) => {
  return out(c, { sales: await db.select().from(schema.sale).orderBy(desc(schema.sale.at)).limit(int(c.req.query("limit"), 30, 200)) }, 5);
});

app.use("/sql/*", client({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

export default app;
