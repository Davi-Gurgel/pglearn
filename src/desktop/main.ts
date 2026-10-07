import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { closeDatabase, pingDatabase } from "../backend/database";

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

  // In dev, electron-vite serves the renderer from a Vite dev server. A packaged
  // app ignores the variable, so nobody can point it at another URL.
  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (!app.isPackaged && devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

ipcMain.handle("db:ping", () => pingDatabase());

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
