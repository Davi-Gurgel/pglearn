# pglearn

A visual desktop client for PostgreSQL focused on **learning and understanding the database**, not just running SQL.

pglearn combines the familiarity of a client like DBeaver with a didactic layer that shows what PostgreSQL is doing under the hood.

> **Status:** early development. Nothing is usable yet.

## Planned features

- **Database Explorer**: browse connections, schemas, tables, columns, PKs, FKs, indexes and constraints.
- **Table Viewer**: open a table and inspect its data in a grid.
- **SQL Editor**: write and run queries.
- **Plan Explorer**: run `EXPLAIN` and see the plan as a visual tree.
- **Node Inspector**: click a node (Seq Scan, Index Scan, Hash Join...) to get a plain-language explanation plus the real PostgreSQL data.
- **Estimated vs Actual**: compare what PostgreSQL expected with what happened (`EXPLAIN ANALYZE`).
- **Plan Compare**: compare a plan before and after a change, such as creating an index.
- **Safe mode**: make it obvious when an action actually executes or changes data.

Main flow:

```
open table → explore data → write SQL → see plan → understand the decision → change query/index → compare result
```

## Roadmap

| Milestone | Scope |
|---|---|
| v0.1 (MVP) | SQL Editor, Plan Explorer, Node Inspector, Estimated vs Actual, Safe mode |
| v0.2 | Plan Compare |
| Later | Database Explorer, Table Viewer |

## Development

Start a local PostgreSQL with the [Pagila](https://github.com/devrimgunduz/pagila) sample database (requires Docker):

```sh
./db/fetch-pagila.sh   # once: downloads the sample data into db/init/
docker compose up -d
```

Connect with `postgres://postgres:postgres@localhost:5432/pagila`, or open a shell:

```sh
docker compose exec postgres psql -U postgres -d pagila
```

The sample data loads only on first start. To reset the database: `docker compose down -v && docker compose up -d`.

App setup instructions will be added once the app is scaffolded.

## Branching and releases

- `main` is always stable and only receives changes through pull requests.
- Work happens in short-lived branches (`feat/...`, `fix/...`, `docs/...`).
- Releases are git tags (`v0.1.0`, ...) published as GitHub Releases.

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

[MIT](LICENSE)
