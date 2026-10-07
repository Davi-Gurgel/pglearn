import { useState } from "react";
import type { PingResult, QueryResult } from "../contracts/ipc";

export function App() {
  const bridge = window.desktopBridge;
  const [ping, setPing] = useState<PingResult | "pending" | null>(null);
  const [sql, setSql] = useState("select * from film limit 10");
  const [result, setResult] = useState<QueryResult | "pending" | null>(null);

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
          void bridge.ping().then(setPing);
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
      {ping !== null && ping !== "pending" && !ping.ok && <p>Could not connect: {ping.message}</p>}

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
          void bridge.query(sql).then(setResult);
        }}
      >
        Run
      </button>
      {result === "pending" && <p>Running…</p>}
      {result !== null && result !== "pending" && !result.ok && <p>Error: {result.message}</p>}
      {result !== null && result !== "pending" && result.ok && <Results result={result} />}
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
