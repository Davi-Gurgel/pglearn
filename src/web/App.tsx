import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  DbError,
  DesktopBridge,
  ExplainResult,
  PingResult,
  QueryResult,
  RowsResult,
} from "../contracts/ipc";
import { ConnectionSheet } from "./ConnectionSheet";
import { examples } from "./examples";
import { MoonIcon, PageIcon, PlanIcon, PlayIcon, SidebarIcon, StopIcon, SunIcon } from "./icons";
import { PlanView } from "./PlanView";
import { Sidebar } from "./Sidebar";
import { sqlstateClass, sqlstateDocs } from "./sqlstate";

// What the last Run or Explain returned, with the SQL that produced it. `id`
// tells two results apart, so a new plan starts with nothing selected. `ms` is
// the round trip as the app saw it: the query plus fetching the rows.
type Outcome =
  | { id: number; sql: string; ms: number; kind: "query"; result: QueryResult }
  | { id: number; sql: string; ms: number; kind: "explain"; result: ExplainResult };

type Action = "query" | "explain";

const isMac = navigator.platform.startsWith("Mac");
const mod = isMac ? "⌘" : "Ctrl+";

// Whether the page is dark: macOS's appearance, or the one picked in the app
// (the main process sets it, and the page sees it as prefers-color-scheme).
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const onDarkChange = (change: () => void) => {
  darkQuery.addEventListener("change", change);
  return () => darkQuery.removeEventListener("change", change);
};

