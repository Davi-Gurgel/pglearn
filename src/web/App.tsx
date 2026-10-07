import { Fragment, useState } from "react";
import type {
  DbError,
  Explain,
  ExplainResult,
  PingResult,
  PlanNode,
  QueryResult,
} from "../contracts/ipc";
import { nodeDetails, nodeLabel, nodeNumbers } from "./plan";
import { sqlstateClass, sqlstateDocs } from "./sqlstate";

// What the last Run or Explain returned, with the SQL that produced it.
type Outcome =
  | { sql: string; kind: "query"; result: QueryResult }
  | { sql: string; kind: "explain"; result: ExplainResult };

export function App() {
  const bridge = window.desktopBridge;
  const [ping, setPing] = useState<PingResult | "pending" | null>(null);
  const [sql, setSql] = useState("select * from film limit 10");
  // The SQL is kept with its result: an error position points into the text
  // that ran, which may no longer be what the editor shows.
  const [result, setResult] = useState<Outcome | "pending" | null>(null);
  const [canceling, setCanceling] = useState(false);

  if (!bridge) {
    return (
      <main>
        <h1>pglearn</h1>
        <p>Running in a plain browser: no Electron preload.</p>
      </main>
    );
  }

  const { versions } = bridge;

  return (
    <main>
      <h1>pglearn</h1>
      <p>
        Electron {versions.electron} · Chromium {versions.chrome} · Node {versions.node}
      </p>
      <button
        disabled={ping === "pending"}
        onClick={() => {
          setPing("pending");
          void bridge
            .ping()
            .then(setPing)
            .catch((error: unknown) => {
              setPing({ ok: false, error: unexpected(error) });
            });
        }}
      >
        Ping database
      </button>
      {ping === "pending" && <p>Connecting…</p>}
      {ping !== null && ping !== "pending" && ping.ok && (
        <p>
          Connected to <code>{ping.database}</code> as backend process <code>{ping.pid}</code>
          <br />
          {ping.version}
        </p>
      )}
      {ping !== null && ping !== "pending" && !ping.ok && <ErrorReport error={ping.error} sql="" />}
      <h2>Query</h2>
      <textarea
        value={sql}
        onChange={(event) => setSql(event.target.value)}
        rows={8}
        spellCheck={false}
        style={{ width: "100%", fontFamily: "monospace" }}
      />
      <button
        disabled={result === "pending"}
        onClick={() => {
          setResult("pending");
          setCanceling(false);
          void bridge
            .query(sql)
            .catch((error: unknown): QueryResult => ({ ok: false, error: unexpected(error) }))
            .then((result) => setResult({ sql, kind: "query", result }));
        }}
      >
        Run
      </button>{" "}
      <button
        disabled={result === "pending"}
        onClick={() => {
          setResult("pending");
          setCanceling(false);
          void bridge
            .explain(sql)
            .catch((error: unknown): ExplainResult => ({ ok: false, error: unexpected(error) }))
            .then((result) => setResult({ sql, kind: "explain", result }));
        }}
      >
        Explain
      </button>
      {result === "pending" && (
        <p>
          Running…{" "}
          <button
            disabled={canceling}
            onClick={() => {
              setCanceling(true);
              void bridge.cancel();
            }}
          >
            {canceling ? "Canceling…" : "Cancel"}
          </button>
        </p>
      )}
      {result !== null && result !== "pending" && !result.result.ok && (
        <ErrorReport error={result.result.error} sql={result.sql} />
      )}
      {result !== null && result !== "pending" && result.kind === "query" && result.result.ok && (
        <Results result={result.result} />
      )}
      {result !== null && result !== "pending" && result.kind === "explain" && result.result.ok && (
        <Plan explain={result.result.plan} />
      )}
    </main>
  );
}

function Results({ result }: { result: Extract<QueryResult, { ok: true }> }) {
  // INSERT / UPDATE / DELETE without RETURNING: no columns, so no grid.
  if (result.columns.length === 0) {
    return (
      <p>
        {result.command} {result.rowCount}
      </p>
    );
  }

  return (
    <>
      <p>
        {result.rows.length < result.totalRows
          ? `Showing ${result.rows.length} of ${result.totalRows} rows`
          : `${result.totalRows} rows`}
      </p>
      <table>
        <thead>
          <tr>
            {result.columns.map((column) => (
              <th key={column.name}>
                {column.name} <small>{column.type}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c}>{cell ?? <em>NULL</em>}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// Indented like psql's text output: each child one level deeper, under "->".
function Plan({ explain }: { explain: Explain }) {
  return (
    <pre>
      <PlanTree node={explain.Plan} />
      {`Planning Time: ${explain["Planning Time"].toFixed(3)} ms\n`}
      {explain.Triggers.map(
        (trigger) =>
          `Trigger ${trigger["Trigger Name"]}: time=${trigger.Time.toFixed(3)} calls=${trigger.Calls}\n`,
      )}
      {`Execution Time: ${explain["Execution Time"].toFixed(3)} ms`}
    </pre>
  );
}

// One element per node, so a later milestone can make nodes clickable. `arrow`
// is the column of this node's "->" (the root has none); its detail lines and
// children line up two columns past the arrow's tip.
function PlanTree({ node, arrow }: { node: PlanNode; arrow?: number }) {
  const head = arrow === undefined ? "" : `${" ".repeat(arrow)}->  `;
  const inner = " ".repeat(head.length + 2);
  return (
    <>
      <span>
        {`${head}${nodeLabel(node)}  ${nodeNumbers(node)}\n`}
        {nodeDetails(node).map((line) => `${inner}${line}\n`)}
      </span>
      {node.Plans?.map((child, i) =>
        // InitPlans, SubPlans and CTEs get a name line, and sit under it.
        child["Subplan Name"] ? (
          <Fragment key={i}>
            {`${inner}${child["Subplan Name"]}\n`}
            <PlanTree node={child} arrow={inner.length + 2} />
          </Fragment>
        ) : (
          <PlanTree key={i} node={child} arrow={inner.length} />
        ),
      )}
    </>
  );
}

function unexpected(error: unknown): DbError {
  return { kind: "client", message: error instanceof Error ? error.message : String(error) };
}

// Laid out like psql prints errors, so what you see here matches the docs.
function ErrorReport({ error, sql }: { error: DbError; sql: string }) {
  if (error.kind === "canceled") return <p>Canceled.</p>;
  if (error.kind === "timeout") {
    return <p>Canceled after {error.seconds} seconds: the app's time limit for one query.</p>;
  }
  if (error.kind === "client") return <p>Error: {error.message}</p>;

  const errorClass = sqlstateClass(error.code);
  return (
    <div>
      <pre>
        {`ERROR: ${error.code}: ${error.message}`}
        {error.position !== undefined && `\n${pointAt(sql, error.position)}`}
        {error.detail && `\nDETAIL: ${error.detail}`}
        {error.hint && `\nHINT: ${error.hint}`}
      </pre>
      <p>
        <code>{error.code}</code> is a SQLSTATE
        {errorClass && (
          <>
            {" "}
            of class <code>{error.code.slice(0, 2)}</code>, {errorClass}
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
