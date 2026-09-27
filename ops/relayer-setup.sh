#!/usr/bin/env bash
# The Fire — OpenVRF relayer box. Run as root on a fresh Ubuntu 24.04 VPS:
#   curl -fsSL https://raw.githubusercontent.com/ThiccLiquidity/the-fire/main/ops/relayer-setup.sh | bash
# Then edit /root/openvrf/.env (the script tells you which lines) and: cd /root/openvrf && docker compose up -d
set -euo pipefail

echo "== 1/5 system packages"
apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl git ufw >/dev/null

echo "== 2/5 docker"
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh >/dev/null; fi
systemctl enable --now docker >/dev/null

echo "== 3/5 firewall (ssh only)"
ufw --force reset >/dev/null; ufw default deny incoming >/dev/null; ufw default allow outgoing >/dev/null; ufw allow OpenSSH >/dev/null; ufw --force enable >/dev/null

echo "== 4/5 OpenVRF"
cd /root
# Pin the OpenVRF commit you reviewed: OPENVRF_REF=<commit> before running. Unpinned = whatever main is today.
if [ ! -d openvrf ]; then git clone -q https://github.com/Robinhood-OSS/OpenVRF openvrf; fi
cd openvrf
if [ -n "${OPENVRF_REF:-}" ]; then git fetch -q origin && git checkout -q "$OPENVRF_REF"; else echo "   (warning: OpenVRF not pinned; set OPENVRF_REF to a reviewed commit)"; fi
git submodule update --init --recursive -q
cp -n .env.example .env
mkdir -p secrets && chmod 700 secrets

echo "== 5/5 relayer key"
if [ ! -f secrets/relayer-key ]; then
  echo
  echo "Paste the RELAYER wallet's private key (the small, dedicated wallet — never the deployer), then Enter:"
  # Read from the terminal, not stdin: under `curl | bash` stdin is this script, and `read` would swallow its next lines.
  read -r -s KEY </dev/tty; echo
  printf '%s' "$KEY" | grep -Eq '^(0x)?[0-9a-fA-F]{64}$' || { echo "That doesn't look like a private key (64 hex characters)."; exit 1; }
  printf '%s' "$KEY" > secrets/relayer-key
fi
chown 1000:1000 secrets/relayer-key && chmod 600 secrets/relayer-key

echo "== keeper key"
KDIR=/root/fire-keeper; mkdir -p $KDIR && chmod 700 $KDIR
if [ ! -f $KDIR/keeper-key ]; then
  echo "Paste the KEEPER wallet's private key (a third small wallet, ~\$5 of ETH — not the relayer, not the deployer), then Enter:"
  read -r -s KKEY </dev/tty; echo
  printf '%s' "$KKEY" | grep -Eq '^(0x)?[0-9a-fA-F]{64}$' || { echo "That doesn't look like a private key (64 hex characters)."; exit 1; }
  printf '%s' "$KKEY" > $KDIR/keeper-key
fi
chown 1000:1000 $KDIR/keeper-key && chmod 600 $KDIR/keeper-key
if [ ! -f $KDIR/opensea-key ]; then
  echo "Paste your OpenSea API key (lets the keeper sweep the mill floor; Enter to skip):"
  read -r -s OKEY </dev/tty; echo
  if [ -n "$OKEY" ]; then printf '%s' "$OKEY" > $KDIR/opensea-key; chown 1000:1000 $KDIR/opensea-key; chmod 600 $KDIR/opensea-key; fi
fi
if [ ! -d /root/the-fire ]; then git clone -q https://github.com/ThiccLiquidity/the-fire /root/the-fire; fi
POSTGRES_PASSWORD=$(openssl rand -hex 24)
grep -q '^POSTGRES_PASSWORD=' .env && sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$POSTGRES_PASSWORD/" .env || echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" >> .env

cat <<EOF

Done. Now edit /root/openvrf/.env  (nano /root/openvrf/.env) and set:
  RPC_URL=            https RPC (Alchemy recommended; public one is rate-limited)
  WS_URL=             wss RPC (Alchemy)
  CHAIN_ID=4663
  ROUTER_ADDRESS=     the OpenVRF router we deployed
  START_BLOCK=        the block the router was deployed in
  START_REQUEST_ID=1
  RELAY_ALL_CONSUMERS=true
  RELAYER_ADDRESSES=  the relayer wallet's address

Then:
  cd /root/openvrf && docker compose up -d --build && docker compose logs -f relayer

Keeper (rolls the storm nightly, re-rolls/settles stuck rolls, checkpoints the price feed):
  cd /root/the-fire/ops/keeper && docker build -t fire-keeper . && docker run -d --name fire-keeper --restart unless-stopped \\
    -e RPC_URL=<https RPC> -e FIRE=<Fire address> -e TWAP=<PlankUsdTwap address> \\
    -v /root/fire-keeper/keeper-key:/run/secrets/keeper-key:ro \\
    -e OPENSEA_API_KEY_FILE=/run/secrets/opensea-key -v /root/fire-keeper/opensea-key:/run/secrets/opensea-key:ro fire-keeper
  (drop the last line's two OpenSea options if you skipped the key; the keeper then does everything except sweep)
  docker logs -f fire-keeper

Note: Docker-published ports skip ufw. Check \`docker compose ps\` shows no Postgres port bound to 0.0.0.0
(bind it to 127.0.0.1 or don't publish it).

The relayer wallet needs ~\$20 of ETH on Robinhood Chain for gas. Top it up when it gets low.
EOF
