#!/usr/bin/env bash
# Regenerates web/public/forge (the copy the site serves) from web/art/factory/forge and build3/.
# The source pages load scene art from ../build3/; the served copy keeps it in a/ next to the pages.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$here/../../public/forge"

rm -rf "$out"
mkdir -p "$out/a"
cp -R "$here/forge/." "$out/"
cp "$here"/build3/*.webp "$here"/build3/scene.json "$out/a/"
find "$out" -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' \) \
  -exec sed -i.bak 's#\.\./build3/#a/#g' {} +
find "$out" -name '*.bak' -delete

echo "Synced $(find "$out" -type f | wc -l | tr -d ' ') files to web/public/forge"
