import { useEffect, useRef, useState } from "react";
import type { DbError, DesktopBridge, PingResult } from "../contracts/ipc";

interface Fields {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  // Whatever followed `?` in a pasted string (sslmode=require, ...), kept as is.
  options: string;
}

const empty: Fields = { host: "", port: "", database: "", user: "", password: "", options: "" };

// A connection string is a URL: postgres://user:password@host:port/database?options.
// The URL parser undoes the percent-encoding a password with @ or / needs.
function parse(url: string): Fields | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return null;
    return {
      host: decodeURIComponent(parsed.hostname),
      port: parsed.port,
      database: decodeURIComponent(parsed.pathname.slice(1)),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      options: parsed.search.slice(1),
    };
  } catch {
    return null;
  }
}

function format(fields: Fields): string {
  const auth = fields.user
    ? encodeURIComponent(fields.user) +
      (fields.password ? `:${encodeURIComponent(fields.password)}` : "") +
      "@"
    : "";
  const port = fields.port ? `:${fields.port}` : "";
  const options = fields.options ? `?${fields.options}` : "";
  return `postgres://${auth}${fields.host || "localhost"}${port}/${encodeURIComponent(fields.database)}${options}`;
}

// Like a macOS sheet: the connection's fields, as DBeaver asks for them, or a
// whole connection string pasted at once. Connecting checks that Postgres
// answers before the app switches to it.
export function ConnectionSheet({
  bridge,
  onConnected,
  onClose,
}: {
  bridge: DesktopBridge;
  onConnected: (ping: Extract<PingResult, { ok: true }>) => void;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<Fields>(empty);
  const [pasted, setPasted] = useState("");
  const [state, setState] = useState<"idle" | "connecting" | { error: DbError }>("idle");
  const first = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  // Starts from the connection in use.
  useEffect(() => {
    let active = true;
    dialog.current?.showModal();
    void bridge
      .connection()
      .then((url) => {
        if (active) setFields(parse(url) ?? empty);
      })
      .catch(() => {});
    first.current?.focus();
    return () => {
      active = false;
    };
  }, [bridge]);

  const set = (key: keyof Fields) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setFields({ ...fields, [key]: event.target.value });

  const connect = () => {
    if (state === "connecting") return;
    setState("connecting");
    void bridge
      .connect(format(fields))
      .catch((error: unknown): PingResult => ({
        ok: false,
        error: { kind: "client", message: error instanceof Error ? error.message : String(error) },
      }))
      .then((result) => (result.ok ? onConnected(result) : setState({ error: result.error })));
  };

  return (
    <dialog
      ref={dialog}
      className="sheet-backdrop"
      aria-labelledby="sheet-title"
      onCancel={(event) => {
        event.preventDefault();
        if (state !== "connecting") onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && state !== "connecting") onClose();
      }}
    >
      <form
        className="sheet"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          connect();
        }}
      >
        <h2 id="sheet-title">Connect to a database</h2>
        <p className="muted">
          Enter your database's connection details, or paste a PostgreSQL URL to fill in the fields.
          You can connect to a local or remote server.
        </p>

        <label className="field wide">
          <span>Connection string</span>
          <input
            ref={first}
            value={pasted}
            disabled={state === "connecting"}
            placeholder="postgres://user:password@host:5432/database"
            spellCheck={false}
            type="password"
            onChange={(event) => {
              setPasted(event.target.value);
              const parsed = parse(event.target.value);
              if (parsed) setFields(parsed);
            }}
          />
          <small className="muted">Paste one to fill in the fields below.</small>
        </label>

        <fieldset className="fields" disabled={state === "connecting"}>
          <label className="field host">
            <span>Host</span>
            <input
              value={fields.host}
              onChange={set("host")}
              placeholder="localhost"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Port</span>
            <input
              value={fields.port}
              onChange={set("port")}
              placeholder="5432"
              inputMode="numeric"
            />
          </label>
          <label className="field wide">
            <span>Database</span>
            <input value={fields.database} onChange={set("database")} spellCheck={false} />
          </label>
          <label className="field">
            <span>User</span>
            <input value={fields.user} onChange={set("user")} spellCheck={false} />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" value={fields.password} onChange={set("password")} />
          </label>
        </fieldset>

        {typeof state === "object" && (
          <p className="sheet-error">
            {state.error.kind === "postgres" || state.error.kind === "client"
              ? state.error.message
              : "Postgres did not answer."}
          </p>
        )}

        <div className="sheet-buttons">
          <small className="muted">
            Remembered for next time, encrypted with a key in your Keychain.
          </small>
          <button type="button" onClick={onClose} disabled={state === "connecting"}>
            Cancel
          </button>
          <button type="submit" className="default" disabled={state === "connecting"}>
            {state === "connecting" ? "Connecting…" : "Connect"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
