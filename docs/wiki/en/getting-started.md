# Installation and quick start

Think of AgentDock as a local control plane that organizes and routes work to AI Agent command-line tools already available on your machine. The quickest first run needs no Codex/Claude account and does not call a model: use the built-in Echo Adapter for a dry-run and a local execution.

## Prerequisites

- Node.js `>=22.5` and npm. AgentDock uses the built-in `node:sqlite` module.
- Git to obtain the source (skip this if you already have the repository).
- Codex, Claude Code, or another Agent CLI is only needed for real model execution. Echo demos do not need one.
- The DSH plugin is optional; see the [DeepSeek Harness plugin guide](./dsh).

## Get the source and build

From the repository root:

```powershell
git clone https://github.com/parkerluxu/AgentDock.git
cd AgentDock
npm ci
npm run build --workspace agentdock
```

`npm ci` installs the monorepo dependencies. Build only the core workspace if you need the AgentDock CLI; `npm run build` also builds the optional DSH plugin. The current repository supports running from source; see [Build and local deployment](./build-and-deploy) for optional local global installation.

The CLI entrypoint in this workspace is `packages/core/dist/cli.js`, not `dist/cli.js` at the repository root. Run the following commands from the repository root.

## First run: no model installation required

`packages/core/examples/config.quickstart.json` is an isolated starter config. It uses only the built-in Echo Adapter, a read-only filesystem policy, and its own `.agentdock/quickstart-data` directory. It does not overwrite `.agentdock/config.json` or existing Run data.

Validate it:

```powershell
node .\packages\core\dist\cli.js config validate .\packages\core\examples\config.quickstart.json
```

Preview routing and permissions. A dry-run does not start an Agent or write a Run:

```powershell
node .\packages\core\dist\cli.js run dry-run --config .\packages\core\examples\config.quickstart.json --agent echo-agent --project agentdock-demo "Hello, AgentDock"
```

Execute a local Echo Run and inspect history:

```powershell
node .\packages\core\dist\cli.js run execute --config .\packages\core\examples\config.quickstart.json --agent echo-agent --project agentdock-demo "Hello, AgentDock"
node .\packages\core\dist\cli.js run list --config .\packages\core\examples\config.quickstart.json
```

Echo returns the input as a message without calling a model or launching an external process. Its first execution creates a local SQLite database and managed Environment under `.agentdock/quickstart-data/`; those are runtime data, not source files.

## Connect a real Agent

Install and sign in to the relevant CLI using its provider's instructions, then make sure `codex --version` or `claude --version` works in the current terminal. AgentDock does not install these runtimes for you.

Review [`packages/core/examples/config.example.json`](https://github.com/parkerluxu/AgentDock/blob/main/packages/core/examples/config.example.json), then create or adjust a config for your Runtime, Environment, and permissions. Before a real run, validate and diagnose it:

```powershell
node .\packages\core\dist\cli.js config validate .\packages\core\examples\config.example.json
node .\packages\core\dist\cli.js doctor --config .\packages\core\examples\config.example.json
node .\packages\core\dist\cli.js engine list --config .\packages\core\examples\config.example.json
```

Check the Agent, Engine, Project, and policy, then use `run dry-run` to inspect the selected route and working directory before executing. Real Agents can consume model quota. Application-level permissions are not an OS or container sandbox.

## Install a global command (optional)

To type `agentdock` from any directory, pack and globally install the local core workspace from the repository root:

```powershell
npm pack --workspace agentdock
# npm pack prints the exact .tgz name; the current version looks like agentdock-0.1.3-dev.tgz
npm install --global .\agentdock-0.1.3-dev.tgz
agentdock --help
```

This installs a local package built from the current source, not a package fetched from the public npm registry. Repack and install a new tarball after updating the source. You can always skip global installation and run `node .\packages\core\dist\cli.js ...` instead.

## Open the Control Center

Start the local API in one terminal:

```powershell
node .\packages\core\dist\cli.js api serve --config .\packages\core\examples\config.quickstart.json --port 4177
```

Open `http://127.0.0.1:4177/`. The API listens only on the local loopback interface. If you did not provide a token, the terminal prints the local token-file path. Press `Ctrl+C` to stop the server. See [Local API and Control Center](./api) and the [Control Center guide](./ui-guide) for details.

## What the repository folders do

| Path | Purpose |
| --- | --- |
| `packages/core/src/` | Core TypeScript source: CLI, API, routing, Environments, runtimes, policy, and storage. |
| `packages/core/dist/` | Core build output; `cli.js` is the executable entrypoint. Rebuild it from source as needed. |
| `packages/core/examples/` | Core sample configs, Echo example, and API client example. |
| `packages/dsh/src/` | DeepSeek Harness plugin source and its adapter/client integration with the AgentDock API. |
| `docs/` | Chinese development, configuration, API, release, and migration documentation. |
| `docs/wiki/` | VitePress Wiki pages and site configuration, with Chinese and English content. |
| `.agentdock/` | Local runtime data: config, database, Environment metadata, tokens, and backups—not program source. |
| Root `package.json` | npm workspaces and cross-package scripts; core and DSH have their own package manifests too. |

For the relationship between the core objects and the request flow, see [Architecture and core concepts](./architecture).

## Next steps

- Understand config objects: [Configuration](./configuration)
- Learn commands and options: [CLI reference](./cli)
- Install the DSH plugin: [DeepSeek Harness integration](./dsh)
- Run from another directory or use the SDK: [CLI and SDK](./sdk)
- Troubleshooting: [Troubleshooting](./troubleshooting)
