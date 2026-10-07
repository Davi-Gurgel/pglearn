# Architecture

## Where code lives

The layout follows T3 Code (`apps/desktop`, `apps/server`, `apps/web`, `packages/contracts`), flattened into one package. A monorepo would add a `package.json` per folder and buy nothing while there is one app.

- `src/desktop`: the Electron shell. `main.ts` is the main process: it owns windows and app lifecycle, and turns IPC calls into backend calls. `preload.ts` is the only bridge to the web app, exposed as `window.desktopBridge`.
- `src/backend`: Postgres and Effect. Bundled into the main process, but plain Node: it never imports `electron`, so it runs and tests without the app.
- `src/web`: the React app (Electron's renderer). It never touches Node or Electron directly, and must work without `window.desktopBridge` when opened in a plain browser.
- `src/contracts`: types both sides agree on, like `DesktopBridge` in [`ipc.ts`](../src/contracts/ipc.ts). Types only, so neither side bundles the other's code.
- `.repos/effect`: the Effect source at the exact installed version, committed as reading material for agents ([why](https://effect.website/blog/the-one-weird-git-trick-that-makes-coding-agents-more-effect-ive)). Nothing builds or imports it. After bumping `effect` in `package.json`, run `pnpm sync:repos` to download the matching source. The article uses `git subtree`, but its later pulls need metadata that our squash merges drop, so [`.repos/sync.sh`](../.repos/sync.sh) just replaces the folder.

electron-vite only finds entry points in its default folders (`src/main`, `src/preload`, `src/renderer`), so [`electron.vite.config.ts`](../electron.vite.config.ts) names ours explicitly.
