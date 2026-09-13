# AgentDock Wiki

AgentDock is a local-first control plane for discovering and managing AI Agent Engines, isolated Environments, permission boundaries, and auditable Runs. It provides a CLI, a loopback HTTP API, a built-in Control Center, SQLite persistence, and a local Adapter lifecycle.

A good reading path is:

1. [Getting started](./getting-started) — install, build, and run your first dry-run.
2. [Configuration](./configuration) — understand Engines, Agents, Environments, Permissions, and Projects.
3. [Plain-language case study](./case-study) — follow one repository review from start to finish.
4. [Build and local deployment](./build-and-deploy) — build both AgentDock and this Wiki.

## What AgentDock provides

- A common interface for Claude Code, Codex, and local third-party Adapters.
- Pre-execution routing for working directories, Environments, network, and filesystem policy.
- Immutable Run snapshots containing the execution context and Environment hash.
- CLI, API, and Control Center access to history, events, and configuration.
- A zero-dependency Node client SDK for one-call Agent invocation with SSE reconnect and deduplication.
- SQLite persistence for Runs, Sessions, events, and idempotency keys.

If your PowerShell directory is outside the source tree, see [Use the CLI and SDK from any PowerShell directory](./sdk) for absolute paths, Project `rootDir`, `npm link`, and ESM Node.js SDK usage.

## Version and boundaries

The current version is `0.1.0-dev` and requires Node.js `>=22.5`. Adapter permissions are declarations and lifecycle checks, not OS or container sandboxing. The API listens only on `127.0.0.1` / `::1` and is intended for same-machine integrations.
