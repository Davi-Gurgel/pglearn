import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "../contracts/ipc";

const desktopBridge: DesktopBridge = {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  ping: () => ipcRenderer.invoke("db:ping"),
  connection: () => ipcRenderer.invoke("db:connection"),
  connect: (url) => ipcRenderer.invoke("db:connect", url),
  tables: () => ipcRenderer.invoke("db:tables"),
  query: (sql) => ipcRenderer.invoke("db:query", sql),
  rows: (resultId, offset, count) => ipcRenderer.invoke("db:rows", resultId, offset, count),
  explain: (sql) => ipcRenderer.invoke("db:explain", sql),
  cancel: () => ipcRenderer.invoke("db:cancel"),
};

// The preload runs before the page, with access to Node and Electron, but the
// page itself cannot see any of it. contextBridge is the only door: whatever is
// exposed here shows up as `window.desktopBridge` in the web app.
contextBridge.exposeInMainWorld("desktopBridge", desktopBridge);
