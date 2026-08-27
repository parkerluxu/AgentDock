# AgentDock

AgentDock is a local-first control plane for registering, routing and isolating multiple AI Agent runtimes.

The current MVP provides local Runtime discovery, Claude Code/Codex execution, Policy resolution, Session/Run history, ordered event storage, diagnostics, a loopback HTTP API and local Adapter lifecycle management. Third-party Adapter installation is local-only and does not provide OS-level sandboxing.

## Development

```text
npm install
npm run typecheck
npm test
npm run build
```

Validate a configuration file:

```text
npm run config:validate -- .agentdock/config.json
```

List configured runtimes and check their installed versions:

```text
npm run build
node dist/cli.js runtime list --config examples/config.example.json
node dist/cli.js runtime health claude-code --config examples/config.example.json
node dist/cli.js runtime health codex --config examples/config.example.json
node dist/cli.js doctor --config examples/config.example.json
```

Manage local Adapter packages. Installation is disabled by default; an Adapter with manifest permissions must be enabled with explicit grants:

```text
node dist/cli.js adapter install ./path/to/adapter --config examples/config.example.json
node dist/cli.js adapter list --config examples/config.example.json
node dist/cli.js adapter enable example --grant filesystem.read --config examples/config.example.json
node dist/cli.js adapter disable example --config examples/config.example.json
node dist/cli.js adapter uninstall example --config examples/config.example.json
```

Preview a resolved execution without starting an Agent:

```text
node dist/cli.js run dry-run --config examples/config.example.json --project agentdock "inspect the repository"
```

`run execute` emits JSONL events and persists the Run, immutable execution snapshot, Session mapping and ordered events to local SQLite. It starts a real Agent and may consume model quota:

```text
node dist/cli.js run execute --config examples/config.example.json --profile claude-code-readonly "summarize the repository"
```

Inspect persisted execution data or create a reusable session:

```text
node dist/cli.js run list --config examples/config.example.json
node dist/cli.js run show --config examples/config.example.json <run-id>
node dist/cli.js run events --config examples/config.example.json <run-id>
node dist/cli.js run export --format jsonl --config examples/config.example.json <run-id>
node dist/cli.js session create --config examples/config.example.json --profile claude-code-readonly
node dist/cli.js session list --config examples/config.example.json
node dist/cli.js profile list --config examples/config.example.json
node dist/cli.js project show --config examples/config.example.json agentdock
```

Start the loopback-only local HTTP API for scripts or IDE integrations:

```text
node dist/cli.js api serve --config examples/config.example.json --port 4177
```

The API supports asynchronous Run submission, query, cancellation, resumable SSE events and deterministic Profile routing at `/api/v1`. It deliberately listens only on `127.0.0.1`/`::1`, requires a local Bearer token, persists idempotency keys in SQLite and applies request/Run concurrency limits; see the [API reference](docs/api-reference.zh-CN.md) for endpoint and security details.

AgentDock uses the built-in `node:sqlite` module. It requires Node.js 22.5 or newer; the module currently emits Node's experimental-feature warning.

`dataDir` is a directory, relative to the configuration file. AgentDock stores its SQLite database at `<dataDir>/agentdock.db` (or `.agentdock/data/agentdock.db` by default). Development builds that previously created a database directly at `dataDir` remain readable without moving or deleting data.

See [the requirements analysis](docs/requirements-analysis.zh-CN.md) and [the development plan](docs/development-plan.zh-CN.md) for scope and milestones.
Configuration details are in [the configuration reference](docs/configuration-reference.zh-CN.md); API and SDK upgrades are covered by the [migration guide](docs/migration-guide.zh-CN.md).
The deterministic [example Adapter](examples/adapter-echo/README.md) can be installed without model access.
The [local API client example](examples/api-client/README.md) submits a Run and consumes its SSE stream using only Node.js built-ins.
For continuing development in a new Codex session, start with the [session handoff](docs/next-session-handoff.zh-CN.md).
