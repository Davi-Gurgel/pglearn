#!/bin/sh
# Replaces .repos/effect with the Effect source at the version in package.json,
# so agents read the same code that runs. Run it after bumping `effect`.
# A plain download, not `git subtree`: subtree finds its last sync through
# commit metadata, and our squash merges drop it.
set -eu
cd "$(dirname "$0")"
version=$(node -p "require('../package.json').dependencies.effect")
temp_dir=$(mktemp -d ./.effect-sync.XXXXXX)
trap 'rm -rf "$temp_dir"' 0
trap 'exit 1' HUP INT TERM

# Keep the existing reference until both download and extraction succeed.
curl -fsSL "https://codeload.github.com/Effect-TS/effect/tar.gz/refs/tags/effect@$version" \
  -o "$temp_dir/effect.tar.gz"
mkdir "$temp_dir/effect"
tar -xz -f "$temp_dir/effect.tar.gz" -C "$temp_dir/effect" --strip-components=1
rm -rf effect
mv "$temp_dir/effect" effect
