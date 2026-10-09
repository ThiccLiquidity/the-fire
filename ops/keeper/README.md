# Keeper

Two always-on processes that make the permissionless calls the card system needs: the **main** keeper and a
**backup**, each a Railway service in its own region with its own gas-only wallet. They have no special powers: anyone
can make every one of these calls, the keepers are just reliably awake.

Each pass (every 20 s for the main keeper, 30 s for the backup):

1. **Feeds:** `PlankUsdTwap.checkpoint()` when `due()` (every 30 min) and `PaperUsdTwap.checkpoint()` when `due()`
   (candidate pool, adoption, the 20 h window).
2. **Randomness:** for every open (`FireCards`) and grading (`FirePsa`) still waiting, once drand has published the
   request's round, it fetches the signature from the drand relays and calls `OpenDrandRouter.fulfillMany(ids, sigs)`
   (several at once). If the router already holds the word but the callback didn't land, it calls `adapter.settle(id)`.
   Each open and grading is answered by the source that took it, so a randomness switch is followed automatically.
3. **Dealing:** `FireCards.process(fire, maxCards)` while a Series' queue head is ready.
4. **Grading:** `FirePsa.finish(index, ids)` for ready gradings; `ids` come from the grading's `Protected` event
   (checked against the hash FirePsa stored).
5. **Burners:** `PaperBurner.flush(pay)` and `PlankBurner.flush(pay)` when they hold something and a flush would
   actually burn it.
6. **Health:** alerts and a heartbeat (below).

**No wasted transactions.** Right before sending, each call is checked again against the pending state (the
checkpoint still due, the drand requests not yet delivered, something to deal, the grading not finished) and simulated;
a call that would do nothing isn't sent. Reads made together go out as one Multicall3 call when the chain has it
(Robinhood Chain does); values that never change are read once.

**Two keepers, no double work.** The backup (`KEEPER_ROLE=backup`) acts only on work left waiting `ACT_AFTER_SEC`
(5 min): a feed window or a candidate adoption 5 min late, a drand round published 5 min ago and not delivered, an open
ready 5 min and not dealt, a burner balance waiting 5 min. Even then it waits `BACKUP_YIELD_MS` before each
transaction, looks again, and stands down while the main keeper's wallet (`MAIN_KEEPER_ADDRESS`) has a transaction
waiting, so the main keeper wins a tie. When the backup does act it says so on the webhook. The rehearsal races the two
for real and fails on any reverted, empty or duplicate transaction.

**Stuck transactions.** A stuck or dropped transaction is re-sent at the same nonce with a higher fee (or replaced by a
0-ETH transfer to itself if the work is done). At start-up, transactions an earlier run left waiting are replaced the
same way, so new work never queues behind them.

## Alerts

`ALERT_WEBHOOK_URL` takes a Discord webhook, a Slack incoming webhook, or a Telegram bot URL
(`https://api.telegram.org/bot<token>/sendMessage?chat_id=<chat id>`). It posts when a problem starts, again every hour
while it lasts, and "resolved" when it clears:

- **Stale feeds:** the PLANK price over 90 min old (FireSale stops PLANK pricing at 2 h, and a buy can't heal a longer
  gap: its own checkpoint makes a window over 2 h, so pricing stays off until the next one); a PLANK window over 2 h;
  PAPER/USD not rolled for 22 h; a PAPER candidate pool still not adopted 3 h after its 20 h; Chainlink ETH/USD not
  updated for 24 h (prices stop at 25 h).
- **Stuck opens and gradings:** drand published the round 10 min ago and it still isn't delivered; an open ready but
  not dealt, or a grading ready but not finished, for 10 min.
- **Waiting fees:** a burner holds ETH, PLANK or USDG it can't burn yet (no PAPER price yet, or the price guard).
- **drand lag:** no relay answers, or drand is 20+ rounds (60 s) behind the clock; the chain's clock off real time by
  2+ min.
- **The owner's switches:** FireSale or FirePsa paused (posted once, and when it ends); FireCards' or FirePsa's
  randomness source switched (posted when it happens).
