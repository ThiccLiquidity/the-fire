# Keeper

One always-on process that makes the permissionless calls the card system needs, plus a backup that runs every
5 minutes. It has no special powers: anyone can make every one of these calls, the keeper is just reliably awake.

Each pass (every 20 s on Railway):

1. **Feeds:** `PlankUsdTwap.checkpoint()` when `due()` (every 30 min) and `PaperUsdTwap.checkpoint()` when `due()`
   (candidate pool, adoption, the 20 h window).
2. **Randomness:** for every open (`FireCards`) and grading (`FirePsa`) still waiting, once drand has published the
   request's round, it fetches the signature from the drand relays and calls `OpenDrandRouter.fulfillMany(ids, sigs)`
   (several at once; the router verifies each signature and skips ones someone else already delivered). If the
   router already holds the word but the callback didn't land, it calls `adapter.settle(id)`. Each open and grading
   is answered by the source that took it, so a randomness switch is followed automatically.
3. **Dealing:** `FireCards.process(fire, maxCards)` while a Series' queue head is ready.
4. **Grading:** `FirePsa.finish(index, ids)` for ready gradings; `ids` come from the grading's `Protected` event
   (checked against the hash FirePsa stored).
5. **Burners:** `PaperBurner.flush(pay)` and `PlankBurner.flush(pay)` when they hold something and a flush would
   actually burn it (simulated first).
6. **Health:** alerts and a heartbeat (below).

Every call is simulated first and skipped if the contract says no, so two keepers (or the site, or a stranger) racing
on the same work cost at most a wasted transaction, never a double result. A stuck or dropped transaction is re-sent
at the same nonce with a higher fee.

## Alerts

`ALERT_WEBHOOK_URL` takes a Discord webhook, a Slack incoming webhook, or a Telegram bot URL
(`https://api.telegram.org/bot<token>/sendMessage?chat_id=<chat id>`). It posts when a problem starts, again every hour
while it lasts, and "resolved" when it clears:

- **Stale feeds:** PLANK/USD not checkpointed for 75 min (FireSale stops PLANK pricing at 2 h); PAPER/USD not rolled for
  22 h; Chainlink ETH/USD not updated for 24 h (prices stop at 25 h).
- **Stuck opens and gradings:** drand published the round 10 min ago and it still isn't delivered; an open ready but
  not dealt, or a grading ready but not finished, for 10 min.
- **Waiting fees:** a burner holds ETH, PLANK or USDG it can't burn yet (no PAPER price yet, or the price guard).
- **drand lag:** no relay answers, or drand is 20+ rounds (60 s) behind the clock; the chain's clock off real time by
  2+ min.
- **Low keeper ETH:** under 0.01 ETH.
- **The keeper itself:** a job failing, a transaction in flight 15+ min, and the backup having to step in.
- **Heartbeat:** a message when it starts and every 24 h. Optional `HEARTBEAT_URL` (e.g. a free healthchecks.io
  check) is pinged every pass, so if the keeper dies the silence itself raises an alarm.

## Settings

| Variable | Default | |
|---|---|---|
| `RPC_URL` | required | Robinhood Chain RPC (Alchemy). Secret: the URL carries the API key |
| `KEEPER_PRIVATE_KEY` | required | the keeper's own gas-only wallet. Railway variable or GitHub secret only |
| `ALERT_WEBHOOK_URL` | none | Discord / Slack / Telegram (secret: it carries a token) |
| `HEARTBEAT_URL` | none | dead-man's switch ping URL |
| `CHAIN_ID` | 4663 | reads `deployments/<CHAIN_ID>.json` for every address |
| `FALLBACK_RPC_URL` | the public RPC on 4663 | `none` to turn off |
| `DRAND_URLS` | api, api2, api3.drand.sh | comma-separated relays |
| `INTERVAL_SEC` | 20 | time between passes |
| `ONCE` | off | `1` = one pass then exit (the GitHub Actions backup) |
| `ACT_AFTER_SEC` | 0 | only act on work that has waited this long (the backup uses 300) |
| `SERIES` | all found | e.g. `7,8`; otherwise every Series with a dealer is found by probing |
| `MAX_FEE_GWEI` | none | fee cap |
| `PROCESS_MAX_CARDS` | 120 | cards per `process` call |
| `LOW_BALANCE_ETH`, `STUCK_MIN`, `PLANK_STALE_MIN`, `PAPER_STALE_HOURS`, `ETH_STALE_HOURS`, `DRAND_LAG_ROUNDS`, `ALERT_REPEAT_MIN`, `HEARTBEAT_HOURS` | 0.01, 10, 75, 22, 24, 20, 60, 24 | alert thresholds |

