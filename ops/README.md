# Ops: the randomness relayer

The nightly storm uses drand (a public randomness beacon) verified on-chain by OpenVRF. A small always-on program
— the relayer — watches for the Fire's nightly request, fetches the drand proof, and submits it. It can't choose
the number; it can only be late. It runs on a $6/month VPS.

## Set up the box (once, ~15 min)

1. **DigitalOcean → Create → Droplet.** Region: any US. Image: **Ubuntu 24.04**. Size: **Basic, Regular, $6/mo (1 GB)**.
   Authentication: **SSH key** (paste your PC's public key — PowerShell: `cat ~/.ssh/id_ed25519.pub`; make one with
   `ssh-keygen -t ed25519` if you don't have it). Hostname: `fire-relayer`. Create.
2. From PowerShell: `ssh root@<droplet IP>`
3. Paste:
   ```
   curl -fsSL https://raw.githubusercontent.com/ThiccLiquidity/the-fire/main/ops/relayer-setup.sh | bash
   ```
   It installs Docker, locks the firewall to SSH, clones OpenVRF, and asks for the **relayer wallet's** private key
   (the small dedicated wallet, ~$20 ETH — never the deployer).
4. `nano /root/openvrf/.env` — fill the lines the script lists (RPC, router address, start block, relayer address).
5. `cd /root/openvrf && docker compose up -d --build && docker compose logs -f relayer` — you should see it connect
   and start watching. Ctrl+C leaves it running.

## Day to day
- Nothing. Check `docker compose logs --tail=50 relayer` if a storm hasn't rolled by 8:05 PM.
- Top up the relayer wallet when it drops under ~$5 of ETH.
- Updates: `cd /root/openvrf && git pull && docker compose up -d --build`.

## Nightly roll + price checkpoint
Anyone can call `Fire.roll()` after 8 PM Phoenix and `PlankUsdTwap.checkpoint()` any time. Cheapest reliable way is
a cron on the same box (`ops/nightly.sh`, installed by the setup script in a later step) using `cast` with the
relayer key. If it ever misses, the site shows a "Roll the storm" button anyone can click.
