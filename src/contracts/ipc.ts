// The shape of `window.desktopBridge`, shared by the preload (which builds it)
// and the web app (which calls it). Types only: nothing here runs on either side.
export interface DesktopBridge {
  versions: { electron: string; chrome: string; node: string };
  ping(): Promise<PingResult>;
  query(sql: string): Promise<QueryResult>;
}

export type PingResult =
  | { ok: true; version: string; database: string; pid: number }
  | { ok: false; message: string };

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
  | { ok: false; message: string };
