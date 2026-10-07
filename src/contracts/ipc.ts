// The shape of `window.desktopBridge`, shared by the preload (which builds it)
// and the web app (which calls it). Types only: nothing here runs on either side.
export interface DesktopBridge {
  versions: { electron: string; chrome: string; node: string };
  ping(): Promise<PingResult>;
  query(sql: string): Promise<QueryResult>;
  // Stops the running query, if any. Its `query` call then resolves as canceled.
  cancel(): Promise<void>;
}

export type PingResult =
  | { ok: true; version: string; database: string; pid: number }
  | { ok: false; error: DbError };

// Cells are already text (null stays null so the grid can show NULL). `rows` is
// capped; `totalRows` is how many the query returned. `rowCount` is Postgres's
// own count: rows affected by INSERT/UPDATE/DELETE, for which `columns` is empty.
export type QueryResult =
  | {
      ok: true;
      command: string;
      rowCount: number;
      totalRows: number;
      columns: { name: string; type: string }[];
      rows: (string | null)[][];
    }
  | { ok: false; error: DbError };

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
