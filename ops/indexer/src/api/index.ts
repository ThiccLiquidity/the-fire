// The indexer's API (the site reaches it through its own /api/idx proxy, so its security policy stays same-origin):
//   GET /cards/:owner            the wallet's cards, newest first (serial, Series, type, character, holo, grade, cased, wear)
//   GET /packs/:owner            its sealed packs per Series
//   GET /pulls?fire=&min=&limit= the newest pulls (type index >= min), with who pulled them
//   GET /board/:fire             who fed the fire in a Series (packs bought, by wallet)
//   GET /burners?limit=          the biggest burners
//   /graphql, /sql/*             everything else (read-only)
import { db } from "ponder:api";
import schema from "ponder:schema";
import { and, desc, eq, gte, sql } from "ponder";
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

app.use("/sql/*", client({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

export default app;
