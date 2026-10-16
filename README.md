# pglearn

**See how PostgreSQL runs your SQL.**

A macOS desktop client for learning to read execution plans. Run a query, open its plan as a graph, and click a step to understand what it does and how PostgreSQL's row estimate compares with the result.

[Download for macOS](https://github.com/Davi-Gurgel/pglearn/releases/latest) · [Try the sample database](#try-it-with-pagila) · [Contributing](CONTRIBUTING.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <img src="docs/screenshot.png" alt="A real Pagila film and inventory join shown as a plan graph, with the Nested Loop inspector explaining its algorithm and estimated versus actual rows.">
</picture>

## What you can do

- Connect to one PostgreSQL database using connection fields or a URL. The last connection is remembered using Electron's encrypted storage and the macOS Keychain.
- Browse schemas and tables, write SQL, and view typed results in a paginated grid.
- Run `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` and explore the plan as a graph or as text.
- Click a node for a hand-written explanation, an algorithm diagram, row estimates versus actuals, and links to the PostgreSQL documentation.
- Inspect loops, parallel work, buffer use, and sorts or hashes that spill to disk. Cancel a query or let the 30-second timeout stop it.
- Use the system's light or dark appearance and keyboard shortcuts: **⌘↵** Run, **⇧⌘↵** Explain, **⌘.** Stop.

## Download

**Experimental v0.1 · macOS 13 or newer.** Download `pglearn-0.1.0-universal.dmg` from [GitHub Releases](https://github.com/Davi-Gurgel/pglearn/releases/latest).

One universal app runs natively on both Apple Silicon (M1 and newer) and Intel Macs. Apple Silicon Macs do not need Rosetta.
Open the DMG and drag **pglearn** into **Applications**. ZIPs and SHA-256 checksums are also provided. PostgreSQL is a separate server; it is not bundled with the app.

This first release is **unsigned and not notarized**. macOS may block its first launch. After verifying that the download came from this repository, follow [Apple's instructions for opening an app from an unidentified developer](https://support.apple.com/en-us/102445). Signing and notarization are not configured yet.

## Try it with Pagila

The example queries use [Pagila](https://github.com/devrimgunduz/pagila), a fictional film-rental database. With Docker installed, clone this repository and run:

```sh
git clone https://github.com/Davi-Gurgel/pglearn.git
cd pglearn
./db/fetch-pagila.sh
docker compose up -d
```

Wait until PostgreSQL finishes loading the sample data, then connect from the app using:

```text
postgres://postgres:postgres@localhost:5432/pagila
```

Pick **Joins: who rented what**, press **Explain**, and click a **Nested Loop** node. It repeatedly runs its inner input for each row from its outer input; the inspector shows why rows per loop and total rows are different.

The container listens only on this Mac. The credentials above are public sample credentials. To remove the sample database and its data, run `docker compose down -v`.

## Query behavior and current limits

**Run executes your SQL normally, including writes. Explain also executes the statement**, but wraps it in a transaction that is always rolled back. Rollback restores table changes; it does **not** restore sequence values, remove dead row versions, or undo external effects of functions. Explain is not a sandbox. Use a disposable database while learning.

- One connection and one statement at a time. Session settings and explicit `BEGIN` / `COMMIT` / `ROLLBACK` carry across runs. Finish your own transaction before using Explain.
- Results are fetched into memory in the main process; pagination limits rendering, not the database query. Avoid unbounded queries on large tables.
- Duplicate column names need aliases (`AS`). Cast infinite or out-of-range timestamps to `text` to display them.
- The bundled examples and automated integration tests use PostgreSQL 18. Other server versions have not been validated.
- No data editing UI, saved query library, multiple connections, or plan comparison yet. Plan comparison is the next candidate.

## Why I built it

I'm learning PostgreSQL and exploring how to build software with coding agents. I wanted a client that helps me understand the database's choices: when an index helps, how joins move rows, and when an estimate is misleading. The explanations are written into the app; there is no AI service or API key to configure.

The project deliberately keeps the plumbing small so most of the attention can go to explaining plans.

## Development

Requires **Node.js 24+** and **pnpm** (the pinned version is in `package.json`). Docker is needed only for the sample database and integration tests.

```sh
pnpm install
pnpm dev             # Electron app + renderer at http://localhost:5173
pnpm typecheck
pnpm lint
pnpm format --check
pnpm test            # plan interpretation and value conversion
pnpm test:e2e        # real Electron + PostgreSQL; start Pagila first
pnpm dist:mac        # universal DMG + ZIP, in release/
```

Connect through the app, or set `DATABASE_URL` before starting it. A connection previously saved by the app takes precedence. The plain-browser renderer previews the UI with database actions disabled.

**Electron + React + TypeScript**, built with electron-vite. Effect and the PostgreSQL driver run in the main process; the renderer uses a small typed IPC bridge. The plan graph uses HTML cards and SVG edges without a graph library. See [the architecture](docs/architecture.md) for the process boundaries and [CONTRIBUTING.md](CONTRIBUTING.md) for development and release checks.

## License

[MIT](LICENSE). Pagila is downloaded separately and retains its [upstream license](https://github.com/devrimgunduz/pagila/blob/master/LICENSE.txt).
