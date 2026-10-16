import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

let app: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "pglearn-test-"));
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/pagila";
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: process.env.PGLEARN_EXECUTABLE,
    args: [
      "--disable-backgrounding-occluded-windows",
      ...(process.env.CI ? ["--no-sandbox"] : []),
      `--user-data-dir=${userData}`,
      ...(process.env.PGLEARN_EXECUTABLE ? [] : ["."]),
    ],
    env,
  });
  page = await app.firstWindow();
  await expect(page.locator(".title-main")).toHaveText("pagila");
});

test.afterAll(async () => {
  await app?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("runs SQL, paginates rows, and reports duplicate columns and syntax errors", async () => {
  await page
    .getByRole("textbox", { name: "SQL", exact: true })
    .fill("select generate_series(1, 405) as n");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".grid tbody tr")).toHaveCount(200);
  await page.getByRole("button", { name: "Last page" }).click();
  await expect(page.locator(".grid tbody tr")).toHaveCount(5);
  await expect(page.locator(".grid tbody tr").last()).toContainText("405");
  const duplicate = await page.evaluate(() => window.desktopBridge!.query("select 1 as x, 2 as x"));
  expect(duplicate).toMatchObject({ ok: false, error: { kind: "client" } });
  const syntax = await page.evaluate(() => window.desktopBridge!.query("select from"));
  expect(syntax).toMatchObject({ ok: false, error: { kind: "postgres", code: "42601" } });
});

test("Explain rolls back writes and errors, and respects the user's open transaction", async () => {
  const checks = await page.evaluate(async () => {
    const db = window.desktopBridge!;
    await db.query("create temporary table pglearn_check (id integer)");
    const explained = await db.explain("insert into pglearn_check values (1) returning id");
    const result = await db.query("select count(*)::int as n from pglearn_check");
    const rows = result.ok ? await db.rows(result.resultId, 0, 200) : result;
    const failed = await db.explain("select 1/0");
    const recovered = await db.query("select 1 as n");
    await db.query("begin");
    const inTransaction = await db.explain("select 1");
    await db.query("rollback");
    const afterRollback = await db.explain("select 1");
    return { explained, rows, failed, recovered, inTransaction, afterRollback };
  });
  expect(checks.explained.ok).toBe(true);
  expect(checks.rows).toEqual({ ok: true, rows: [["0"]] });
  expect(checks.failed).toMatchObject({ ok: false, error: { kind: "postgres", code: "22012" } });
  expect(checks.recovered.ok).toBe(true);
  expect(checks.inTransaction).toMatchObject({
    ok: false,
    error: { kind: "client", message: expect.stringContaining("still open") },
  });
  expect(checks.afterRollback.ok).toBe(true);
});

test("cancels a running query and reuses the session", async () => {
  await page.getByRole("textbox", { name: "SQL", exact: true }).fill("select pg_sleep(10)");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".running")).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".notice")).toContainText("Stopped");
  expect(await page.evaluate(() => window.desktopBridge!.query("select 1 as n"))).toMatchObject({
    ok: true,
  });
});

test("failed connection keeps the existing database and the sheet works with Escape", async () => {
  await page.getByRole("button", { name: /pagila/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByLabel(/Connection string/)
    .fill("postgres://postgres:wrong@localhost:5432/pagila");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator(".sheet-error")).toContainText("password authentication failed");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => window.desktopBridge!.ping())).toMatchObject({
    ok: true,
    database: "pagila",
  });
});

test("shows the real join plan and inspector in light and dark", async () => {
  await page.getByRole("button", { name: "Joins: who rented what", exact: true }).click();
  await page.getByRole("button", { name: "Explain", exact: true }).click();
  await expect(page.locator(".plan")).toBeVisible();
  const card = page.locator(".card").filter({ hasText: "Nested Loop" }).first();
  await card.click();
  await expect(page.locator(".inspector")).toContainText("Nested Loop");
  await page.emulateMedia({ colorScheme: "light" });
  await app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = "light";
  });
  if (process.env.UPDATE_SCREENSHOTS) {
    await page
      .getByRole("textbox", { name: "SQL", exact: true })
      .fill(
        "select f.title, i.inventory_id\nfrom film f\njoin inventory i on i.film_id = f.film_id\nwhere f.title = 'ACADEMY DINOSAUR'",
      );
    await page.getByRole("button", { name: "Explain", exact: true }).click();
    await expect(page.locator(".card").filter({ hasText: "Nested Loop" }).first()).toBeVisible();
    await page.locator(".card").filter({ hasText: "Nested Loop" }).first().click();
    await page.screenshot({ path: "docs/screenshot.png" });
    await page.emulateMedia({ colorScheme: "dark" });
    await app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = "dark";
    });
    await page.screenshot({ path: "docs/screenshot-dark.png" });
  }
  await page.getByRole("tab", { name: /Text/ }).click();
  await expect(page.locator(".plan-text")).toContainText("Execution Time:");
});

test("times out a statement and keeps the connection usable", async () => {
  const result = await page.evaluate(() => window.desktopBridge!.query("select pg_sleep(35)"));
  expect(result).toEqual({ ok: false, error: { kind: "timeout", seconds: 30 } });
  expect(await page.evaluate(() => window.desktopBridge!.query("select 1 as n"))).toMatchObject({
    ok: true,
  });
});

test("switches connections only on success and expires the old result", async () => {
  const result = await page.evaluate(async () => {
    const db = window.desktopBridge!;
    const before = await db.query("select 1 as n");
    const connection = await db.connect(await db.connection());
    const old = before.ok ? await db.rows(before.resultId, 0, 200) : before;
    return { connection, old };
  });
  expect(result.connection).toMatchObject({ ok: true, database: "pagila" });
  expect(result.old).toMatchObject({ ok: false, error: { kind: "client" } });
});

test("lines the toolbar up with the traffic lights", async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(900, 560));
  // On macOS, the band Electron reports around the traffic lights
  // (titleBarOverlay). Elsewhere, as in CI, the CSS falls back to a plain bar.
  const band = process.platform === "darwin" ? { x: 98, height: 52 } : { x: 12, height: 52 };
  const toggle = page.getByRole("button", { name: /the sidebar/ });
  for (const open of [true, false]) {
    const box = (await toggle.boundingBox())!;
    // The icon starts at the band's edge; the button has 8px of padding.
    expect(box.x + 8).toBe(band.x);
    expect(box.y + box.height / 2).toBe(band.height / 2);
    expect(await page.locator(".toolbar").boundingBox()).toMatchObject({ y: 0, height: 52 });
    if (open) await toggle.click();
  }
  await expect(page.locator(".sidebar")).toBeHidden();
  await toggle.click();
});

test("fills uncovered window with the main column's color in both themes", async () => {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await app.evaluate(({ nativeTheme }, value) => {
      nativeTheme.themeSource = value;
    }, theme);
    const surface = await page.evaluate(
      () => getComputedStyle(document.querySelector(".main")!).backgroundColor,
    );
    const window = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getBackgroundColor(),
    );
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(window.slice(i, i + 2), 16));
    expect(surface).toBe(`rgb(${r}, ${g}, ${b})`);
  }
  await app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = "system";
  });
});

test("rejects invalid IPC arguments and cross-file navigation", async () => {
  const invalid = await page.evaluate(async () => {
    try {
      await window.desktopBridge!.rows(1, -1, 1000000);
      return false;
    } catch {
      return true;
    }
  });
  expect(invalid).toBe(true);
  const before = page.url();
  await page.evaluate(() => {
    window.location.href = "file:///etc/hosts";
  });
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getURL()),
    )
    .toBe(before);
});
