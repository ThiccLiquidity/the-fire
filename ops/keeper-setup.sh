#!/usr/bin/env bash
# The Fire — keeper box. Run as root on a fresh Ubuntu 24.04 VPS:
#   curl -fsSL https://raw.githubusercontent.com/ThiccLiquidity/the-fire/main/ops/keeper-setup.sh | bash
# It installs Docker, locks the firewall to SSH, asks for the keeper wallet's key (and optionally an OpenSea API key),
# then prints the one command that starts the keeper.
set -euo pipefail

echo "== 1/4 system packages"
apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl git ufw >/dev/null

echo "== 2/4 docker"
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh >/dev/null; fi
systemctl enable --now docker >/dev/null

echo "== 3/4 firewall (ssh only)"
ufw --force reset >/dev/null; ufw default deny incoming >/dev/null; ufw default allow outgoing >/dev/null; ufw allow OpenSSH >/dev/null; ufw --force enable >/dev/null

echo "== 4/4 keeper"
if [ ! -d /root/the-fire ]; then git clone -q https://github.com/ThiccLiquidity/the-fire /root/the-fire; fi
KDIR=/root/fire-keeper; mkdir -p $KDIR && chmod 700 $KDIR
if [ ! -f $KDIR/keeper-key ]; then
  echo
  echo "Paste the KEEPER wallet's private key (a small dedicated wallet, ~\$10 of ETH — never the deployer), then Enter:"
  # Read from the terminal, not stdin: under `curl | bash` stdin is this script, and `read` would swallow its next lines.
  read -r -s KEY </dev/tty; echo
  printf '%s' "$KEY" | grep -Eq '^(0x)?[0-9a-fA-F]{64}$' || { echo "That doesn't look like a private key (64 hex characters)."; exit 1; }
  printf '%s' "$KEY" > $KDIR/keeper-key
fi
chown 1000:1000 $KDIR/keeper-key && chmod 600 $KDIR/keeper-key
OS_OPTS=""
if [ ! -f $KDIR/opensea-key ]; then
  echo "Paste your OpenSea API key (lets the keeper sweep the mill floor; Enter to skip):"
  read -r -s OKEY </dev/tty; echo
  if [ -n "$OKEY" ]; then printf '%s' "$OKEY" > $KDIR/opensea-key; chown 1000:1000 $KDIR/opensea-key; chmod 600 $KDIR/opensea-key; fi
fi
[ -f $KDIR/opensea-key ] && OS_OPTS="-e OPENSEA_API_KEY_FILE=/run/secrets/opensea-key -v $KDIR/opensea-key:/run/secrets/opensea-key:ro"

cat <<EOF

Done. Start the keeper (fill in the three addresses and an https RPC; Alchemy recommended):

  cd /root/the-fire/ops/keeper && docker build -t fire-keeper . && docker run -d --name fire-keeper --restart unless-stopped \\
    -e RPC_URL=<https RPC> -e FIRE=<Fire address> -e TWAP=<PlankUsdTwap address> \\
    -v $KDIR/keeper-key:/run/secrets/keeper-key:ro $OS_OPTS fire-keeper
  docker logs -f fire-keeper

It rolls the storm at 8 PM Arizona time, delivers drand's number, recovers stuck rolls, checkpoints the price feed,
and sweeps the mill floor. Top up the keeper wallet when it drops under ~\$2 of ETH.
EOF
