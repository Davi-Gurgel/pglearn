import { PgClient } from "@effect/sql-pg";
import { Config, Effect, ManagedRuntime, Redacted } from "effect";
import type { PingResult } from "../contracts/ipc";

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
