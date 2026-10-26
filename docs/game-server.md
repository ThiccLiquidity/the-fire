# Game server

The server for competitive (paid) runs in the game room. It approves runs, sees the payment on chain, deals each shot,
judges every kick by replaying it, and keeps the leaderboard. Paper football is game 1. Decisions:
`docs/paper-football.md`; design: `docs/paper-football-plan.md` §8.

Nothing here is live until the owner sets it up and opens it (below). The live site stays closed by default.

## How it fits

1. **Approve.** The site asks the server for a run (`create`). The server checks where the player is (the US states
   in the list below get no approval), that they said they're 18+, and that every switch is open. It returns a run id
   and a signed approval.
2. **Pay.** The player's wallet calls `FireGames.payRun(gameId, runId, series, deadline, sig)` within 10 minutes.
   It burns 1 PAPER. The contract checks the server's signature.
3. **Confirm.** The site sends the transaction hash (`confirm`). The server reads `RunPaid` from the receipt and the
   run starts.
4. **Play.** Up to 3 practice kicks, then scored kicks until the first miss. For each shot the server sends the
   conditions (from a secret seed) and a signed token. The browser sends back the raw pointer samples. The server
   turns them into the kick and replays it with the same sim the browser used (`web/art/factory/forge/paperfb-sim.js`).
   **The server's verdict is final.**
5. **Board.** Each wallet's best streak per Series and game; a tie goes to whoever reached it first.
6. **Prizes.** At each Series launch, `ops/games/award.mjs` gives the finished Series' top three 3, 2 and 1 free packs
   through `FireCredits.awardPrizes` (capped at 6 per game per Series on chain).

The browser and the server get the same result because the sim is deterministic: fixed 1/480 s ticks, integer inputs,
and its own trig and square root (no engine maths that can differ by a bit). The tests check this in Chromium and
Node.

## API

All under `/api/games/<game>/<action>`, where `<game>` is `paperfb` or `1`. POST bodies are JSON.

| Action | In | Out |
|---|---|---|
| `create` (POST) | `{ wallet, adult: true }` | `{ runId, cap, gameId, series, deadline, sig }`. Keep `runId` and `cap`: they resume the run. |
| `confirm` (POST) | `{ runId, cap, txHash }` | the run (`status: 'playing'`), plus `seedCommit` |
| `run` (POST) | `{ runId, cap }` | where the run stands (to resume) |
| `shot` (POST) | `{ runId, cap, practice? }` | `{ n, level, shot, token, shotClockMs }`. Asking again re-sends the same shot with a fresh clock. |
| `ping` (POST) | `{ token }` | right after a shot arrives: measures the round trip |
| `kick` (POST) | `{ token, cap, input, kickTick }` | `{ result, made, streak, over, ... }`; on the run's end, `seed` |
| `board` (GET) | `?series=N` | `{ rows: [{ rank, wallet, streak, reachedAt }] }`, cached for 5 s |

- `input` and `kickTick` come straight from the game's `kick` event (`PaperFootball.mount(..., { onEvent })`). A paid
  run shows the server's shot with `game.setShot(shot)`.
- A `422` (`rejected`) means the kick didn't count (bad timing, impossible input). It is never a miss: kick again.
- A `503` (`closed: true`) means paid play is switched off.
- Results: `good`, `wide-left`, `wide-right`, `short`, `under`, `doink`, or `delay` (no kick within 15 s + 3 s grace).

## What the owner sets up

### 1. The database (Neon)

1. In the Vercel dashboard, open the project, then **Storage → Create Database → Neon**. Pick the region nearest the
   project's functions (US East by default) and connect it to the project. Vercel adds `DATABASE_URL` for you.
2. Open the new database in Neon (the **Open in Neon** button), go to **SQL Editor**, paste all of
   `web/api/games/_lib/schema.sql`, and press **Run**. It's safe to run again.

### 2. The keys and switches (Vercel → Settings → Environment Variables)

Add each for **Production**, and tick **Sensitive** for the secret ones. Type or paste them into the dashboard yourself:
never into a chat, a file or a commit.

