# Getting started

## Prerequisites

- Node.js `>=22.5` (AgentDock uses the built-in `node:sqlite`).
- npm.
- An installed `claude` or `codex` binary for real Agent execution.
- The built-in `echo` Adapter is enough for deterministic demos and integration tests.

## Install and build

From the repository root:

```text
npm ci
npm run typecheck
npm test
npm run build
```

Validate the sample configuration and run diagnostics:

```text
npm run config:validate -- examples/config.example.json
node dist/cli.js doctor --config examples/config.example.json
node dist/cli.js engine list --config examples/config.example.json
```

## First dry-run and execution

Preview routing without starting an Agent:

```text
node dist/cli.js run dry-run --config examples/config.example.json --project agentdock "inspect the repository"
```

Then execute a real task:

```text
node dist/cli.js run execute --config examples/config.example.json --environment claude-code-home "summarize the repository"
```

The command prints JSONL events and persists the Run, snapshot, Session mapping, and ordered events to SQLite.

## Echo Adapter demo

```text
node dist/cli.js adapter install examples/adapter-echo --config examples/config.example.json
node dist/cli.js adapter enable example-echo --config examples/config.example.json
```

Declare an Engine and Agent using `example-echo` in a test configuration. The package itself is documented in [examples/adapter-echo](https://github.com/parkerluxu/AgentDock/tree/main/examples/adapter-echo).
