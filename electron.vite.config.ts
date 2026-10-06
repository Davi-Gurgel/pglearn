import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// electron-vite builds the three Electron entry points in one config:
// main (Node), preload (Node, sandboxed bridge) and renderer (a normal Vite web app).
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
  },
});
