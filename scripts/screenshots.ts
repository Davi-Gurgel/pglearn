// Retakes the README's screenshots: the built app on the Pagila sample, a join
// plan with its Nested Loop open, once per theme. macOS's own screencapture
// takes the window with its traffic lights and its rounded corners left
// transparent, which a capture from inside Electron would lose. The terminal
// running this needs the Screen Recording permission.
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "@playwright/test";

const sql = `select f.title, i.inventory_id
from film f
join inventory i on i.film_id = f.film_id
where f.title = 'ACADEMY DINOSAUR'`;

const userData = await mkdtemp(join(tmpdir(), "pglearn-screenshots-"));
const env: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/pagila";
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [`--user-data-dir=${userData}`, "."], env });
try {
  const page = await app.firstWindow();
  await page.locator(".title-main").getByText("pagila").waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1400, 860));
  await page.getByRole("textbox", { name: "SQL", exact: true }).fill(sql);
  await page.getByRole("button", { name: "Explain", exact: true }).click();
  await page.locator(".card", { hasText: "Nested Loop" }).click();

  for (const [theme, file] of [
    ["light", "docs/screenshot.png"],
    ["dark", "docs/screenshot-dark.png"],
  ] as const) {
    // Focused, or macOS draws the traffic lights grey.
    const id = await app.evaluate(({ app, BrowserWindow, nativeTheme }, theme) => {
      nativeTheme.themeSource = theme;
      app.focus({ steal: true });
      return BrowserWindow.getAllWindows()[0]!.getMediaSourceId();
    }, theme);
    await page.waitForTimeout(500);
    // The media source id is "window:<CGWindowID>:0". -o leaves out the shadow.
    execFileSync("screencapture", ["-x", "-o", `-l${id.split(":")[1]}`, file]);
    console.log(`Wrote ${file}`);
  }
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true });
}
