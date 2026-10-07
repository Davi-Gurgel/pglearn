import { PgClient, type PgConnection } from "@effect/sql-pg";
import { Config, Effect, ManagedRuntime, Redacted } from "effect";
import type { PingResult, QueryResult } from "../contracts/ipc";

// The local database from compose.yaml. Set DATABASE_URL to use another one.
const defaultUrl = "postgres://postgres:postgres@localhost:5432/pagila";

// One connection pool for the whole app. Connections open lazily on the first
// query, so building the runtime does not fail when Postgres is down; each query
// reports its own error instead. `application_name` is how this app shows up in
// `pg_stat_activity`.
const runtime = ManagedRuntime.make(
  PgClient.layerConfig({
    url: Config.Redacted("DATABASE_URL").pipe(Config.withDefault(Redacted.make(defaultUrl))),
    applicationName: Config.succeed("pglearn"),
  }),
);

const ping = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const [row] = yield* sql<{ version: string; database: string; pid: number }>`
    select version(), current_database() as database, pg_backend_pid() as pid
  `;
  return row!;
});

// The grid shows at most this many rows. The driver still reads the whole
// result: sql-pg always sends Execute with no row limit, so there is no way to
// stop the server early without rewriting the user's SQL (which could change
// its plan). Revisit if a real query makes the main process run out of memory.
const shownRows = 200;

// A result column only carries a type OID (23, 1184, ...). Postgres itself knows
// the names: they live in the pg_type catalog.
const typeNames = Effect.fnUntraced(function* (fields: ReadonlyArray<PgConnection.Field>) {
  const oids = [...new Set(fields.map((field) => field.dataTypeId))];
  if (oids.length === 0) return new Map<number, string>();
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql<{ oid: number; typname: string }>`
    select oid::int4 as oid, typname from pg_type where oid = any(${oids}::oid[])
  `;
  return new Map(rows.map((row) => [row.oid, row.typname]));
});

// sql-pg decodes values into JS types (Date, bigint, arrays, objects). The
// renderer only gets text, so it never has to know about column types.
function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? String(v) : v));
  }
  return String(value);
}

const runSql = Effect.fn("runSql")(function* (text: string) {
  const sql = yield* PgClient.PgClient;
  // `.raw` is typed `unknown`; for sql-pg it is the driver's whole result.
  const result = (yield* sql.unsafe(text).raw) as PgConnection.Result;

  // sql-pg builds each row as an object keyed by column name, so a repeated name
  // would silently keep only the last value. Refuse instead of showing wrong data.
  const names = result.fields.map((field) => field.name);
  const repeated = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];
  if (repeated.length > 0) {
    return {
      ok: false as const,
      message: `Repeated column names (${repeated.join(", ")}). Rename them with AS.`,
    };
  }

  const types = yield* typeNames(result.fields);
  return {
    ok: true as const,
    command: result.command,
    rowCount: result.rowCount,
    // Exact, because every row was read.
    totalRows: result.rows.length,
    columns: result.fields.map((field) => ({
      name: field.name,
      type: types.get(field.dataTypeId) ?? String(field.dataTypeId),
    })),
    rows: result.rows
      .slice(0, shownRows)
      .map((row) => result.fields.map((field) => toText(row[field.name]))),
  };
});

export function queryDatabase(text: string): Promise<QueryResult> {
  return runtime.runPromise(
    runSql(text).pipe(
      Effect.catch((error) => Effect.succeed({ ok: false as const, message: describe(error) })),
    ),
  );
}

// IPC can only carry plain data, so errors become a value instead of a rejection.
export function pingDatabase(): Promise<PingResult> {
  return runtime.runPromise(
    ping.pipe(
      Effect.map((row) => ({ ok: true as const, ...row })),
      Effect.catch((error) => Effect.succeed({ ok: false as const, message: describe(error) })),
    ),
  );
}

// A SqlError's own message is generic ("Failed to connect"). Its cause says what
// actually happened: Postgres's words ("password authentication failed for user
// ...") or a Node socket code (ECONNREFUSED: nothing listening on that port).
function describe(error: { message: string; reason?: { cause?: unknown } }): string {
  const cause = error.reason?.cause as (Error & { code?: string }) | undefined;
  return cause?.message || cause?.code || error.message;
}

export function closeDatabase(): Promise<void> {
  return runtime.dispose();
}
