import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";

// The connection string the user last connected to, so the app reopens on it.
// It holds a password, so it is stored encrypted with safeStorage (on macOS, a
// key kept in the Keychain), never as plain text. Without encryption it is not
// stored at all.
const file = () => join(app.getPath("userData"), "connection");

export function savedConnection(): string | undefined {
  try {
    return safeStorage.decryptString(readFileSync(file()));
  } catch {
    // Never saved, or saved under a key this machine no longer has.
    return undefined;
  }
}

export function saveConnection(url: string): void {
  if (!safeStorage.isEncryptionAvailable()) return;
  try {
    writeFileSync(file(), safeStorage.encryptString(url), { mode: 0o600 });
  } catch {
    // Remembering is optional: a full disk must not turn a successful connect
    // into an IPC failure after the database has already changed.
    console.warn("Could not remember the database connection.");
  }
}
