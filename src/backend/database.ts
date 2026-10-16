import { PgClient, type PgConnection } from "@effect/sql-pg";
import {
  Cause,
  Duration,
  Effect,
  Exit,
  ManagedRuntime,
  Option,
  Redacted,
  Schema,
  Semaphore,
} from "effect";
import { SqlError } from "effect/sql/SqlError";
import type {
  DbError,
  Explain,
  ExplainResult,
  PingResult,
  QueryResult,
  RowsResult,
  Table,
  TablesResult,
} from "../contracts/ipc";
import { toText } from "./query-cell";

// The local database from compose.yaml, used unless DATABASE_URL names another
// or the user connects somewhere else from the app.
const defaultUrl = "postgres://postgres:postgres@localhost:5432/pagila";

// One session for the whole app, like psql: a BEGIN or SET from one Run is
// still in effect on the next, and Explain can tell when a transaction is open.
// A pool of several connections would hand each query any of them, so a BEGIN
// would land on one and its COMMIT maybe on another. The pool still opens the
// connection lazily on the first query, so building the runtime does not fail
// when Postgres is down, and replaces it if it breaks (Postgres then rolls back
// whatever transaction it had). Without the infinite idle timeout it would
// close the session after a minute unused, and with it an open transaction.
// `application_name` is how this app shows up in `pg_stat_activity`.
function makeRuntime(url: string) {
  return ManagedRuntime.make(
    PgClient.layer({
      url: Redacted.make(url),
      applicationName: "pglearn",
      maxConnections: 1,
      idleTimeout: Duration.infinity,
    }),
  );
}

// The database every call goes to. Connecting elsewhere swaps it whole.
let current = (() => {
  const url = process.env["DATABASE_URL"] || defaultUrl;
  return { url, runtime: makeRuntime(url) };
})();

const ping = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const [row] = yield* sql<{ version: string; database: string; pid: number }>`
    select version(), current_database() as database, pg_backend_pid() as pid
  `;
  return row!;
});

// The last Run's rows stay here and the grid asks for them a page at a time
// (`pageRows`), the way pgAdmin keeps a result on its server. The driver reads
// the whole result anyway: sql-pg always sends Execute with no row limit, so
// there is no way to stop the server early without rewriting the user's SQL
// (which could change its plan) or holding the query open, and with it the
// app's only connection. Only the last result is kept; the next Run replaces
// it. Revisit if a real query makes the main process run out of memory.
let kept: { id: number; result: PgConnection.Result } | undefined;
let lastResultId = 0;

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

const runSql = Effect.fn("runSql")(function* (text: string) {
  const sql = yield* PgClient.PgClient;
  // `.raw` is typed `unknown`; for sql-pg it is the driver's whole result.
  const result = (yield* sql.unsafe(text).raw) as PgConnection.Result;

  // sql-pg builds each row as an object keyed by column name, so a repeated name
  // would silently keep only the last value. Refuse instead of showing wrong data.
  const names = result.fields.map((field) => field.name);
  const repeated = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];
  if (repeated.length > 0) {
    return failed({
      kind: "client",
      message: `Repeated column names (${repeated.join(", ")}). Rename them with AS.`,
    });
  }

  const types = yield* typeNames(result.fields);
  const id = ++lastResultId;
  kept = { id, result };
  return {
    ok: true as const,
    resultId: id,
    command: result.command,
    rowCount: result.rowCount,
    // Exact, because every row was read.
    totalRows: result.rows.length,
    columns: result.fields.map((field) => ({
      name: field.name,
      type: types.get(field.dataTypeId) ?? String(field.dataTypeId),
    })),
  };
});

// EXPLAIN ANALYZE runs the statement for real, so a DELETE deletes. It runs in
// a transaction that always rolls back, which undoes the rows it wrote, the
// triggers it fired and any table it created. Not undone: sequence values taken
// by nextval() (sequences never roll back, so concurrent inserts need not wait
// for each other), and the dead row versions left in the table until VACUUM.
// EXPLAIN only accepts a single SELECT, INSERT, UPDATE, DELETE, MERGE, VALUES,
// EXECUTE, DECLARE or CREATE TABLE AS, so the statement cannot COMMIT; nor can
// a function it calls (only procedures can, and EXPLAIN cannot CALL one).
const explainPrefix = "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ";