Any contract address can be overridden (`FIRE_CARDS`, `FIRE_PSA`, `PAPER_BURNER`, `PLANK_BURNER`,
`PLANK_USD_FEED`, `PAPER_USD_FEED`), but normally they all come from `deployments/4663.json`, which the deploy
scripts write. Railway rebuilds when that file changes on the deployed branch.

## Setup (PowerShell)

Keys are typed into Railway's and GitHub's own secret fields, never into a chat or a file.

**1. Two gas-only wallets** (one for Railway, one for the GitHub backup, so they never fight over a nonce):
```powershell
cast wallet new      # prints an address and a private key; do this twice
```
Copy each private key straight into step 2 or 3, then `Clear-Host`. Send each address about 0.02 ETH on Robinhood
Chain. These wallets only ever pay gas: keep little in them.

**2. Railway (the main keeper):**
1. railway.com → New Project → Deploy from GitHub repo → this repository.
2. The service → Settings: Source branch: the branch to run (production: `main`, once the owner approves). Root
   Directory: leave empty. Config as code → Railway config file: `ops/keeper/railway.json` (it builds
   `ops/keeper/Dockerfile`, restarts always, one replica).
3. The service → Variables: `RPC_URL`, `KEEPER_PRIVATE_KEY` (the first wallet's key), `ALERT_WEBHOOK_URL`, and
   optionally `HEARTBEAT_URL`. Use "Seal" on the key and the URLs so they can't be read back.
4. Deploy. The log starts with `keeper 0x... on chain 4663; FireCards 0x...` and the webhook gets a heartbeat.

**3. GitHub Actions (the backup):** `.github/workflows/keeper.yml` runs one pass every 5 minutes. It only acts on work
the main keeper has left for 5 minutes, and says so on the webhook when it does.
```powershell
gh secret set KEEPER_RPC_URL                 # each asks for the value; paste it at the prompt
gh secret set KEEPER_BACKUP_PRIVATE_KEY      # the second wallet's key
gh secret set KEEPER_ALERT_WEBHOOK_URL
gh secret set KEEPER_BACKUP_HEARTBEAT_URL    # optional, a second healthchecks.io check
gh variable set KEEPER_BACKUP_ENABLED --body true
```
(Or in the browser: Settings → Secrets and variables → Actions.) GitHub runs scheduled workflows from the default
branch only, so the backup starts once this is on `main`; "Run workflow" on the Actions tab runs a pass by hand.
GitHub may delay a 5-minute schedule at busy times; that's fine for a backup.

**4. A webhook:** Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL. Telegram:
create a bot with @BotFather, send it a message, get the chat id from
`https://api.telegram.org/bot<token>/getUpdates`, and use
`https://api.telegram.org/bot<token>/sendMessage?chat_id=<chat id>`.

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

- `npm test`: drand client, alerts (dedupe, hourly repeat, resolved, backup gating), config and key handling.
- The whole keeper runs end to end in the rehearsal (`ops/rehearsal`, see `docs/deploy.md`): on a local anvil chain it
  checkpoints, delivers a real drand signature through the real router, deals, finishes a grading from its
  `Protected` event, flushes both burners, races a second keeper and posts to a local webhook.
