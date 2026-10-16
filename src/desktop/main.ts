import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, session, shell, type IpcMainInvokeEvent } from "electron";
import {
  cancelQuery,
  closeDatabase,
  connectDatabase,
  databaseUrl,
  explainDatabase,
  listTables,
  pageRows,
  pingDatabase,
  queryDatabase,
  useDatabase,
} from "../backend/database";
import { saveConnection, savedConnection } from "./connection";

const rendererFile = join(__dirname, "../renderer/index.html");
const devServerUrl = !app.isPackaged ? process.env["ELECTRON_RENDERER_URL"] : undefined;
const rendererUrl = devServerUrl ?? pathToFileURL(rendererFile).href;

function trustedPage(url: string): boolean {
  try {
    const page = new URL(url);
    const expected = new URL(rendererUrl);
    return (
      page.protocol === expected.protocol &&
      page.origin === expected.origin &&
      page.pathname === expected.pathname
    );
  } catch {
    return false;
  }
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    // Align native traffic lights with the 44px toolbar inside the 4px frame.
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 18, y: 19 },
    backgroundColor: "#e9e9ec",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      sandbox: true,
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
    if (trustedPage(url)) return;
    event.preventDefault();
    openExternal(url);
  });

  // In dev, electron-vite serves the renderer from a Vite dev server. A packaged
  // app ignores the variable, so nobody can point it at another URL.
  if (!app.isPackaged && devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(rendererFile);
  }
}

function openExternal(url: string): void {
  if (url.startsWith("https://")) void shell.openExternal(url);
}

// Every privileged call must come from our own top-level page, including in a
// packaged file:// window (all file URLs otherwise have the same null origin).
function handle<A extends unknown[]>(channel: string, run: (...args: A) => unknown): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: A) => {
    if (event.senderFrame !== event.sender.mainFrame || !trustedPage(event.senderFrame.url)) {
      throw new Error("Untrusted IPC sender.");
    }
    return run(...args);
  });
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected text.");
  return value;
}

handle("db:ping", () => pingDatabase());
handle("db:connection", () => databaseUrl());
handle("db:connect", async (url: unknown) => {
  const connection = text(url);
  const result = await connectDatabase(connection);
  if (result.ok) saveConnection(connection);
  return result;
});
handle("db:tables", () => listTables());
handle("db:query", (sql: unknown) => queryDatabase(text(sql)));
handle("db:rows", (resultId: unknown, offset: unknown, count: unknown) => {
  if (
    typeof resultId !== "number" ||
    !Number.isSafeInteger(resultId) ||
    resultId < 1 ||
    typeof offset !== "number" ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    typeof count !== "number" ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 200
  )
    throw new Error("Invalid result page.");
  return pageRows(resultId, offset, count);
});
handle("db:explain", (sql: unknown) => explainDatabase(text(sql)));
handle("db:cancel", () => cancelQuery());

void app.whenReady().then(() => {
  // safeStorage only works once the app is ready, and the window's first ping
  // must already go to the saved database.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  const saved = savedConnection();
  if (saved) useDatabase(saved);
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