const explainSql = Effect.fn("explainSql")(function* (text: string) {
  if (/^\s*explain\b/i.test(text)) {
    return failed({
      kind: "client",
      message: "Remove EXPLAIN from the query: the Explain button adds it.",
    });
  }
  const sql = yield* PgClient.PgClient;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const conn = yield* sql.reserve;
      // A BEGIN the user ran earlier may have left the session inside a
      // transaction. Ours would join it, and its ROLLBACK would end theirs.
      // now() is when the current transaction started: outside a transaction
      // block each statement is its own transaction, so two calls differ.
      // Text keeps the microseconds a Date would drop.
      const transactionStart = conn
        .executeRaw("select now()::text as start", [])
        .pipe(Effect.map((result) => (result as PgConnection.Result).rows[0]?.["start"]));
      const first = yield* transactionStart;
      if (first === (yield* transactionStart)) {
        return failed({
          kind: "client",
          message:
            "A transaction you started with BEGIN is still open. Run COMMIT or ROLLBACK before Explain.",
        });
      }
      // Release runs on success, failure and cancel, after sql-pg has drained a
      // canceled query. A failed ROLLBACK is a bug, not a query error.
      // Plain `begin`, so a server or session set to read only stays read only.
      yield* Effect.acquireRelease(conn.executeRaw("begin", []), () =>
        Effect.orDie(conn.executeRaw("rollback", [])),
      );
      const result = (yield* conn.executeRaw(explainPrefix + text, [])) as PgConnection.Result;
      return toExplainResult(result);
    }),
  ).pipe(Effect.catch((error) => Effect.succeed(failed(explainError(toDbError(error))))));
});

function toExplainResult(result: PgConnection.Result): ExplainResult {
  // A json column arrives parsed: one row, holding a one-element array.
  const [plan] = (result.rows[0]?.["QUERY PLAN"] ?? []) as unknown[];
  if (typeof plan !== "object" || plan === null || !("Plan" in plan)) {
    return failed({ kind: "client", message: "Postgres returned no plan." });
  }
  return { ok: true, plan: plan as Explain };
}

// Errors point into the SQL that ran, which starts with our prefix. Shift the
// position back into the user's text, or drop it if it falls in the prefix.
function explainError(error: DbError): DbError {
  if (error.kind !== "postgres") return error;
  const position =
    error.position === undefined || error.position <= explainPrefix.length
      ? undefined
      : error.position - explainPrefix.length;
  return { ...error, position };
}

// The app gives up on a query after this long. Interrupting the fiber makes
// sql-pg ask Postgres to stop it, the same way the Cancel button does.
const timeoutSeconds = 30;

// Keep the permit until sql-pg finishes draining a canceled query, so a
// replacement cannot start while the old statement is still running.
const queryPermit = Semaphore.makeUnsafe(1);

// The editor runs one query at a time, so cancel needs no query id.
let running: AbortController | undefined;

export function queryDatabase(text: string): Promise<QueryResult> {
  return runCancelable(runSql(text));
}

export function explainDatabase(text: string): Promise<ExplainResult> {
  return runCancelable(explainSql(text));
}

async function runCancelable<A>(
  effect: Effect.Effect<A, SqlError | Error, PgClient.PgClient>,
): Promise<A | Failed> {
  // A query still running here belongs to a page that is gone (a reload).
  running?.abort();
  const controller = new AbortController();
  running = controller;

  const exit = await current.runtime.runPromiseExit(
    effect.pipe(
      Effect.timeoutOrElse({
        duration: `${timeoutSeconds} seconds`,
        orElse: () => Effect.succeed(failed({ kind: "timeout", seconds: timeoutSeconds })),
      }),
      Effect.catch((error) => Effect.succeed(failed(toDbError(error)))),
      queryPermit.withPermit,
    ),
    // Aborting interrupts the fiber. sql-pg then sends Postgres a CancelRequest
    // and waits for the server to confirm before the fiber finishes.
    { signal: controller.signal },
  );
  if (running === controller) running = undefined;

  if (Exit.isSuccess(exit)) return exit.value;
  // Interrupted means canceled, even if the cleanup after it also failed.
  if (Cause.hasInterrupts(exit.cause)) return failed({ kind: "canceled" });
  // A defect: a bug here, not a problem with the query.
  throw Cause.squash(exit.cause);
}

export function cancelQuery(): void {
  running?.abort();
}

