pglearn's first experimental macOS release: explore PostgreSQL execution plans with a graph, algorithm diagrams, hand-written explanations, and estimated versus actual rows.

- SQL editor, typed result grid, schema/table navigator, and encrypted storage for the last connection.
- Explain graph and text views, node inspector, buffer statistics, disk spill indicators, and parallel-plan context.
- Query cancellation, a 30-second timeout, light and dark appearance, and keyboard shortcuts.

### Installation

Requires macOS 13 or later and a separate PostgreSQL server. Download **arm64** for Apple Silicon or **x64** for Intel. Open the DMG and drag pglearn into Applications, or extract the ZIP.

These builds are **unsigned and not notarized**. macOS may block the first launch; see [Apple's instructions](https://support.apple.com/en-us/102445). SHA-256 checksums are attached.

### Before running queries

Run executes SQL normally. Explain executes SQL in a transaction and rolls it back. Sequence increments, dead row versions, and external effects of functions are not undone. Use a disposable database while learning. Results are held in memory; pagination does not limit how many rows PostgreSQL returns.

The examples and integration tests use PostgreSQL 18 with Pagila. See the [README](https://github.com/Davi-Gurgel/pglearn#try-it-with-pagila) for sample database setup and current limits.
