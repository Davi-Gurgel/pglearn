import { join } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { cancelQuery, closeDatabase, pingDatabase, queryDatabase } from "../backend/database";

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Links (like the Postgres docs) open in the default browser. Left alone, a
  // link would replace the app in this window, or open a bare Electron window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  // Same-origin navigations are the app itself (Vite's full reload in dev).
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin === new URL(window.webContents.getURL()).origin) return;
    event.preventDefault();
    openExternal(url);
  });

  // In dev, electron-vite serves the renderer from a Vite dev server. A packaged
  // app ignores the variable, so nobody can point it at another URL.
  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (!app.isPackaged && devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function openExternal(url: string): void {
  if (url.startsWith("https://")) void shell.openExternal(url);
}

ipcMain.handle("db:ping", () => pingDatabase());
ipcMain.handle("db:query", (_event, sql: string) => queryDatabase(sql));
ipcMain.handle("db:cancel", () => cancelQuery());

void app.whenReady().then(() => {
  createWindow();

  // macOS: clicking the dock icon with no windows open should open one again.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// macOS apps stay alive after the last window closes; everywhere else we quit.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Close the pool before quitting, so Postgres gets a proper goodbye on each
// connection instead of a dropped socket. Electron does not wait for promises
// here, so we hold the quit and finish it once the pool is closed. It has to be
// app.exit(): Electron ignores app.quit() while a quit is already under way.
app.on("will-quit", (event) => {
  event.preventDefault();
  void closeDatabase().finally(() => app.exit());
});
