# Contributing

## Workflow

1. Branch from `main`: `feat/table-viewer`, `fix/connection-timeout`, `docs/readme`.
2. Open a pull request into `main`. CI must pass.
3. Squash merge. The commit message is only the PR title plus its number, with an empty body (GitHub's default lists every commit in the branch):

   ```sh
   gh pr merge 1 --squash --subject "feat: add table viewer (#1)" --body ""
   ```

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add table viewer pagination
fix: handle connection timeout
docs: update roadmap
```

## Releases

Releases are tags on `main` following [Semantic Versioning](https://semver.org/). While the app is experimental, versions are `v0.x.y`.

```
git tag v0.1.0
git push origin v0.1.0
```

Pushing a tag will trigger the release workflow, which builds the installers and publishes them as a GitHub Release.

If a fix ever needs to land on an older release while `main` has moved on, create a `release/x.y` branch from the tag at that point. Don't create it ahead of time.
