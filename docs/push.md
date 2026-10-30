# Notifications (web push)

Players can turn on notifications (Menu → Settings → Notifications, or "🔔 Notify me if I leave" on the pack/grade
wait). Then their phone or computer tells them, even with the site closed:
- **Your cards are ready 🔥**: an open of theirs was dealt.
- **Your grades are in**: a grading of theirs finished.

On iPhone it works once the app is installed (Menu → Install app: Apple only allows notifications for home-screen
apps). Android and desktop browsers work in the browser too.

How it works: the browser subscribes at `/api/push/subscribe` with the connected wallet (`web/api/push`). The keepers
see each open dealt and each grading finished and ask `/api/push/send` (with a secret) to notify that wallet. Each event
is sent once, however many keepers ask. The server only ever posts to the real push services (Google, Apple, Mozilla,
Microsoft). Nothing is stored but the wallet address, the browser's push address, and its keys.

## Setup (once, about 10 minutes)

1. **Keys.** In PowerShell, from the repo:
   ```powershell
   cd C:\Users\DubT1\the-fire\web
   npx web-push generate-vapid-keys
   ```
   It prints a Public Key and a Private Key. Copy them straight into Vercel (next step), not into a chat or a file.
2. **Vercel** → the project → Settings → Environment Variables (Preview for the testnet, Production later):
   | Name | Value | Sensitive |
   |---|---|---|
   | `PUSH_VAPID_PUBLIC` | the Public Key | No |
   | `PUSH_VAPID_PRIVATE` | the Private Key | Yes |
   | `PUSH_VAPID_SUBJECT` | `mailto:` + an email you read, e.g. `mailto:you@example.com` | No |
   | `PUSH_SEND_SECRET` | 32+ random characters (the same PowerShell line as `GAME_SEED_SECRET` in docs/game-server.md) | Yes |
   `DATABASE_URL` is already there from the game server (the same Neon database).
3. **Neon** → SQL Editor: paste all of `web/api/push/_lib/schema.sql`, Run (safe to run again).
4. **Railway**, both keeper services → Variables:
   - `PUSH_URL` = `https://<the site>/api/push/send`
   - `PUSH_SEND_SECRET` = the same secret as in Vercel
5. Redeploy the site; the keepers restart by themselves after a variable change.

**Check:** on the site, Menu → Notifications: On (allow it). Open a pack and close the tab: the notification arrives
when it's dealt. Keeper log: no `notify: the site answered ...` lines. Without the variables everything else works;
the Notifications switch just says they're off.
