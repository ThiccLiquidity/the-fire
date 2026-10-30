# The indexer (ops/indexer)

A small always-on service (Ponder) that reads every pack, card, pull, grade, purchase and burn from the chain into a
database. The site asks it for a wallet's cards in one fast call instead of scanning the chain or waiting on the block
explorer (which can lag a fresh pack by a minute: the "rip came up empty" problem). If it's down or not set up, the
site quietly falls back to the explorer and the chain, as before.

What it serves (through the site's `/api/idx/...`, so the browser only ever talks to the site):
- `/cards/<wallet>`: the wallet's cards (Series, type, character, holo, grade, cased, trades).
- `/packs/<wallet>`: sealed packs per Series.
- `/pulls?fire=&min=&limit=`: the newest pulls (for the feed), with who pulled them.
- `/board/<Series>`: who fed the fire (packs bought per wallet).
- `/burners`: the biggest burners.

Tested against the full local rehearsal (a whole Series: buys, opens, deals, cases, grades): every wallet's card count,
grades and cases matched the chain exactly.

## Setup on Railway (once, about 10 minutes; after the testnet redeploy)

1. Railway → the project → **New service → GitHub repo** → `the-fire`.
   - Settings → Source: branch `wip/pending-approval`; **Config file** `ops/indexer/railway.json`.
2. Variables:
   | Name | Value |
   |---|---|
   | `CHAIN_ID` | `46630` (testnet) or `4663` (mainnet) |
   | `PONDER_RPC_URL` | the RPC (Alchemy; sealed). It reads past logs, so an archive RPC. |
   | `DATABASE_URL` | Postgres: the same Neon database as the games is fine (the indexer keeps to its own schema), or Railway's own Postgres |
   | `START_BLOCK` | optional: the `FROM_BLOCK` you noted in the testnet runbook step 6 (skips scanning the old deploy's blocks) |
3. Settings → Networking → **Generate domain**. Copy the `https://....up.railway.app` address.
4. Vercel → Environment Variables (Preview for the testnet): `INDEXER_URL` = that address. Redeploy the site.

**Check:** `https://<the site>/api/idx/pulls?limit=3` returns the newest pulls (an empty list before the first open).
Railway's log ends `Started live indexing`. Each deploy indexes into its own schema and only takes traffic once it's
caught up (`/ready`), so a redeploy never shows half a collection.

**After a contract change:** `forge build`, then `node ops\indexer\abis\gen.mjs`, commit, and Railway redeploys.
