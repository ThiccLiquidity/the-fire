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
- Nothing. If a storm hasn't rolled by 8:05 PM, check `docker logs --tail=50 fire-keeper` and
  `docker compose logs --tail=50 relayer`.
- Top up the relayer wallet when it drops under ~$5 of ETH, and the keeper wallet under ~$2.
- Updates: `cd /root/openvrf && git pull && docker compose up -d --build`.

## The keeper (`ops/keeper/`)
A small Node program on the same box that does the jobs nobody should have to click:
- `Fire.roll()` once 8 PM Phoenix has passed;
- `adapter.settle(id)` if OpenVRF has the number but its callback didn't reach the Fire;
- `Fire.reroll()` if a roll has had no answer for 30 minutes (the contract only allows it while OpenVRF has no number);
- `PlankUsdTwap.checkpoint()` once the price window is 20h+ old.

Every one of those is permissionless — the keeper has no special powers, it's just always awake. It uses its own small
wallet (~$5 of ETH; separate from the relayer so their transactions never collide). The setup script asks for that
key and prints the `docker run` line. Check it with `docker logs --tail=50 fire-keeper`.

If the keeper is ever down, anyone can do the same from the site's "Roll the storm" button.