- **Low keeper ETH:** under 0.01 ETH.
- **The keeper itself:** a job failing, a transaction in flight 15+ min, the backup having to step in, and a keeper that
  can't start (bad settings, wrong chain, no RPC answering): it posts why before it exits, and fails its heartbeat check.
- **Heartbeat:** a message when it starts and every 24 h. `HEARTBEAT_URL` (a healthchecks.io check, one per service;
  required in production) is pinged every pass, so if a keeper dies the silence itself raises an alarm.

## Settings

| Variable | Default | |
|---|---|---|
| `RPC_URL` | required | the chain's RPC (Alchemy). Secret: the URL carries the API key |
| `KEEPER_PRIVATE_KEY` | required | this service's own gas-only wallet. A Railway variable only, typed in there |
| `KEEPER_ROLE` | `main` | `main`, or `backup` (only work left waiting `ACT_AFTER_SEC`; yields to the main keeper) |
| `ALERT_WEBHOOK_URL` | required in production | Discord / Slack / Telegram (secret: it carries a token) |
| `HEARTBEAT_URL` | required in production | dead-man's switch ping URL, one per service |
| `MAIN_KEEPER_ADDRESS` | none | backup only: the main keeper's address (it stands down while that has a tx waiting) |
| `CHAIN_ID` | 4663 | reads `deployments/<CHAIN_ID>.json` for every address (46630 = testnet) |
| `FALLBACK_RPC_URL` | Robinhood Chain's public RPC (4663 and 46630) | `none` to turn off. Must be on the same chain (checked at start) |
| `DRAND_URLS` | api, api2, api3.drand.sh | comma-separated relays |
| `INTERVAL_SEC` | 20 (backup 30) | time between passes |
| `ACT_AFTER_SEC` | 0 (backup 300) | only act on work that has waited this long |
| `BACKUP_YIELD_MS` | 0 (backup 3000) | wait before each transaction, then check again |
| `ONCE` | off | `1` = one pass then exit (by hand, or the optional GitHub Actions extra) |
| `STATE_FILE` | none | `ONCE` runs: keeps the alert memory between runs |
| `MULTICALL` | `auto` | `off` = one RPC call per read |
| `SERIES` | all found | e.g. `7,8`; otherwise every Series with a dealer is found by probing |
| `MAX_FEE_GWEI` | none | fee cap |
| `PROCESS_MAX_CARDS` | 120 | cards per `process` call |
| `LOW_BALANCE_ETH`, `STUCK_MIN`, `PLANK_STALE_MIN`, `PAPER_STALE_HOURS`, `PAPER_CANDIDATE_LATE_HOURS`, `ETH_STALE_HOURS`, `DRAND_LAG_ROUNDS`, `ALERT_REPEAT_MIN`, `HEARTBEAT_HOURS` | 0.01, 10, 90, 22, 3, 24, 20, 60, 24 | alert thresholds |

"Production" is `NODE_ENV=production`, which the Docker image sets: there a keeper without `HEARTBEAT_URL` or
`ALERT_WEBHOOK_URL` refuses to start (and says so). Any contract address can be overridden (`FIRE_CARDS`, `FIRE_PSA`,
`PAPER_BURNER`, `PLANK_BURNER`, `PLANK_USD_FEED`, `PAPER_USD_FEED`, `FIRE_SALE`), but normally they all come from
`deployments/<CHAIN_ID>.json`. Railway rebuilds when that file changes on the deployed branch.

## Setup (PowerShell)

Keys are typed into Railway's own variable fields, never into a chat or a file.

**1. Two gas-only wallets**, one per service, so they never fight over a nonce:
```powershell
cast wallet new      # prints an address and a private key; do this twice
```
Copy each private key straight into its Railway service (step 3), then `Clear-Host`. Write down both **addresses**
(not keys). Send each about 0.02 ETH on Robinhood Chain. These wallets only ever pay gas: keep little in them.

