import { useCallback, useEffect, useRef, useState } from "react";
import type { DbError, ExplainResult, PingResult, QueryResult } from "../contracts/ipc";
import { examples } from "./examples";
import { PlanView } from "./PlanView";
import { sqlstateClass, sqlstateDocs } from "./sqlstate";

// What the last Run or Explain returned, with the SQL that produced it. `id`
// tells two results apart, so a new plan starts with nothing selected.
type Outcome =
  | { id: number; sql: string; kind: "query"; result: QueryResult }
  | { id: number; sql: string; kind: "explain"; result: ExplainResult };

type Action = "query" | "explain";

const isMac = navigator.platform.startsWith("Mac");
const mod = isMac ? "⌘" : "Ctrl+";

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
  // Connect on open, so the header says right away whether Postgres is there.
  useEffect(checkConnection, [checkConnection]);

  const start = (action: Action) => {
    if (!bridge || pending || sql.trim() === "") return;
    setPending({ action, since: performance.now() });
    setCanceling(false);
    const ran = sql;
    const id = ++nextId.current;
    const done = (outcome: Outcome) => {
      setResult(outcome);
      setPending(null);
      // A query that worked proves the connection is back; refresh the header.
      if (outcome.result.ok && ping !== "pending" && !ping?.ok) connect();
    };
    if (action === "query") {
      void bridge
        .query(ran)
        .catch((error: unknown): QueryResult => ({ ok: false, error: unexpected(error) }))
        .then((result) => done({ id, sql: ran, kind: "query", result }));
    } else {
      void bridge
        .explain(ran)
        .catch((error: unknown): ExplainResult => ({ ok: false, error: unexpected(error) }))
        .then((result) => done({ id, sql: ran, kind: "explain", result }));
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo />
          pglearn
        </div>
        <Connection available={Boolean(bridge)} ping={ping} onRetry={connect} />
      </header>

      <section className="editor">
        <textarea
          aria-label="SQL"
          value={sql}
          onChange={(event) => setSql(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              start(event.shiftKey ? "explain" : "query");
            }
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <div className="toolbar">
          <button
            className="primary"
            disabled={!bridge || pending !== null}
            onClick={() => start("query")}
            title="Run the SQL and show the rows it returns"
          >
            Run <kbd>{mod}↵</kbd>
          </button>
          <button
            className="explain"
            disabled={!bridge || pending !== null}
            onClick={() => start("explain")}
            title="Run the SQL under EXPLAIN ANALYZE, then roll back, and draw the plan"
          >
            Explain <kbd>⇧{mod}↵</kbd>
          </button>
          <select
            aria-label="Load an example query"
            value=""
            onChange={(event) => {
              const example = examples[Number(event.target.value)];
              if (example) setSql(example.sql);
            }}
          >
            <option value="" disabled>
              Load an example…
            </option>
            {examples.map((example, i) => (
              <option key={example.title} value={i}>
                {example.title}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="output">
        {pending ? (
          <Running
            action={pending.action}
            since={pending.since}
            canceling={canceling}
            onCancel={() => {
              setCanceling(true);
              void bridge?.cancel();
            }}
          />
        ) : result === null ? (
          <Welcome available={Boolean(bridge)} ping={ping} />
        ) : !result.result.ok ? (
          <ErrorReport error={result.result.error} sql={result.sql} />
        ) : result.kind === "query" ? (
          <Results result={result.result} />
        ) : (
          <PlanView key={result.id} explain={result.result.plan} />
        )}
      </section>
    </div>
  );
}

// Three nodes and two edges: a plan, which is what this app is about.
function Logo() {
  return (
    <svg className="logo" viewBox="0 0 20 20" aria-hidden>
      <path d="M10,6 L5,14 M10,6 L15,14" />
      <circle cx="10" cy="5" r="3" />
      <circle cx="5" cy="15" r="3" />
      <circle cx="15" cy="15" r="3" />
    </svg>
  );
}

function Connection({
  available,
  ping,
  onRetry,
}: {
  available: boolean;
  ping: PingResult | "pending" | null;
  onRetry: () => void;
}) {
  if (!available) {
    return (
      <span className="connection" data-state="off">
        <span className="dot" />
        No database in a plain browser: open the desktop app
      </span>
    );
  }
  if (ping === null || ping === "pending") {
    return (
      <span className="connection" data-state="pending">
        <span className="dot" />
        Connecting…
      </span>
    );
  }
  if (!ping.ok) {
    return (
      <button className="connection" data-state="error" onClick={onRetry} title="Try again">
        <span className="dot" />
        Not connected. Try again
      </button>
    );
  }
  // "PostgreSQL 18.0 (Debian 18.0-1.pgdg13+1) on aarch64-unknown-linux-gnu, ..."
  const short = /^PostgreSQL \S+/.exec(ping.version)?.[0] ?? ping.version;
  return (
    <button
      className="connection"
      data-state="ok"
      onClick={onRetry}
      title={`${ping.version}\nBackend process ${ping.pid}. Click to check again.`}
    >
      <span className="dot" />
      <span className="connection-db">{ping.database}</span>
      <span className="muted">{short}</span>
    </button>
  );
}

function Welcome({ available, ping }: { available: boolean; ping: PingResult | "pending" | null }) {
  if (ping !== null && ping !== "pending" && !ping.ok) {
    return (
      <div className="welcome">
        <h2>Postgres is not answering</h2>
        <p>
          The app connects to <code>DATABASE_URL</code>, or to the local Pagila database from{" "}
          <code>compose.yaml</code>. Start it with <code>docker compose up -d</code> and try again.
        </p>
        <ErrorReport error={ping.error} sql="" />
      </div>
    );
  }
  return (
    <div className="welcome">
      <h2>Ask Postgres how it runs a query</h2>
      <div className="welcome-steps">
        <div>
          <strong>Run</strong>
          <p>executes the SQL and shows the rows it returns, like any client.</p>
        </div>
        <div>
          <strong>Explain</strong>
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
  onCancel,
}: {
  action: Action;
  since: number;
  canceling: boolean;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="running">
      <span className="spinner" aria-hidden />
      <span>
        {action === "query" ? "Running" : "Explaining"}{" "}
        <span className="tabular">{((now - since) / 1000).toFixed(1)} s</span>
      </span>
      <button disabled={canceling} onClick={onCancel}>
        {canceling ? "Canceling…" : "Cancel"}
      </button>
      <span className="muted">The app stops any query after 30 s.</span>
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

function Results({ result }: { result: Extract<QueryResult, { ok: true }> }) {
  // INSERT / UPDATE / DELETE without RETURNING: no columns, so no grid.
  if (result.columns.length === 0) {
    return (
      <div className="summary-line">
        <code>
          {result.command} {result.rowCount}
        </code>
        <span className="muted">
          {result.rowCount === 1 ? "1 row" : `${result.rowCount.toLocaleString("en-US")} rows`}{" "}
          affected
        </span>
      </div>
    );
  }

  const numeric = result.columns.map((column) => numericTypes.has(column.type));
  return (
    <div className="results">
      <div className="summary-line">
        {result.rows.length < result.totalRows
          ? `Showing the first ${result.rows.length} of ${result.totalRows.toLocaleString("en-US")} rows`
          : result.totalRows === 1
            ? "1 row"
            : `${result.totalRows.toLocaleString("en-US")} rows`}
      </div>
      <div className="grid-wrap">
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
            {result.rows.map((row, r) => (
              <tr key={r}>
                <td className="row-number">{r + 1}</td>
                {row.map((cell, c) => (
                  <td key={c} className={numeric[c] ? "numeric" : undefined} title={cell ?? "NULL"}>
                    {cell === null ? <span className="null">NULL</span> : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {result.rows.length === 0 && <p className="empty-rows">No rows matched.</p>}
      </div>
    </div>
  );
}

function unexpected(error: unknown): DbError {
  return { kind: "client", message: error instanceof Error ? error.message : String(error) };
}

// Laid out like psql prints errors, so what you see here matches the docs.
function ErrorReport({ error, sql }: { error: DbError; sql: string }) {
  if (error.kind === "canceled") {
    return (
      <div className="notice">
        <strong>Canceled.</strong> Postgres stopped the query.
      </div>
    );
  }
  if (error.kind === "timeout") {
    return (
      <div className="notice">
        <strong>Canceled after {error.seconds} seconds</strong>, the app&apos;s time limit for one
        query.
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
