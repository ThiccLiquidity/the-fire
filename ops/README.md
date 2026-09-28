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
   (stored in a file, since it may hold a provider key) and, optionally, your OpenSea API key.
4. Make a free check at healthchecks.io (period 5 min, grace 5 min) with email/phone alerts; copy its ping URL.
5. Run the `docker run …` line it prints, with the Fire address and the ping URL filled in.

## What the keeper does
Every 30 seconds:
- `Fire.roll()` once 8 PM MST has passed;
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
`HEALTHCHECK_URL`, so a dead keeper texts you within 10 minutes. Lines starting with `ALERT` (can't reach drand, low
balance) need a look.

## Day to day
- Nothing. If a storm hasn't rolled by 8:05 PM, check `docker logs --tail=50 fire-keeper`.
- Top up the keeper wallet when it drops under ~$5 of ETH (the keeper logs `ALERT` below 0.002 ETH).
- Updates: `cd /root/the-fire && git fetch --tags && git checkout <new tag> && cd ops/keeper && docker build -t fire-keeper . && docker rm -f fire-keeper`,
  then the same `docker run` line.
