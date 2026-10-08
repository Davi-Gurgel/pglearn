import { Fragment, useMemo, useState } from "react";
import type {
  DbError,
  Explain,
  ExplainResult,
  PingResult,
  PlanNode,
  QueryResult,
} from "../contracts/ipc";
import { explainDocs, nodeExplanation, nodeNotes, type Explanation } from "./explanations";
import { dividedAmongProcesses, nodeDetails, nodeLabel, nodeNumbers, rowsComparison } from "./plan";
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
// Click a node to see its estimated vs actual rows beside the tree.
function Plan({ explain }: { explain: Explain }) {
  const [selected, setSelected] = useState<PlanNode | null>(null);
  const divided = useMemo(() => dividedAmongProcesses(explain.Plan), [explain]);
  return (
    <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
      <pre style={{ flex: "1 1 0", minWidth: 0, overflowX: "auto" }}>
        <PlanTree node={explain.Plan} selected={selected} onSelect={setSelected} />
        {`Planning Time: ${explain["Planning Time"].toFixed(3)} ms\n`}
        {explain.Triggers.map(
          (trigger) =>
            `Trigger ${trigger["Trigger Name"]}: time=${trigger.Time.toFixed(3)} calls=${trigger.Calls}\n`,
        )}
        {`Execution Time: ${explain["Execution Time"].toFixed(3)} ms`}
      </pre>
      <aside style={{ flex: "0 0 24rem", position: "sticky", top: 0 }}>
        {selected ? (
          <NodeStats node={selected} divided={divided.has(selected)} />
        ) : (
          <p>Click a node to see what it does and compare its rows.</p>
        )}
      </aside>
    </div>
  );
}

// One element per node, so it can be clicked. `arrow` is the column of this
// node's "->" (the root has none); its detail lines and children line up two
// columns past the arrow's tip.
function PlanTree({
  node,
  arrow,
  selected,
  onSelect,
}: {
  node: PlanNode;
  arrow?: number;
  selected: PlanNode | null;
  onSelect: (node: PlanNode | null) => void;
}) {
  const head = arrow === undefined ? "" : `${" ".repeat(arrow)}->  `;
  const inner = " ".repeat(head.length + 2);
  const toggle = () => {
    // Dragging to copy some of the plan also ends in a click: keep the selection.
    if (window.getSelection()?.toString()) return;
    onSelect(selected === node ? null : node);
  };
  return (
    <>
      <span
        role="button"
        tabIndex={0}
        aria-pressed={selected === node}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(selected === node ? null : node);
          }
        }}
        style={{ cursor: "pointer", background: selected === node ? "#cde" : undefined }}
      >
        {`${head}${nodeLabel(node)}  ${nodeNumbers(node)}\n`}
        {nodeDetails(node).map((line) => `${inner}${line}\n`)}
      </span>
      {node.Plans?.map((child, i) =>
        // InitPlans, SubPlans and CTEs get a name line, and sit under it.
        child["Subplan Name"] ? (
          <Fragment key={i}>
            {`${inner}${child["Subplan Name"]}\n`}
            <PlanTree
              node={child}
              arrow={inner.length + 2}
              selected={selected}
              onSelect={onSelect}
            />
          </Fragment>
        ) : (
          <PlanTree
            key={i}
            node={child}
            arrow={inner.length}
            selected={selected}
            onSelect={onSelect}
          />
        ),
      )}
    </>
  );
}

const plural = (n: number, word: string) =>
  `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

function NodeStats({ node, divided }: { node: PlanNode; divided: boolean }) {
  const rows = rowsComparison(node, divided);
  const table = node["Relation Name"];
  return (
    <div>
      <h3>{nodeLabel(node)}</h3>
      <NodeExplanation node={node} />
      <h4>Estimated vs actual rows</h4>
      {!rows.executed ? (
        <p>
          Never executed: Postgres planned this node but the query finished without needing it (for
          example a Limit stopped early, or the other side of a join was empty). There is nothing to
          compare.
        </p>
      ) : (
        <>
          <table>
            <tbody>
              <tr>
                <th scope="row">Estimated</th>
                <td>{plural(rows.estimated, "row")} per loop</td>
              </tr>
              <tr>
                <th scope="row">Actual</th>
                <td>
                  {plural(Number(rows.actual.toFixed(2)), "row")} per loop ×{" "}
                  {plural(rows.loops, "loop")}
                  {rows.loops > 1 && ` ≈ ${plural(rows.total, "row")} in total`}
                </td>
              </tr>
            </tbody>
          </table>
          {rows.verdict === "close" && <p>The estimate was close (within 2×).</p>}
          {rows.verdict === "parallel" && (
            <p>
              Not comparable: Postgres splits a parallel node&apos;s estimate among the leader and
              its workers. Compare the Gather node above instead.
            </p>
          )}
          {rows.verdict === "bitmap" && (
            <p>
              Not comparable: this node builds a bitmap of table locations, not rows, so Postgres
              always reports 0 actual rows. Look at its child Bitmap Index Scans.
            </p>
          )}
          {(rows.verdict === "high" || rows.verdict === "low") && (
            <>
              <p>
                Postgres expected{" "}
                <strong>
                  {rows.factor < 10
                    ? rows.factor.toFixed(1)
                    : Math.round(rows.factor).toLocaleString("en-US")}
                  × {rows.verdict === "high" ? "more" : "fewer"}
                </strong>{" "}
                rows than it got.
              </p>
              {rows.verdict === "high" && (
                <p>
                  Not always a mistake: a node stops reading early when its parent needs no more
                  rows (Limit, EXISTS, Merge Join, an empty join side), but the estimate assumes it
                  reads everything.
                </p>
              )}
              {rows.factor >= 10 && (
                <p>
                  {rows.verdict === "high"
                    ? "If it did read everything, statistics may be stale or missing"
                    : "A gap this large often means stale or missing statistics"}
                  {table ? (
                    <>
                      : try running <code>ANALYZE</code> on <code>{table}</code> and explain again
                    </>
                  ) : (
                    ", or columns that are correlated"
                  )}
                  .
                </p>
              )}
            </>
          )}
        </>
      )}
      <p>
        Postgres picks plans from its estimates, which come from statistics that{" "}
        <code>ANALYZE</code> collects (autovacuum also runs it in the background).{" "}
        <a href={statsDocs} target="_blank" rel="noreferrer">
          Planner statistics
        </a>
      </p>
    </div>
  );
}

const statsDocs = "https://www.postgresql.org/docs/current/planner-stats.html";

function NodeExplanation({ node }: { node: PlanNode }) {
  const explanation = nodeExplanation(node);
  const notes = nodeNotes(node);
  return (
    <>
      {explanation ? (
        <Paragraph explanation={explanation} />
      ) : (
        <p>
          No explanation written for {node["Node Type"]} yet.{" "}
          <a href={explainDocs} target="_blank" rel="noreferrer">
            Using EXPLAIN
          </a>
        </p>
      )}
      {notes.map((note) => (
        <Paragraph key={note.text} explanation={note} />
      ))}
    </>
  );
}

// `backticks` in the text become <code>: the odd pieces of the split.
function Paragraph({ explanation }: { explanation: Explanation }) {
  return (
    <p>
      {explanation.text
        .split("`")
        .map((piece, i) => (i % 2 ? <code key={i}>{piece}</code> : piece))}{" "}
      <a href={explanation.docs} target="_blank" rel="noreferrer">
        Docs
      </a>
    </p>
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
