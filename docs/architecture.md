# Architecture

## Where code lives

The layout follows T3 Code (`apps/desktop`, `apps/web`, `packages/contracts`), flattened into one package. A monorepo would add a `package.json` per folder and buy nothing while there is one app.

- `src/desktop`: Electron. `main.ts` is the main process (Node); Postgres and Effect live on this side. `preload.ts` is the only bridge to the web app, exposed as `window.desktopBridge`.
- `src/web`: the React app (Electron's renderer). It never touches Node or Electron directly, and must work without `window.desktopBridge` when opened in a plain browser.
- `src/contracts`: types both sides agree on, like `DesktopBridge` in [`ipc.ts`](../src/contracts/ipc.ts). Types only, so neither side bundles the other's code.

electron-vite only finds entry points in its default folders (`src/main`, `src/preload`, `src/renderer`), so [`electron.vite.config.ts`](../electron.vite.config.ts) names ours explicitly.