export function App() {
  const bridge = window.desktopBridge;
  // Starts pending: the app checks the connection as soon as it opens.
  const [ping, setPing] = useState<PingResult | "pending" | null>(bridge ? "pending" : null);
  const [sql, setSql] = useState(examples[0]!.sql);
  // The SQL is kept with its result: an error position points into the text
  // that ran, which may no longer be what the editor shows.
  const [result, setResult] = useState<Outcome | null>(null);
  const [pending, setPending] = useState<{ action: Action; since: number } | null>(null);
  const [canceling, setCanceling] = useState(false);
  const nextId = useRef(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editorHeight, setEditorHeight] = useState(180);
  const dark = useSyncExternalStore(onDarkChange, () => darkQuery.matches);

  const checkConnection = useCallback(() => {
    void bridge
      ?.ping()
      .catch((error: unknown): PingResult => ({ ok: false, error: unexpected(error) }))
      .then(setPing);
  }, [bridge]);
  const connect = () => {
    setPing("pending");
    checkConnection();
  };
  // Connect on open, so the sidebar says right away whether Postgres is there.
  useEffect(checkConnection, [checkConnection]);

  const start = (action: Action, text = sql) => {
    if (!bridge || pending || sheetOpen || text.trim() === "") return;
    const since = performance.now();
    setPending({ action, since });
    setCanceling(false);
    const id = ++nextId.current;
    const done = (outcome: Outcome) => {
      if (id !== nextId.current) return;
      setResult(outcome);
      setPending(null);
      // A query that worked proves the connection is back; refresh the sidebar.
      if (outcome.result.ok && ping !== "pending" && !ping?.ok) connect();
    };
    if (action === "query") {
      void bridge
        .query(text)
        .catch((error: unknown): QueryResult => ({ ok: false, error: unexpected(error) }))
        .then((result) =>
          done({ id, sql: text, ms: performance.now() - since, kind: "query", result }),
        );
    } else {
      void bridge
        .explain(text)
        .catch((error: unknown): ExplainResult => ({ ok: false, error: unexpected(error) }))
        .then((result) =>
          done({ id, sql: text, ms: performance.now() - since, kind: "explain", result }),
        );
    }
  };
  const stop = () => {
    if (!pending || canceling) return;
    setCanceling(true);
    void bridge?.cancel();
  };

  // The shortcuts work wherever the focus is, not only in the editor. ⌘. is
  // the Mac's own "stop" (it cancels a build in Xcode, a dialog anywhere).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || sheetOpen) return;
      if (event.key === "Enter") {
        event.preventDefault();
        start(event.shiftKey ? "explain" : "query");
      } else if (event.key === ".") {
        event.preventDefault();
        stop();
      } else if (event.key === "s" && event.ctrlKey && event.metaKey) {
        // ⌃⌘S: Finder's and Mail's shortcut for the sidebar.
        event.preventDefault();
        setSidebarOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const idle = bridge !== undefined && pending === null;
  return (
    <div className={sidebarOpen ? "app" : "app sidebar-closed"}>
      {/* Keep the catalog and its selection when the sidebar is hidden. */}
      <Sidebar
        bridge={bridge}
        ping={ping}
        sql={sql}
        onConnection={() => {
          if (!pending) setSheetOpen(true);
        }}
        onPick={(text, run) => {
          setSql(text);
          if (run) start("query", text);
        }}
      />

      <main className="main">
        <header className="toolbar">
          <Title available={bridge !== undefined} ping={ping} />
          <div className="toolbar-group">
            {bridge && (
              <button
                className="tool"
                onClick={() => void bridge.setTheme(dark ? "light" : "dark")}
                title={`Switch to the ${dark ? "light" : "dark"} appearance`}
                aria-label={dark ? "Light appearance" : "Dark appearance"}
              >
                {dark ? <SunIcon /> : <MoonIcon />}
              </button>
            )}
            <button
              className="tool"
              disabled={pending === null || canceling}
              onClick={stop}
              title={`Stop the running query (${mod}.)`}
              aria-label="Stop"
            >
              <StopIcon />
            </button>
            <button
              className="tool run"
              disabled={!idle}
              onClick={() => start("query")}
              title={`Run the SQL and show the rows it returns (${mod}↵)`}
            >
              <PlayIcon />
              Run
            </button>
            <button
              className="tool explain"
              disabled={!idle}
              onClick={() => start("explain")}
              title={`Run the SQL under EXPLAIN ANALYZE, then roll back, and draw the plan (⇧${mod}↵)`}
            >
              <PlanIcon />
              Explain
            </button>
          </div>
        </header>

        <section className="editor" style={{ height: editorHeight }}>
          <Editor sql={sql} onChange={setSql} />
        </section>
        <Splitter height={editorHeight} onResize={setEditorHeight} />

        <section className="output">
          {pending ? (
            <Running action={pending.action} since={pending.since} canceling={canceling} />
          ) : result === null ? (
            <Welcome
              available={Boolean(bridge)}
              ping={ping}
              onRetry={connect}
              onConnection={() => {
                if (!pending) setSheetOpen(true);
              }}
            />
          ) : !result.result.ok ? (
            <ErrorReport error={result.result.error} sql={result.sql} />
          ) : result.kind === "query" ? (
            <Results key={result.id} bridge={bridge!} result={result.result} ms={result.ms} />
          ) : (
            <PlanView key={result.id} explain={result.result.plan} />
          )}
        </section>
      </main>

      {/* Right of the traffic lights, where Xcode keeps it. */}
      <button
        className="icon-button sidebar-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        title={`${sidebarOpen ? "Hide" : "Show"} the sidebar (⌃⌘S)`}
      >
        <SidebarIcon />
      </button>

      {sheetOpen && bridge && (
        <ConnectionSheet
          bridge={bridge}
          onClose={() => setSheetOpen(false)}
          onConnected={(connected) => {
            setSheetOpen(false);
            setPing(connected);
            // Results from the previous database no longer apply.
            nextId.current++;
            setPending(null);
            setResult(null);
          }}
        />
      )}
    </div>
  );
}

// The window's title, in the toolbar like Mail's: the database, and under it
// which server it is.
function Title({ available, ping }: { available: boolean; ping: PingResult | "pending" | null }) {
  const [title, subtitle] = !available
    ? ["pglearn", "No database in a browser"]
    : ping === null || ping === "pending"
      ? ["pglearn", "Connecting…"]
      : !ping.ok
        ? ["pglearn", "Not connected"]
        : [
            ping.database,
            `${/^PostgreSQL \S+/.exec(ping.version)?.[0] ?? "PostgreSQL"} on ${ping.server}`,
          ];
  return (
    <div className="title">
      <div className="title-main">{title}</div>
      <div className="title-sub">{subtitle}</div>
    </div>
  );
}

// A plain textarea with line numbers beside it, like DBeaver's editor. Lines
// do not wrap, so each number stays next to its line; Postgres's error
// positions ("LINE 3") can be read off the gutter.
function Editor({ sql, onChange }: { sql: string; onChange: (sql: string) => void }) {
  const gutter = useRef<HTMLPreElement>(null);
  const lines = sql.split("\n").length;
  return (
    <div className="code">
      <pre className="gutter" ref={gutter} aria-hidden>
        {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
      </pre>
      <textarea
        aria-label="SQL"
        value={sql}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
        }}
        onKeyDown={(event) => {
          // Tab indents, as in any code editor. insertText, unlike setting the
          // value, keeps ⌘Z working.
          if (event.key === "Tab" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            document.execCommand("insertText", false, "  ");
          }
        }}
        wrap="off"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
    </div>
  );
}

