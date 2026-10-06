// `window.api` only exists inside Electron (it comes from the preload script).
// Opening the Vite dev server in a plain browser leaves it undefined.
declare global {
  interface Window {
    api?: { versions: { electron: string; chrome: string; node: string } };
  }
}

export function App() {
  const versions = window.api?.versions;

  return (
    <main>
      <h1>pglearn</h1>
      {versions ? (
        <p>
          Electron {versions.electron} · Chromium {versions.chrome} · Node {versions.node}
        </p>
      ) : (
        <p>Running in a plain browser: no Electron preload.</p>
      )}
    </main>
  );
}