| Name | What | Sensitive |
|---|---|---|
| `GAME_SIGNER_KEY` | The private key that approves runs. Make a fresh wallet just for this (`cast wallet new` in PowerShell). It holds no money. | Yes |
| `GAME_SEED_SECRET` | 32+ random characters; the secret behind every shot's conditions. In PowerShell: `$b = [byte[]]::new(48); [Security.Cryptography.RandomNumberGenerator]::Fill($b); [Convert]::ToBase64String($b) \| Set-Clipboard`, then paste. | Yes |
| `DATABASE_URL` | Added by the Neon step. | Yes |
| `FIRE_GAMES_ADDRESS` | FireGames' address (from `deployments/4663.json`). | No |
| `GAME_CHAIN_ID` | `4663` (mainnet) or `46630` (testnet). Default 4663. | No |
| `GAME_RPC_URL` | Optional: an RPC for receipts. Default: the public Robinhood Chain RPC. An Alchemy URL holds a key: mark it Sensitive. | If it has a key |
| `GAMES_PAID_OPEN` | `1` lets new runs start. | No |
| `GAMES_JUDGING` | `1` lets runs be played and judged. | No |
| `GAMES_BLOCKED_REGIONS` | Optional: replaces the blocked US states (default `AZ,AR,CT,DE,LA,MT,SC,SD,TN,IN,ME`). | No |

Redeploy after changing any of them.

### 3. On chain (owner's wallet)

- `FireGames.setSigner(<the address of GAME_SIGNER_KEY>)` and `FireGames.setSeries(<the current Series>)`. The server
  refuses to approve runs if the signer on chain isn't its key.
- `FireCredits.setPrizeAwarder(<the prize wallet>)`: a separate small wallet with a little ETH for gas. The deploy
  already allows game 1 (`setPrizeGame(1, true)`).

### 4. Prizes at each Series launch

From the repo, in PowerShell (the key is typed hidden and cleared after):

```powershell
$s = Read-Host "RPC URL" -AsSecureString; $env:RPC = [System.Net.NetworkCredential]::new("", $s).Password
node ops\games\award.mjs --series 7 --site https://<the site>          # dry run: shows the top three and the call
$k = Read-Host "Prize wallet key" -AsSecureString; $env:GAME_AWARDER_KEY = [System.Net.NetworkCredential]::new("", $k).Password
node ops\games\award.mjs --series 7 --site https://<the site> --send
Remove-Item Env:GAME_AWARDER_KEY
```

`--series` is the Series that just finished. `--exclude 0x...` takes a wallet off after review (the next one moves
up). It never sends twice: if that Series already has prizes for the game, it stops.

## Kill switches

- `GAMES_PAID_OPEN` off: no new runs. Runs already paid can still finish.
- `GAMES_JUDGING` off: every paid endpoint answers "closed". Paid runs wait and resume when it's back on.
- On chain: `FireGames.setPaused(true)` (every game) or `setGameOpen(1, false)` stops new payments, and the server stops
  approving.
- The server switches judging off by itself if a replay ever disagrees with itself (a broken server, not a player).
  To turn it back on, delete that row in Neon: `delete from game_flags where name = 'judging';`.

## Resume

If the browser or the server fails mid-run, the run is never lost or replaced. The site calls `run` and `shot` again
with the same `runId` and `cap`: same shot, same conditions, a fresh shot clock. A paid run stays claimable for 24 h
before `confirm`.

## Anti-cheat, plainly

The sim is public and every shot is shown first, so a script could work out the best kick. The checks don't stop
that. What they do:

- Every kick is replayed on the server from its raw input; the browser's own result counts for nothing.
- With moving posts, the release time must match the server's clock: within 150 ms of its estimate (arrival time,
  minus half the measured round trip, minus 50 ms of screen delay).
- Impossible input (teleporting pointers, out-of-order times, a press off the paper) is turned down.
- One verdict per shot; tokens are signed and single-use; a run is played only with its capability (`cap`), since run
  ids are public on chain.
- Limits: 20 new runs per IP per 10 minutes, 2 kick posts per run per second. No daily cap (decision 21).
- Every kick's raw input and every turned-down kick are kept in Neon for the owner's review before prizes, and the
  chain caps prizes at 6 per game per Series.

## Files

- `web/art/factory/forge/paperfb-sim.js` (+ `paperfb-sim.mjs` for Node): the shared sim. Load it before `paperfb.js`.
- `web/api/games/[game]/[action].js`: the Vercel function. `web/api/games/_lib/`: the server (`server.js`), the games
  (`games.js`), storage (`store-neon.js`, `store-memory.js`, `schema.sql`), the chain (`chain.js`), tokens and config.
- `ops/games/award.mjs`: the prize job.
- Tests: `cd web && npm run test:games` (the sim, browser-vs-Node replays, the server, storage, and the approval
  against FireGames on Anvil; the browser, Anvil and Postgres tests skip when Playwright, Foundry or `PGLITE` isn't
  there), and `cd ops && npm test`.