// One page of the last Run's rows, as text. Converting a page at a time also
// means a value the grid cannot show fails only the page that holds it.
export function pageRows(resultId: number, offset: number, count: number): RowsResult {
  if (kept?.id !== resultId) {
    return failed({
      kind: "client",
      message: "A newer query replaced these rows. Run this one again to see them.",
    });
  }
  const { rows, fields } = kept.result;
  try {
    return {
      ok: true,
      rows: rows
        .slice(offset, offset + count)
        .map((row) => fields.map((field) => toText(row[field.name]))),
    };
  } catch (error) {
    return failed({
      kind: "client",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

// The tables of every user schema, read from Postgres's own catalog (the
// pg_catalog tables describe all the others). Partitions are left out: the
// partitioned table above them is the one queries name. reltuples is the row
// count the last ANALYZE estimated, the same number the planner starts from;
// -1 means the table was never analyzed. It waits for a running query instead
// of canceling it, and leaves the kept result alone.
const tablesSql = `select n.nspname as schema, c.relname as name, c.relkind as kind,
  c.reltuples::float8 as estimate
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p', 'v', 'm')
  and not c.relispartition
  and n.nspname <> 'information_schema'
  and n.nspname not like 'pg\\_%'
order by 1, 2`;

export function listTables(): Promise<TablesResult> {
  return current.runtime.runPromise(
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const tables = yield* sql.unsafe<Table>(tablesSql);
      return { ok: true as const, tables: [...tables] };
    }).pipe(
      Effect.catch((error) => Effect.succeed(failed(toDbError(error)))),
      queryPermit.withPermit,
    ),
  );
}

// IPC can only carry plain data, so errors become a value instead of a rejection.
export function pingDatabase(): Promise<PingResult> {
  return pingWith(current);
}

async function pingWith(target: typeof current): Promise<PingResult> {
  const server = serverOf(target.url);
  try {
    return await target.runtime.runPromise(
      ping.pipe(
        Effect.map((row) => ({ ok: true as const, ...row, server })),
        Effect.catch((error) => Effect.succeed(failed(toDbError(error)))),
      ),
    );
  } catch (error) {
    // A defect, such as a connection string sql-pg cannot parse.
    return failed({
      kind: "client",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

// "localhost:5432", to tell databases with the same name apart.
function serverOf(url: string): string {
  try {
    const { hostname, port } = new URL(url);
    return `${hostname || "localhost"}:${port || "5432"}`;
  } catch {
    return "";
  }
}

export function databaseUrl(): string {
  return current.url;
}

// Switches to `url` without checking it first: for the saved connection at
// startup, which should show as down if it is, not silently fall back.
export function useDatabase(url: string): void {
  void replace({ url, runtime: makeRuntime(url) });
}

// Switches to `url` only if Postgres answers there; otherwise the app stays on
// the database it had.
export async function connectDatabase(url: string): Promise<PingResult> {
  if (!/^postgres(ql)?:\/\//.test(url)) {
    return failed({
      kind: "client",
      message: "A connection string starts with postgres:// or postgresql://.",
    });
  }
  const candidate = { url, runtime: makeRuntime(url) };
  const result = await pingWith(candidate);
  if (result.ok) await replace(candidate);
  else await candidate.runtime.dispose();
  return result;
}

async function replace(next: typeof current): Promise<void> {
  const previous = current;
  current = next;
  kept = undefined;
  running?.abort();
  await previous.runtime.dispose();
}

type Failed = { ok: false; error: DbError };

function failed(error: DbError): Failed {
  return { ok: false, error };
}

// A SqlError's own message is generic ("PgConnection: Query failed"). Its cause
// says what actually happened: the fields of Postgres's error report, or a Node
// socket error (ECONNREFUSED: nothing listening on that port).
const decodeSqlErrorCause = Schema.decodeUnknownOption(
  Schema.Struct({
    message: Schema.optionalKey(Schema.String),
    code: Schema.optionalKey(Schema.String),
    severity: Schema.optionalKey(Schema.String),
    detail: Schema.optionalKey(Schema.String),
    hint: Schema.optionalKey(Schema.String),
    position: Schema.optionalKey(
      Schema.NumberFromString.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0))),
    ),
  }),
);

function toDbError(error: SqlError | Error): DbError {
  if (!(error instanceof SqlError)) return { kind: "client", message: error.message };
  const cause = Option.getOrUndefined(decodeSqlErrorCause(error.reason.cause));
  // Every Postgres report has a severity; Node errors have codes too, but not this.
  if (cause?.severity === undefined || cause.code === undefined || cause.message === undefined) {
    // ECONNREFUSED comes with an empty message: keep the driver's own words too.
    const message = cause?.message || [error.message, cause?.code].filter(Boolean).join(": ");
    const meaning = cause?.code === undefined ? undefined : socketErrors[cause.code];
    return { kind: "client", message: meaning ? `${meaning} (${message})` : message };
  }
  return {
    kind: "postgres",
    code: cause.code,
    message: cause.message,
    detail: cause.detail,
    hint: cause.hint ?? hintFor(cause.code, cause.message),
    position: cause.position,
  };
}

// What Node's socket errors mean when connecting, in plain words.
const socketErrors: Record<string, string> = {
  ECONNREFUSED:
    "Nothing is listening at that host and port. Is the server, or its container, running?",
  ENOTFOUND: "No host by that name was found.",
  ETIMEDOUT: "The host did not answer in time.",
  EHOSTUNREACH: "That host cannot be reached from this machine.",
};

// Hints for errors Postgres reports without one.
function hintFor(code: string, message: string): string | undefined {
  // sql-pg runs every query as a prepared statement (Postgres's extended
  // protocol), and a prepared statement holds exactly one command. Matching the
  // text assumes the server reports in English (its lc_messages setting).
  if (message.startsWith("cannot insert multiple commands into a prepared statement")) {
    return "pglearn runs one statement at a time. Remove the extra statements and run them separately.";
  }
  // After an error inside BEGIN ... COMMIT, Postgres refuses everything but the
  // end of the transaction, which undoes all of it (COMMIT too).
  if (code === "25P02") {
    return "A statement in the transaction you started with BEGIN failed. Run ROLLBACK to end the transaction; nothing it did is kept.";
  }
  return undefined;
}

export function closeDatabase(): Promise<void> {
  // dispose interrupts the runtime's fibers and waits for their cleanup before
  // releasing the pool, including queries waiting for the permit.
  return current.runtime.dispose();
}
