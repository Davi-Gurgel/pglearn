export function App() {
  const versions = window.desktopBridge?.versions;

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
