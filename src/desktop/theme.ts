import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, nativeTheme } from "electron";
import type { Theme } from "../contracts/ipc";

// Light or dark, once picked in the app instead of following macOS. Setting
// nativeTheme switches the page's prefers-color-scheme and the window's own
// controls together. A plain file, so the next launch opens in it.
const file = () => join(app.getPath("userData"), "theme");

export function restoreTheme(): void {
  try {
    const saved = readFileSync(file(), "utf8");
    if (saved === "light" || saved === "dark") nativeTheme.themeSource = saved;
  } catch {
    // Never picked: follow macOS.
  }
}

export function setTheme(theme: Theme): void {
  nativeTheme.themeSource = theme;
  try {
    writeFileSync(file(), theme);
  } catch {
    console.warn("Could not remember the theme.");
  }
}
