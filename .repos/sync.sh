#!/bin/sh
# Replaces .repos/effect with the Effect source at the version in package.json,
# so agents read the same code that runs. Run it after bumping `effect`.
# A plain download, not `git subtree`: subtree finds its last sync through
# commit metadata, and our squash merges drop it.
set -eu
cd "$(dirname "$0")"
version=$(node -p "require('../package.json').dependencies.effect")
rm -rf effect
mkdir effect
curl -fsSL "https://codeload.github.com/Effect-TS/effect/tar.gz/refs/tags/effect@$version" |
  tar -xz -C effect --strip-components=1
