# Ops: the keeper

The nightly storm uses drand, a public randomness beacon. When the Fire rolls, it asks our router
(`OpenDrandRouter`) for the drand round 30–33 seconds in the future. Once drand publishes that round, **anyone** can
submit its signature: the router checks it on-chain and there's exactly one valid number, so whoever submits it
can't change it, and nobody can hold it back to get a different one.

The keeper is a small always-on program that makes sure somebody does. It runs on a $6/month VPS. There's no
separate relayer, no database and no owner key.

## Set up the box (once, ~10 min)

1. **DigitalOcean → Create → Droplet.** Region: any US. Image: **Ubuntu 24.04**. Size: **Basic, Regular, $6/mo (1 GB)**.
   Authentication: **SSH key** (paste your PC's public key — PowerShell: `cat ~/.ssh/id_ed25519.pub`; make one with
   `ssh-keygen -t ed25519` if you don't have it). Hostname: `fire-keeper`. Create.
2. From PowerShell: `ssh root@<droplet IP>`
3. Paste:
   ```
   curl -fsSL https://raw.githubusercontent.com/ThiccLiquidity/the-fire/v1.0.0/ops/keeper-setup.sh | RELEASE=v1.0.0 bash
   ```
   (use the release tag the contracts were deployed from). It installs Docker, locks the firewall to SSH, and asks
   for the **keeper wallet's** private key (a small dedicated wallet, ~$10 of ETH — never the deployer), your RPC URL
   (stored in a file, since it may hold a provider key) and your OpenSea API key. That key is required for launch: without it the press fund never buys a press (ETH and
   USDG from tickets just pile up in the Fire). You can press Enter to skip it for now and re-run the script later.
4. Make a free check at healthchecks.io (period 5 min, grace 5 min) with email/phone alerts; copy its ping URL.
5. Run the `docker run …` line it prints, with the Fire address and the ping URL filled in.

## What the keeper does
Every 30 seconds:
- `Fire.roll()` once 21:00 UTC (2 PM MST) has passed;
- `OpenDrandRouter.fulfill(id, signature)` once drand has published the roll's round (it fetches the signature from
  the public drand relays; `DRAND_URLS` overrides them);
- `adapter.settle(id)` if the router has the number but its callback didn't reach the Fire;
- `Fire.reroll()` only if a roll has waited 2 hours (`REROLL_AFTER`) **and** the drand relays report the round isn't published yet
  (a real drand stall). If the keeper just can't reach drand, it logs `ALERT` and does not reroll;
- `PlankUsdTwap.checkpoint()` every 30 minutes (the price window; ~48 tiny transactions a day), and `PaperUsdTwap.checkpoint()` whenever it's
  `due()` (both found through the Fire);
- every 5 minutes, with an OpenSea key: sweeps the mill floor. It prices every listing in dollars (USDG at face value,
  ETH at the price feed) and buys the cheapest one at or under the Fire's bid that the fund can pay. When the fund
  holds only USDG it attaches the 0.0003 ETH burn fee itself.

Every one of those is permissionless. If the keeper is down, the site's button covers the storm (roll, deliver,
settle, reroll); the price feeds and the mill sweep can be done by anyone with `cast`. After every good pass it pings
`HEALTHCHECK_URL` only when the game is actually moving; if a roll is 10+ minutes overdue, a roll request has gone
15+ minutes unanswered, one of its transactions has been in flight 15+ minutes, a job is failing or its balance is low,
it pings `<url>/fail` with the reason instead. Either way (dead keeper or stalled game) healthchecks.io texts you.
Lines starting with `ALERT` need a look. A transaction the RPC drops, or one stuck 10+ minutes, is re-sent at the same
nonce with a higher fee (or cancelled if no longer needed), so it can't block the keeper. If your RPC is down it falls
back to the public Robinhood Chain RPC.

## Day to day
- Nothing. If a storm hasn't rolled by 2:05 PM MST (21:05 UTC), check `docker logs --tail=50 fire-keeper`.
- Top up the keeper wallet when it drops under ~$5 of ETH (the keeper logs `ALERT` below 0.002 ETH).
- Updates: `cd /root/the-fire && git fetch --tags && git checkout <new tag> && cd ops/keeper && docker build -t fire-keeper . && docker rm -f fire-keeper`,
  then the same `docker run` line.

## Snapshot (holder window)

`ops/snapshot` takes the secret PLANK-holder snapshot for a drop's holder window: every regular wallet holding $69+
of PLANK, priced with the same 30-minute average the sale uses. From PowerShell:

```powershell
cd C:\Users\DubT1\the-fire\ops\snapshot
npm install
$env:RPC = "https://rpc.mainnet.chain.robinhood.com"
$env:PLANK_USD_FEED = "<PlankUsdTwap address>"
node snapshot.mjs --min-usd 69 --out fire-7-holders.json
```

It prints the **root**: paste it as `holderRoot` when you set up the drop. Give the JSON file to the site so buyers'
proofs load automatically. Run it at a moment nobody knows in advance.
