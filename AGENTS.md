# Pglearn - my personal project for learning PostgresSQL and building with agents

A visual PostgreSQL desktop client for exploring, querying, and understanding databases. It combines the familiar workflow of tools like DBeaver with a learning-focused layer that explains what PostgreSQL is doing under the hood.

You can think of it as a PostgreSQL IDE where you can browse schemas and data, write SQL, inspect execution plans, understand nodes like Seq Scan and Hash Join, compare plans before and after changes, and see how PostgreSQL's estimates differ from actual execution.

## Why I'm doing this?

I'd like to improve my workflow with coding agents testing stuff during the development of this project and in the course of that I would learn PostgreSQL (something I'm working with right now).

## A note from me

I like ambitious ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising. 

Make sure I understand everything in this codebase, so be ready to do explaining of some more advanced concepts and recomending learning resources.

Channel both "measure twice, cut once" and "yagni". Fight scope creep. Try to honor the dev's intent in both a minimal and realistic fashion.

The rest of this document is meant to help you navigate the codebase and make changes effectively. Think of these instructions less as "hard rules", more as "good defaults". The developer's preferences should be able to override anything here.

## Documentation

Most code changes do not need an internal documentation change. Agents can read the code.

- `docs/` is for architectural decisions and their reasons, constraints that span components, and implementation traps that are hard to discover from the source. Before adding a paragraph, ask what a maintainer would get wrong without it. If reading the relevant code answers the question, leave it out.
- Do not document every feature, enumerate fields or methods, narrate control flow, maintain file catalogs, or append PR summaries. Types, tests, and code already record the implementation. The glossary defines shared vocabulary; it is not a feature index.
- Keep a local implementation explanation in a nearby code comment. Use an internal doc when the reasoning crosses boundaries or needs context the code cannot carry well. Link to the relevant source instead of copying it.
- When a documented decision or constraint changes, rewrite or remove the affected text. Do not append another account of the new behavior. A new internal page needs a distinct, durable reason to exist.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch files.
- Plans live in `docs/plans/` (gitignored). `docs/plans/roadmap.md` tracks the MVP milestones; read it at the start of a session and update its status as milestones finish.

## Scope

The differentiator is explaining execution plans, not browsing data. Everything else is plumbing and should stay as simple as possible.

MVP:

1. Connect to one Postgres database via connection string.
2. SQL editor with a results grid.
3. "Explain" runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` and renders the plan as a tree.
4. Clicking a plan node shows a hand-written explanation (linking to the official docs) and estimated vs actual rows.

Not yet: data editing, multiple connections, ER diagrams, plan comparison (first v2 candidate), AI features.

Target: macOS only for now.

The developer is new to PostgreSQL (knows general database concepts). In-app explanations and explanations given while developing should assume no Postgres-specific knowledge.

## How it works

- Electron + React + TypeScript, built with electron-vite (one config for main, preload and renderer). Packaging (electron-builder) comes later.
- The renderer is a plain Vite app: `pnpm dev` also serves it at http://localhost:5173, so agents can test the UI in a browser. There `window.desktopBridge` (the preload bridge) is `undefined`; the UI must cope with that.
- Effect v4 lives in `src/backend`, which runs in the main process, where the real effects are: connection lifecycle, query cancellation, timeouts, and typed errors. The renderer stays plain React and talks to main over IPC. Don't spread Effect into the renderer without a concrete reason.
- Before writing Effect code, read `.repos/effect/LLMS.md`, then the source and tests under `.repos/effect/packages/` (`effect` and `sql/pg` are the ones we use). Prefer their patterns over invented ones or web results.

## Where code lives

See [docs/architecture.md](docs/architecture.md). Update it, not this file, when the layout changes.

`.repos/effect` is a vendored read-only reference. Never edit or import from it; app code imports from `node_modules` as usual.
