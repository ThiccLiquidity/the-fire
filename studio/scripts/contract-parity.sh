#!/usr/bin/env bash
# Refreshes scripts/fixtures/recipe-parity.json: the contract's answers (RecipeDealer.check / previewPool, parsed by
# ConfigureSeries.s.sol) for the recipe cases in scripts/recipe-parity.test.ts. Needs forge (Foundry) and solc 0.8.28.
# Works on a scratch copy of contracts/, so contracts/ itself is never touched. Run from studio/:
#   bash scripts/contract-parity.sh
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
(cd "$here/../contracts" && tar cf - --exclude=./out --exclude=./cache --exclude=./broadcast .) | (cd "$work" && tar xf -)
cp "$here/scripts/forge/StudioParity.t.sol" "$work/test/cards/StudioParity.t.sol"
sed -i 's#fs_permissions = .*#fs_permissions = [{ access = "read-write", path = "./test/cards" }, { access = "read", path = "./script" }]#' "$work/foundry.toml"
cases="$work/test/cards/studio-parity"
(cd "$here" && WRITE_RECIPE_CASES="$cases" npx vitest run scripts/recipe-parity.test.ts >/dev/null)
solc="${SOLC:-$HOME/.foundry/solc/solc-0.8.28}"
use=()
[ -x "$solc" ] && use=(--use "$solc")
(cd "$work" && forge test --offline "${use[@]}" --match-contract StudioParityTest --gas-limit 18446744073709551615)
node -e '
const fs = require("fs")
const [cases, results, out] = process.argv.slice(1)
fs.writeFileSync(out, JSON.stringify({ cases: JSON.parse(fs.readFileSync(cases, "utf8")), results: JSON.parse(fs.readFileSync(results, "utf8")) }))
' "$cases/cases.json" "$cases/results.json" "$here/scripts/fixtures/recipe-parity.json"
echo "wrote scripts/fixtures/recipe-parity.json"
