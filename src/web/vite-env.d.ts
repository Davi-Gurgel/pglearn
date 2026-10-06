/// <reference types="vite/client" />

import type { DesktopBridge } from "../contracts/ipc";

// `window.desktopBridge` only exists inside Electron (it comes from the preload).
// Opening the Vite dev server in a plain browser leaves it undefined.
declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
  }
}
