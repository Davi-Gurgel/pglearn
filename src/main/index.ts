import { join } from "node:path";
import { app, BrowserWindow } from "electron";

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In dev, electron-vite serves the renderer from a Vite dev server.
  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

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
