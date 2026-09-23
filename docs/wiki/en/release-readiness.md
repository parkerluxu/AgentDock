# Release readiness and recovery drills

Use the repository's [release-candidate checklist](https://github.com/parkerluxu/AgentDock/blob/main/docs/release-checklist.zh-CN.md) before declaring a stable release. It separates automated checks, recovery drills, real-Runtime evidence, platform conclusions, and migration/rollback so that passing tests are not presented as verification of every native Runtime.

## Automated baseline

Run the following from a clean working tree:

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run wiki:build
git diff --check
```

CI runs no-model-credit regression tests on Windows, Linux, and macOS. It covers fake/Echo Adapters, paths, SQLite, SSE, Environment file operations, and the DSH launcher; it does not replace a real Codex or Claude Code smoke test.

## Required manual evidence

1. Record an isolated-home, read-only non-interactive Run for Codex and Claude Code on every claimed platform, including Runtime/Adapter/Node versions and date.
2. Record session resume behavior (or its documented lack of support) and the directory categories changed after the Run.
3. Drill managed backup/restore and external restore with `confirmExternal: true`, confirming that historical Run snapshots stay unchanged.
4. If Linux/macOS verification is unfinished, label the candidate Windows-only preview; do not claim cross-platform verification.

See the [migration guide](https://github.com/parkerluxu/AgentDock/blob/main/docs/migration-guide.zh-CN.md) for rollback and [Environment management](./environments) for the recovery steps.
