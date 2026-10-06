import { contextBridge } from "electron";

// The preload runs before the page, with access to Node and Electron, but the
// page itself cannot see any of it. contextBridge is the only door: whatever is
// exposed here shows up as `window.api` in the renderer.
contextBridge.exposeInMainWorld("api", {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
