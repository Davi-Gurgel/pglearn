import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import type { DesktopBridge, PingResult, Table } from "../contracts/ipc";
import { examples } from "./examples";
import {
  ChevronIcon,
  DatabaseIcon,
  PartitionedIcon,
  SchemaIcon,
  ScriptIcon,
  TableIcon,
  ViewIcon,
} from "./icons";

const kinds: Record<string, { label: string; icon: ComponentType }> = {
  r: { label: "Table", icon: TableIcon },
  p: {
    label: "Partitioned table: its rows live in partitions, hidden here",
    icon: PartitionedIcon,
  },
  v: { label: "View: a saved query, run each time it is read", icon: ViewIcon },
  m: { label: "Materialized view: a saved query whose rows are stored", icon: ViewIcon },
};

type Ping = PingResult | "pending" | null;

// Like DBeaver's navigator, cut down to one connection: the database, its
// schemas and their tables, under the example queries (a short, fixed list
// first, so a long list of tables cannot push it out of sight). Clicking a
// table, or an example, puts a query for it in the editor; double-clicking a
// table also runs it. `children` go in the title bar, beside the traffic lights.
export function Sidebar({
  bridge,
  ping,
  sql,
  onConnection,
  onPick,
  children,
}: {
  bridge: DesktopBridge | undefined;
  ping: Ping;
  sql: string;
  onConnection: () => void;
  onPick: (sql: string, run?: boolean) => void;
  children: ReactNode;
}) {
  const connected = ping !== null && ping !== "pending" && ping.ok;
  const [tables, setTables] = useState<Table[] | string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  // The row last clicked, highlighted like a selection in Finder while the
  // editor still holds its query.
  const [picked, setPicked] = useState<string | null>(null);
  const pick = (key: string, text: string, run = false) => {
    setPicked(key);
    onPick(text, run);
  };
  const isCurrent = (key: string, text: string) => picked === key && sql === text;

  // Read on every successful ping: after connecting, to another database or
  // the same one again.
  useEffect(() => {
    if (!bridge || ping === null || ping === "pending" || !ping.ok) return;
    let active = true;
    void bridge.tables().then(
      (result) => {
        if (active) setTables(result.ok ? result.tables : "Could not read the tables.");
      },
      () => {
        if (active) setTables("Could not read the tables.");
      },
    );
    return () => {
      active = false;
    };
  }, [bridge, ping]);

  // While reconnecting, the last list stays up until the new one arrives.
  const shown = connected || ping === "pending" ? tables : null;
  const schemas = Array.isArray(shown) ? bySchema(shown) : null;
  const toggle = (schema: string) =>
    setClosed((before) => {
      const after = new Set(before);
      if (!after.delete(schema)) after.add(schema);
      return after;
    });

  return (
    <nav className="sidebar">
      <div className="titlebar">{children}</div>
      <div className="sidebar-scroll">
        <div className="section-title">Examples</div>
        {examples.map((example) => (
          <button
            key={example.title}
            className="tree-row"
            aria-current={isCurrent(example.title, example.sql)}
            onClick={() => pick(example.title, example.sql)}
            title={`${example.title}\n\n${example.sql}`}
          >
            <ScriptIcon />
            <span className="tree-label">{example.title}</span>
          </button>
        ))}

        <div className="section-title">Database</div>
        <Connection available={Boolean(bridge)} ping={ping} onClick={onConnection} />
        {typeof shown === "string" && <p className="sidebar-note">{shown}</p>}
        {schemas &&
          [...schemas].map(([schema, rows]) => {
            const open = !closed.has(schema);
            return (
              <div key={schema} role="group">
                <button className="tree-row" onClick={() => toggle(schema)}>
                  <ChevronIcon open={open} />
                  <SchemaIcon />
                  <span className="tree-label">{schema}</span>
                  <span className="tree-count">{rows.length}</span>
                </button>
                {open &&
                  rows.map((table) => {
                    const kind = kinds[table.kind] ?? kinds["r"]!;
                    const key = `${schema}.${table.name}`;
                    return (
                      <button
                        key={table.name}
                        className="tree-row nested"
                        aria-current={isCurrent(key, selectFrom(table))}
                        onClick={() => pick(key, selectFrom(table))}
                        onDoubleClick={() => pick(key, selectFrom(table), true)}
                        title={`${kind.label}. Click for a query on it, double-click to run that query.`}
                      >
                        <kind.icon />
                        <span className="tree-label">{table.name}</span>
                        {table.estimate >= 0 && (
                          <span
                            className="tree-count"
                            title="Rows, as estimated by the last ANALYZE (pg_class.reltuples). The planner starts from this number."
                          >
                            {compact(table.estimate)}
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
            );
          })}
      </div>
    </nav>
  );
}

function Connection({
  available,
  ping,
  onClick,
}: {
  available: boolean;
  ping: Ping;
  onClick: () => void;
}) {
  if (!available) {
    return <p className="sidebar-note">No database in a plain browser: open the desktop app.</p>;
  }
  if (ping === null || ping === "pending") {
    return (
      <div className="tree-row connection" data-state="pending">
        <DatabaseIcon />
        <span className="tree-label">Connecting…</span>
        <span className="dot" />
      </div>
    );
  }
  if (!ping.ok) {
    return (
      <button
        className="tree-row connection"
        data-state="error"
        onClick={onClick}
        title="Connect to a database"
      >
        <DatabaseIcon />
        <span className="tree-label">Not connected</span>
        <span className="dot" />
      </button>
    );
  }
  return (
    <button
      className="tree-row connection"
      data-state="ok"
      onClick={onClick}
      title={`${ping.version}\nBackend process ${ping.pid}. Click to connect to another database.`}
    >
      <DatabaseIcon />
      <span className="tree-label">{ping.database}</span>
      <span className="tree-count">{ping.server}</span>
      <span className="dot" />
    </button>
  );
}

function bySchema(tables: Table[]): Map<string, Table[]> {
  const schemas = new Map<string, Table[]>();
  for (const table of tables) {
    const rows = schemas.get(table.schema) ?? [];
    rows.push(table);
    schemas.set(table.schema, rows);
  }
  return schemas;
}

function selectFrom({ schema, name }: Table): string {
  // Quote and qualify every name: keywords and a custom search_path must work too.
  const table = `${ident(schema)}.${ident(name)}`;
  // No LIMIT: the grid already shows only the first rows, and a LIMIT would
  // add a node of its own to the plan when this query is explained.
  return `select *\nfrom ${table}`;
}

// Double quotes preserve the exact catalog name, including embedded quotes.
function ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

const compact = (n: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