// The bar between the editor and the output; drag it to give either more room.
function Splitter({ height, onResize }: { height: number; onResize: (height: number) => void }) {
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="horizontal"
      onPointerDown={(event) => {
        const handle = event.currentTarget;
        const from = event.clientY - height;
        handle.setPointerCapture(event.pointerId);
        const move = (moved: PointerEvent) =>
          onResize(Math.min(Math.max(moved.clientY - from, 60), window.innerHeight - 200));
        handle.addEventListener("pointermove", move);
        handle.addEventListener(
          "pointerup",
          () => handle.removeEventListener("pointermove", move),
          { once: true },
        );
      }}
    />
  );
}

function Welcome({
  available,
  ping,
  onRetry,
  onConnection,
}: {
  available: boolean;
  ping: PingResult | "pending" | null;
  onRetry: () => void;
  onConnection: () => void;
}) {
  if (ping !== null && ping !== "pending" && !ping.ok) {
    return (
      <div className="welcome">
        <h2>Postgres is not answering</h2>
        <p>
          Start the server and try again, or connect to another database. The sample Pagila database
          in this repository starts with <code>docker compose up -d</code>.
        </p>
        <div className="welcome-buttons">
          <button onClick={onRetry}>Try again</button>
          <button className="default" onClick={onConnection}>
            Connect to a database…
          </button>
        </div>
        <ErrorReport error={ping.error} sql="" />
      </div>
    );
  }
  return (
    <div className="welcome">
      <h2>Ask Postgres how it runs a query</h2>
      <div className="welcome-steps">
        <div>
          <span>
            <strong>Run</strong>
            <kbd>{mod}↵</kbd>
          </span>
          <p>executes the SQL and shows the rows it returns, like any client.</p>
        </div>
        <div>
          <span>
            <strong>Explain</strong>
            <kbd>⇧{mod}↵</kbd>
          </span>
          <p>
            executes it under <code>EXPLAIN ANALYZE</code> and draws the plan Postgres chose: which
            tables it read, how it joined them, and how many rows it expected at each step compared
            to how many it really got. Writes are rolled back.
          </p>
        </div>
      </div>
      {!available && (
        <p className="muted">
          This page has no access to Postgres. Run <code>pnpm dev</code> and use the Electron
          window.
        </p>
      )}
    </div>
  );
}

function Running({
  action,
  since,
  canceling,
}: {
  action: Action;
  since: number;
  canceling: boolean;
}) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="running">
      <span className="spinner" aria-hidden />
      <div>
        <div>
          {canceling ? "Stopping" : action === "query" ? "Running" : "Explaining"}{" "}
          <span className="tabular">{((now - since) / 1000).toFixed(1)} s</span>
        </div>
        <div className="muted">
          Press <kbd>{mod}.</kbd> to stop it. Queries also stop on their own after 30 s.
        </div>
      </div>
    </div>
  );
}

// Types whose values read best right-aligned, so digits line up.
const numericTypes = new Set([
  "int2",
  "int4",
  "int8",
  "numeric",
  "float4",
  "float8",
  "oid",
  "money",
]);

// Rows per page of the grid. More would make the page slow to draw; the rest of
// the result waits in the main process, a click away.
const pageSize = 200;

