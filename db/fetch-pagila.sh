#!/bin/sh
# Downloads the Pagila sample database into db/init/, where the Postgres
# container runs it on first start. Pinned before upstream added pgvector,
# which the stock postgres image lacks.
# Not committed: the data file is ~12 MB.
set -eu
cd "$(dirname "$0")"
mkdir -p init
base=https://raw.githubusercontent.com/devrimgunduz/pagila/481abd8fd518fec9abeba14db9ed1a2895c9bd33
curl -fsSL -o init/01-schema.sql "$base/pagila-schema.sql"
curl -fsSL -o init/02-data.sql "$base/pagila-data.sql"
