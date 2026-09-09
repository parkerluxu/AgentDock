# AgentDock

AgentDock is a local platform for managing multiple AI Agent Engines and their isolated configuration Environments.

The current MVP provides Engine discovery, managed/external Environment directories, Environment Permissions, Project bindings, immutable Run snapshots, diagnostics, a loopback HTTP API and local Adapter lifecycle management. Third-party Adapter installation is local-only and does not provide OS-level sandboxing.

## Development

```text
npm ci
npm run typecheck
npm test
npm run build
```

`npm run build` compiles `src/` into `dist/` and produces the runnable `dist/cli.js` entrypoint. For a complete walkthrough covering configuration, CLI workflows, local API deployment, Environment management, Adapter development, security boundaries and troubleshooting, see the [AgentDock project Wiki](docs/wiki/index.md).

### Build and local deployment

Use the following sequence after a fresh checkout or a TypeScript change:

```text
npm ci
npm run typecheck
npm test
npm run build
npm run config:validate -- examples/config.example.json
node dist/cli.js doctor --config examples/config.example.json
```

Start the loopback-only API from the build output:

```text
node dist/cli.js api serve --config examples/config.example.json --port 4177
```

Open `http://127.0.0.1:4177/` for the Control Center. The startup JSON prints the API base URL and, when no explicit token is supplied, the generated local `api-token` file path. To provide a stable token explicitly, use `--api-token <token>` or set `AGENTDOCK_API_TOKEN`. The API is intentionally restricted to `127.0.0.1`/`::1`; it is for same-machine integrations and is not a remote deployment endpoint. Use `--port 0` to let the operating system select an available port.

On PowerShell, an explicit token can be supplied with:

```powershell
$env:AGENTDOCK_API_TOKEN = "replace-with-a-long-local-token"
node dist/cli.js api serve --config examples/config.example.json --port 4177
```

### Build the Wiki website

The Wiki is a VitePress site backed by multiple Markdown pages under `docs/wiki/`:

```text
npm run wiki:dev       # local authoring server with hot reload
npm run wiki:build     # static site output: docs/wiki/.vitepress/dist/
npm run wiki:preview   # serve the generated static site locally
```

The generated `docs/wiki/.vitepress/dist/` directory can be copied to any static file server. The Wiki build is independent from the AgentDock TypeScript build; run both when preparing a release.

Validate a configuration file:

```text
npm run config:validate -- .agentdock/config.json
```

List configured Engines and check their installed versions:

```text
npm run build
node dist/cli.js engine list --config examples/config.example.json
node dist/cli.js engine health claude-code --config examples/config.example.json
node dist/cli.js engine health codex --config examples/config.example.json
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
node dist/cli.js run execute --config examples/config.example.json --environment claude-code-home "summarize the repository"
```

Inspect persisted execution data or create a reusable session:

```text
node dist/cli.js run list --config examples/config.example.json
node dist/cli.js run show --config examples/config.example.json <run-id>
node dist/cli.js run events --config examples/config.example.json <run-id>
node dist/cli.js run export --format jsonl --config examples/config.example.json <run-id>
node dist/cli.js session create --config examples/config.example.json --environment claude-code-home
node dist/cli.js session list --config examples/config.example.json
node dist/cli.js environment list --config examples/config.example.json
node dist/cli.js project show --config examples/config.example.json agentdock
```

Start the loopback-only local HTTP API for scripts or IDE integrations:

```text
node dist/cli.js api serve --config examples/config.example.json --port 4177
```

Open `http://127.0.0.1:4177/` in a browser for the Control Center. It shows Agent Engine, Project, Session and Run history, including immutable Run snapshots and event timelines. The single Configuration center edits Agent Engine, Agent Environment, Project and Environment Permission entities through forms or the advanced JSON editor. Project bindings use selectable Environments, so IDs do not need to be typed manually. Changes are validated, previewed with a diff and dry-run, protected by revision/hash conflict detection, saved atomically with backups, and require an API restart to apply. The UI supports Chinese and English switching; it follows the browser language on first use and remembers a manual choice in browser local storage. Enter the local Bearer token from the API startup output; the token is kept only in the browser's local storage. It does not start or cancel Runs.

The API supports asynchronous Run submission, query, cancellation, resumable SSE events and deterministic Agent routing at `/api/v1`. It deliberately listens only on `127.0.0.1`/`::1`, requires a local Bearer token, persists idempotency keys in SQLite and applies request/Run concurrency limits; see the [API reference](docs/api-reference.zh-CN.md) for endpoint and security details.

AgentDock uses the built-in `node:sqlite` module. It requires Node.js 22.5 or newer; the module currently emits Node's experimental-feature warning.

`dataDir` is a directory, relative to the configuration file. AgentDock stores its SQLite database at `<dataDir>/agentdock.db` (or `.agentdock/data/agentdock.db` by default). Development builds that previously created a database directly at `dataDir` remain readable without moving or deleting data.

See [the requirements analysis](docs/requirements-analysis.zh-CN.md) and [the development plan](docs/development-plan.zh-CN.md) for scope and milestones.
Configuration details are in [the configuration reference](docs/configuration-reference.zh-CN.md); API and SDK upgrades are covered by the [migration guide](docs/migration-guide.zh-CN.md).
The deterministic [example Adapter](examples/adapter-echo/README.md) can be installed without model access.
The [local API client example](examples/api-client/README.md) submits a Run and consumes its SSE stream using only Node.js built-ins.
For continuing development in a new Codex session, start with the [session handoff](docs/next-session-handoff.zh-CN.md).
