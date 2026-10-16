// The shape of `window.desktopBridge`, shared by the preload (which builds it)
// and the web app (which calls it). Types only: nothing here runs on either side.
export interface DesktopBridge {
  versions: { electron: string; chrome: string; node: string };
  ping(): Promise<PingResult>;
  // The connection string in use, and a switch to another one. `connect`
  // only switches if Postgres answers there, and then remembers it.
  connection(): Promise<string>;
  connect(url: string): Promise<PingResult>;
  // The tables in the database, for the sidebar.
  tables(): Promise<TablesResult>;
  query(sql: string): Promise<QueryResult>;
  // Rows of the last query's result, a page at a time.
  rows(resultId: number, offset: number, count: number): Promise<RowsResult>;
  // Runs the statement under EXPLAIN ANALYZE, so it really executes, in a
  // transaction that is always rolled back.
  explain(sql: string): Promise<ExplainResult>;
  // Stops the running query, if any. Its `query` call then resolves as canceled.
  cancel(): Promise<void>;
}

export type PingResult =
  // `server` is host:port, from the connection string.
  | { ok: true; version: string; database: string; pid: number; server: string }
  | { ok: false; error: DbError };

// No rows yet: they stay in the main process, and the grid asks for each page
// with `rows`. `totalRows` is how many the query returned. `rowCount` is
// Postgres's own count: rows affected by INSERT/UPDATE/DELETE, for which
// `columns` is empty.
export type QueryResult =
  | {
      ok: true;
      resultId: number;
      command: string;
      rowCount: number;
      totalRows: number;
      columns: { name: string; type: string }[];
    }
  | { ok: false; error: DbError };

// Cells are already text (null stays null so the grid can show NULL).
export type RowsResult = { ok: true; rows: (string | null)[][] } | { ok: false; error: DbError };

// `kind` is pg_class.relkind: r table, p partitioned table, v view, m
// materialized view. `estimate` is pg_class.reltuples, -1 if never analyzed.
export interface Table {
  schema: string;
  name: string;
  kind: string;
  estimate: number;
}

export type TablesResult = { ok: true; tables: Table[] } | { ok: false; error: DbError };

export type ExplainResult = { ok: true; plan: Explain } | { ok: false; error: DbError };

// What `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` returns, keeping Postgres's own
// key names so they match the docs. Only the keys the app reads are listed;
// Postgres sends many more, depending on the node type.
export interface Explain {
  Plan: PlanNode;
  "Planning Time": number;
  // Only writes fire triggers. Foreign key checks are triggers too, with the
  // constraint's name.
  Triggers: {
    "Trigger Name": string;
    "Constraint Name"?: string;
    Relation?: string;
    Time: number;
    Calls: number;
  }[];
  "Execution Time": number;
}

export interface PlanNode {
  "Node Type": string;
  // How this node feeds its parent: Outer, Inner, Member, InitPlan, SubPlan.
  "Parent Relationship"?: string;
  // "InitPlan 1", "SubPlan 1", "CTE x": printed above the node, like psql does.
  "Subplan Name"?: string;
  "Parallel Aware": boolean;
  "Join Type"?: string;
  Strategy?: string;
  "Partial Mode"?: string;
  "Scan Direction"?: string;
  "Relation Name"?: string;
  "CTE Name"?: string;
  "Function Name"?: string;
  Alias?: string;
  "Index Name"?: string;
  "Startup Cost": number;
  "Total Cost": number;
  "Plan Rows": number;
  "Plan Width": number;
  "Actual Startup Time": number;
  "Actual Total Time": number;
  // Per loop, and fractional since Postgres 18 (an average over the loops).
  "Actual Rows": number;
  // 0 means the node never ran.
  "Actual Loops": number;
  Plans?: PlanNode[];
  [detail: string]: unknown;
}

export type DbError =
  // Reported by the Postgres server, also while connecting (28P01: wrong
  // password). `code` is the SQLSTATE; `position` is the 1-based character
  // (not byte, not UTF-16 unit) in the SQL where it happened.
  | {
      kind: "postgres";
      code: string;
      message: string;
      detail?: string;
      hint?: string;
      position?: number;
    }
  | { kind: "canceled" }
  | { kind: "timeout"; seconds: number }
  // Everything else: no server answering, or a result this app cannot show.
  | { kind: "client"; message: string };
