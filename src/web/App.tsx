import { useState } from "react";
import type { PingResult } from "../contracts/ipc";

export function App() {
  const bridge = window.desktopBridge;
  const [ping, setPing] = useState<PingResult | "pending" | null>(null);

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
    </main>
  );
}