function Results({
  bridge,
  result,
  ms,
}: {
  bridge: DesktopBridge;
  result: Extract<QueryResult, { ok: true }>;
  ms: number;
}) {
  const [page, setPage] = useState(0);
  // The page on screen. While the next one loads, the last one stays up.
  const [loaded, setLoaded] = useState<{ page: number; rows: RowsResult } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const hasGrid = result.columns.length > 0;
  useEffect(() => {
    if (!hasGrid) return;
    let current = true;
    void bridge
      .rows(result.resultId, page * pageSize, pageSize)
      .catch((error: unknown): RowsResult => ({ ok: false, error: unexpected(error) }))
      .then((rows) => {
        if (current) setLoaded({ page, rows });
      });
    return () => {
      current = false;
    };
  }, [bridge, result.resultId, page, hasGrid]);

  // INSERT / UPDATE / DELETE without RETURNING: no columns, so no grid.
  if (!hasGrid) {
    return (
      <div className="results">
        <div className="summary-line">
          <code>
            {result.command} {result.rowCount}
          </code>
          <span>{rows(result.rowCount)} affected</span>
          <span className="summary-time">{duration(ms)}</span>
        </div>
        <p className="empty-rows">
          {result.command} returns no rows. Add <code>RETURNING *</code> to see the rows it changed.
        </p>
      </div>
    );
  }

  const numeric = result.columns.map((column) => numericTypes.has(column.type));
  const pages = Math.ceil(result.totalRows / pageSize);
  const from = (loaded?.page ?? 0) * pageSize;
  const shown = loaded?.rows.ok ? loaded.rows.rows : [];
  const goTo = (to: number) => {
    setPage(to);
    grid.current?.scrollTo({ top: 0 });
  };
  return (
    <div className="results">
      <div className="summary-line">
        <span>{rows(result.totalRows)}</span>
        {pages > 1 && (
          <div className="pager">
            <button
              className="icon-button"
              disabled={page === 0}
              onClick={() => goTo(0)}
              aria-label="First page"
            >
              <PageIcon to="first" />
            </button>
            <button
              className="icon-button"
              disabled={page === 0}
              onClick={() => goTo(page - 1)}
              aria-label="Previous page"
            >
              <PageIcon to="previous" />
            </button>
            <span className="tabular">
              {(page * pageSize + 1).toLocaleString("en-US")}–
              {Math.min((page + 1) * pageSize, result.totalRows).toLocaleString("en-US")}
            </span>
            <button
              className="icon-button"
              disabled={page === pages - 1}
              onClick={() => goTo(page + 1)}
              aria-label="Next page"
            >
              <PageIcon to="next" />
            </button>
            <button
              className="icon-button"
              disabled={page === pages - 1}
              onClick={() => goTo(pages - 1)}
              aria-label="Last page"
            >
              <PageIcon to="last" />
            </button>
          </div>
        )}
        <span className="summary-time">{duration(ms)}</span>
      </div>
      <div className="grid-wrap" ref={grid}>
        <table className="grid">
          <thead>
            <tr>
              <th className="row-number" aria-label="Row number" />
              {result.columns.map((column, c) => (
                <th key={c} className={numeric[c] ? "numeric" : undefined}>
                  <span className="column-name">{column.name}</span>
                  <span className="column-type">{column.type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, r) => (
              <tr key={from + r}>
                <td className="row-number">{from + r + 1}</td>
                {row.map((cell, c) => (
                  <td key={c} className={numeric[c] ? "numeric" : undefined} title={cell ?? "NULL"}>
                    {cell === null ? <span className="null">NULL</span> : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {result.totalRows === 0 && <p className="empty-rows">No rows matched.</p>}
        {loaded && !loaded.rows.ok && <ErrorReport error={loaded.rows.error} sql="" />}
      </div>
    </div>
  );
}

const rows = (n: number) => (n === 1 ? "1 row" : `${n.toLocaleString("en-US")} rows`);

const duration = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;

function unexpected(error: unknown): DbError {
  return { kind: "client", message: error instanceof Error ? error.message : String(error) };
}

// Laid out like psql prints errors, so what you see here matches the docs.
function ErrorReport({ error, sql }: { error: DbError; sql: string }) {
  if (error.kind === "canceled") {
    return (
      <div className="notice">
        <div>Stopped</div>
        <div className="muted">Postgres canceled the query before it finished.</div>
      </div>
    );
  }
  if (error.kind === "timeout") {
    return (
      <div className="notice">
        <div>Stopped after {error.seconds} s</div>
        <div className="muted">That is the app&apos;s time limit for one query.</div>
      </div>
    );
  }
  if (error.kind === "client") {
    return (
      <div className="error">
        <p>{error.message}</p>
      </div>
    );
  }

  const errorClass = sqlstateClass(error.code);
  return (
    <div className="error">
      <pre>
        {`ERROR: ${error.code}: ${error.message}`}
        {error.position !== undefined && `\n${pointAt(sql, error.position)}`}
        {error.detail && `\nDETAIL: ${error.detail}`}
        {error.hint && `\nHINT: ${error.hint}`}
      </pre>
      <p>
        <code>{error.code}</code> is a SQLSTATE, the code Postgres gives every error
        {errorClass && (
          <>
            . Its class <code>{error.code.slice(0, 2)}</code> means {errorClass}
          </>
        )}
        .{" "}
        <a href={sqlstateDocs} target="_blank" rel="noreferrer">
          All codes
        </a>
      </p>
    </div>
  );
}

// The line of `sql` holding `position`, with a caret under it. Postgres counts
// characters, which is what Array.from splits into (a string index would drift
// after an emoji, which takes two UTF-16 units).
function pointAt(sql: string, position: number): string {
  const chars = Array.from(sql);
  // "syntax error at end of input" points one past the last character.
  const at = Math.min(Math.max(position - 1, 0), chars.length);
  const before = chars.slice(0, at);
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineNumber = before.filter((char) => char === "\n").length + 1;
  const lineEnd = chars.indexOf("\n", at);
  const line = chars.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).join("");
  // Keep tabs so the caret lines up with tabbed SQL.
  const pad = before
    .slice(lineStart)
    .map((char) => (char === "\t" ? "\t" : " "))
    .join("");
  const label = `LINE ${lineNumber}: `;
  return `${label}${line}\n${" ".repeat(label.length)}${pad}^`;
}
