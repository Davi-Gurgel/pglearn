import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// electron-vite builds the three Electron entry points in one config:
// main (Node), preload (Node, sandboxed bridge) and renderer (a normal Vite web app).
// Our sources follow the T3 Code layout (src/desktop, src/web), so the entries are explicit.
export default defineConfig({
  main: {
    build: { rollupOptions: { input: "src/desktop/main.ts" } },
  },
  preload: {
    build: { rollupOptions: { input: "src/desktop/preload.ts" } },
  },
  renderer: {
    root: "src/web",
    build: { rollupOptions: { input: "src/web/index.html" } },
    plugins: [react()],
  },
});