**2. Two heartbeat checks** (healthchecks.io, free): New check → name it "keeper main", period 5 min, grace 5 min;
again for "keeper backup". Connect your Discord/Telegram in its Integrations so a silent keeper alerts you. Copy each
check's ping URL.

**3. Railway: the main keeper**
1. railway.com → New Project → Deploy from GitHub repo → this repository.
2. The service → Settings: Source branch: the branch to run (production: `main`, once the owner approves). Root
   Directory: leave empty. Config as code → Railway config file: `ops/keeper/railway.json` (it builds
   `ops/keeper/Dockerfile`, restarts always, one replica). Region: e.g. US West.
3. The service → Variables: `RPC_URL`, `KEEPER_PRIVATE_KEY` (the first wallet's key), `ALERT_WEBHOOK_URL`,
   `HEARTBEAT_URL` (the "keeper main" ping URL), `KEEPER_ROLE` = `main`. Use "Seal" on the key and the URLs so they
   can't be read back.
4. Deploy. The log starts with `keeper (main) 0x... on chain 4663; ...` and the webhook gets a heartbeat.

**4. Railway: the backup**, in the same project: New → GitHub Repo → this repository again (a second service).
1. Settings: the same branch and config file; **another region** (e.g. US East or EU West), so one region's outage
   doesn't take both.
2. Variables: `RPC_URL` (ideally a second Alchemy key or app, so one RPC problem doesn't hit both), `KEEPER_PRIVATE_KEY`
   (the second wallet's key), `ALERT_WEBHOOK_URL`, `HEARTBEAT_URL` (the "keeper backup" ping URL), `KEEPER_ROLE` =
   `backup`, `MAIN_KEEPER_ADDRESS` = the first wallet's address. Seal the key and the URLs.
3. Deploy. Its log starts with `backup (backup) 0x... ; acts only on work left 300s`. Normally it sends nothing; when
   it steps in, the webhook says so.

**5. A webhook:** Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL. Telegram:
create a bot with @BotFather, send it a message, get the chat id from
`https://api.telegram.org/bot<token>/getUpdates`, and use
`https://api.telegram.org/bot<token>/sendMessage?chat_id=<chat id>`.

**Testnet:** the same two services again with `CHAIN_ID` = `46630`, the testnet RPC, and two more wallets funded with
test ETH (never the mainnet keeper wallets).

**Optional extra (GitHub Actions):** `.github/workflows/keeper.yml` runs one best-effort pass every 5 minutes
(`KEEPER_ROLE=backup`, 15 min grace), for when both Railway services are down. GitHub can delay or skip scheduled
runs, so it is never the backup. It is off unless you set it up: a third wallet, then
```powershell
gh secret set KEEPER_RPC_URL                 # each asks for the value; paste it at the prompt
gh secret set KEEPER_BACKUP_PRIVATE_KEY      # the third wallet's key
gh secret set KEEPER_ALERT_WEBHOOK_URL
gh variable set KEEPER_BACKUP_ENABLED --body true
```
It keeps its alert memory between runs in the Actions cache. GitHub runs scheduled workflows from the default branch
only.

**Run one pass by hand** (from the repository, with Node 22):
```powershell
cd ops\keeper; npm ci
$env:RPC_URL = Read-Host "RPC URL"
$k = Read-Host "Keeper key" -AsSecureString
$env:KEEPER_PRIVATE_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($k))
$env:ONCE = "1"; node src/keeper.mjs
Remove-Item Env:KEEPER_PRIVATE_KEY, Env:ONCE
```

## Tests

- `npm test`: drand client, alerts (dedupe, hourly repeat, resolved, pause notices, events, one-pass state file and
  window), config (roles, production requirements) and key handling, start-up nonce-gap replacement.
- The whole keeper runs end to end in the rehearsal (`ops/rehearsal`, see `docs/deploy.md`): on a local anvil chain it
  checkpoints, delivers a real drand signature through the real router, deals, finishes a grading from its
  `Protected` event, flushes both burners, races the main keeper against the backup with automine off, lets the
  backup step in while the main keeper is down, and posts to a local webhook.
