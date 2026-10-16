# Contributing

pglearn is a small, experimental macOS app. Its focus is explaining PostgreSQL execution plans. For a larger feature, open an issue to discuss the problem and scope before implementing it.

## Development

Follow the setup in [README.md](README.md). Create a branch from `main`, keep the change focused, and open a pull request. Use Conventional Commit titles such as `fix: preserve session after cancellation`.

Before opening a PR, run:

```sh
pnpm typecheck
pnpm lint
pnpm format --check
pnpm test
pnpm test:e2e
```

The Electron tests need the Pagila sample database on `localhost:5432`, or a `DATABASE_URL` pointing to a disposable Pagila instance. They use temporary tables for write tests. They launch with an isolated app profile so they do not read or replace your saved connection. On Linux, use `xvfb-run -a pnpm test:e2e`.

For UI changes, inspect light and dark appearance and the 900×560 minimum window size. The renderer must also open without Electron at `http://localhost:5173`.

CI must pass before squash merging. Keep the squash commit body empty so it does not repeat every development commit:

```sh
gh pr merge NUMBER --squash --subject "fix: concise change description (#NUMBER)" --body ""
```

## Releases

The `Release` workflow is manually dispatched with a version tag, for example `v0.1.0`. It verifies that the tag matches `package.json`, runs checks, builds Apple Silicon and Intel DMG/ZIP files, and creates a **draft** GitHub Release with SHA-256 checksums. Dispatch it from a reviewed commit on `main`; the workflow refuses other branches.

Before publishing the draft:

1. Confirm CI passed for the exact release commit.
2. Download and mount the DMGs. Check the Applications shortcut and app icon.
3. Launch the packaged app on each architecture being claimed as tested. Connect, run SQL, explain a join, cancel a query, and inspect both appearances.
4. Verify the checksums, release notes, supported architectures, and any unsigned/notarized limitations.
5. Publish the reviewed draft. Changing repository visibility is a separate, explicit maintainer action.

`pnpm dist:mac` produces the same unsigned packages locally. To run the integration suite against a local package:

```sh
PGLEARN_EXECUTABLE="$PWD/release/mac-arm64/pglearn.app/Contents/MacOS/pglearn" pnpm exec playwright test
```

Apple Developer signing and notarization are not configured. Do not claim a release is signed or that an architecture was runtime-tested unless it actually was. No auto-updater is bundled; users download a new release manually.
