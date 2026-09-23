# AgentDock Wiki

AgentDock is a local-first control plane for discovering and managing AI Agent Engines, isolated Environments, permission boundaries, and auditable Runs. It provides a CLI, a loopback HTTP API, a built-in Control Center, SQLite persistence, and a local Adapter lifecycle.

A good reading path is:

1. [Getting started](./getting-started) — build the project, run the Echo demo, and understand the repository map.
2. [Architecture and core concepts](./architecture) — learn what the components and source folders do.
3. [Configuration](./configuration) — understand Engines, Agents, Environments, Permissions, and Projects.
3. [Plain-language case study](./case-study) — follow one repository review from start to finish.
4. [Build and local deployment](./build-and-deploy) — build both AgentDock and this Wiki.

## What AgentDock provides

- A common interface for Claude Code, Codex, and local third-party Adapters.
- Pre-execution routing for working directories, Environments, network, and filesystem policy.
- Immutable Run snapshots containing the execution context and Environment hash.
- CLI, API, and Control Center access to history, events, and configuration.
- A zero-dependency Node client SDK for one-call Agent invocation with SSE reconnect and deduplication.
- SQLite persistence for Runs, Sessions, events, and idempotency keys.

For per-conversation routing from DeepSeek Harness, see [DeepSeek Harness integration](./dsh).

If your PowerShell directory is outside the source tree, see [Use the CLI and SDK from any PowerShell directory](./sdk) for absolute paths, Project rootDir, local global installation, and ESM Node.js SDK usage.

## Version and boundaries

The current workspace package version is 0.1.3-dev and requires Node.js 22.5 or later. Adapter permissions are declarations and lifecycle checks, not OS or container sandboxing. The API listens only on 127.0.0.1 / ::1 and is intended for same-machine integrations.
