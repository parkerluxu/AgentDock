# AgentDock

[![CI](https://github.com/parkerluxu/AgentDock/actions/workflows/ci.yml/badge.svg)](https://github.com/parkerluxu/AgentDock/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/parkerluxu/AgentDock?style=flat)](https://github.com/parkerluxu/AgentDock/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/parkerluxu/AgentDock?style=flat)](https://github.com/parkerluxu/AgentDock/network/members)
[![Last commit](https://img.shields.io/github/last-commit/parkerluxu/AgentDock?style=flat)](https://github.com/parkerluxu/AgentDock/commits/main)
[![Node.js 22.5+](https://img.shields.io/badge/Node.js-22.5%2B-339933?logo=node.js&logoColor=white&style=flat)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white&style=flat)](https://www.typescriptlang.org/)

[中文说明](docs/wiki/index.md) · [English Wiki](docs/wiki/en/index.md) · [API 参考 / API Reference](docs/api-reference.zh-CN.md) · [安全边界 / Security](docs/wiki/security.md)

## About / 项目简介

AgentDock is a local-first control plane for managing multiple AI Agent Engines, isolated Environments, Projects, Sessions and auditable Runs on the machine where the Agent CLIs are installed.

AgentDock 是一个 local-first 的 AI Agent 控制面，运行在安装 Agent CLI 的本机上，用于统一管理多个 Agent Engine、隔离的 Environment、Project、Session 以及可审计的 Run 执行记录。

It is a companion to local Agent tools, not a replacement for them. It provides discovery, deterministic routing, configuration isolation, immutable execution snapshots, a loopback HTTP API, a built-in Control Center and local Adapter lifecycle management.

它是本地 Agent 工具的协作层，而不是替代品：提供 Engine 发现、确定性路由、配置隔离、不可变执行快照、仅回环 HTTP API、内置 Control Center 和本地 Adapter 生命周期管理。

## Project tags / 项目标签

[![local-first](https://img.shields.io/badge/local--first-2563EB?style=flat-square)](docs/wiki/architecture.md)
[![ai-agents](https://img.shields.io/badge/ai--agents-7C3AED?style=flat-square)](docs/wiki/index.md)
[![agent-environments](https://img.shields.io/badge/agent--environments-0891B2?style=flat-square)](docs/wiki/environments.md)
[![multi-agent](https://img.shields.io/badge/multi--agent-0F766E?style=flat-square)](docs/wiki/workflows.md)
[![codex](https://img.shields.io/badge/Codex-111827?style=flat-square)](docs/wiki/configuration.md)
[![claude-code](https://img.shields.io/badge/Claude%20Code-D97706?style=flat-square)](docs/wiki/configuration.md)
[![developer-tools](https://img.shields.io/badge/developer--tools-475569?style=flat-square)](docs/wiki/cli.md)
[![typescript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square)](https://www.typescriptlang.org/)
[![node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square)](https://nodejs.org/)
[![cli](https://img.shields.io/badge/CLI-1D4ED8?style=flat-square)](docs/wiki/cli.md)
[![http-api](https://img.shields.io/badge/HTTP%20API-DB2777?style=flat-square)](docs/wiki/api.md)
[![sse](https://img.shields.io/badge/SSE-9333EA?style=flat-square)](docs/sdk-client.zh-CN.md)
[![sqlite](https://img.shields.io/badge/SQLite-0F766E?style=flat-square)](docs/wiki/architecture.md)

## At a glance / 项目速览

| English | 中文 |
| --- | --- |
| Local-first control plane for installed Agent CLIs | 面向本机 Agent CLI 的 local-first 控制面 |
| Engine, Agent, Environment, Permission and Project model | Engine、Agent、Environment、Permission、Project 配置模型 |
| CLI, loopback HTTP API, SSE and zero-dependency Node SDK | CLI、回环 HTTP API、SSE 以及零依赖 Node SDK |
| Immutable Run snapshots, ordered events and SQLite persistence | 不可变 Run 快照、有序事件和 SQLite 持久化 |
| Control Center for history, configuration and diagnostics | 用于历史、配置和诊断的 Control Center |

## Boundaries / 边界说明

AgentDock keeps Agent configuration and state in named Environments and enforces application-level permission checks. Adapter permissions are declarations and lifecycle checks, not OS or container sandboxing. The API listens only on `127.0.0.1` / `::1`, requires a local Bearer token and is intended for same-machine integrations, not public or remote hosting.

AgentDock 会把 Agent 配置和状态放入命名 Environment，并执行应用层权限检查。Adapter 权限声明和生命周期检查不等同于操作系统或容器级沙箱；API 只监听 `127.0.0.1` / `::1`，要求本地 Bearer Token，面向同机脚本、IDE 和 CI Runner，不是公网或远程部署端点。

## Quick start / 快速开始

Install Node.js `>=22.5`, then install dependencies and build the CLI:

安装 Node.js `>=22.5` 后，安装依赖并构建 CLI：

```text
npm ci
npm run build
npm run config:validate -- examples/config.example.json
node dist/cli.js doctor --config examples/config.example.json
```

Preview a safe execution plan without starting an Agent / 在不启动真实 Agent 的情况下预览执行计划：

```text
node dist/cli.js run dry-run --config examples/config.example.json --project agentdock "inspect the repository"
```

For the full CLI, API, Environment, Adapter and troubleshooting walkthrough, read the [AgentDock project Wiki](docs/wiki/index.md) or [English Wiki](docs/wiki/en/index.md).

## Development / 开发

```text
npm ci
npm run typecheck
npm test
npm run build
```

`npm run build` compiles `src/` into `dist/` and produces the runnable `dist/cli.js` entrypoint. For a complete walkthrough covering configuration, CLI workflows, local API deployment, Environment management, Adapter development, security boundaries and troubleshooting, see the [AgentDock project Wiki](docs/wiki/index.md).

### Build and local deployment / 构建与本地运行

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

### Build the Wiki website / 构建 Wiki 网站

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

Open `http://127.0.0.1:4177/` in a browser for the Control Center. It shows Agent Engine, Project, Session and Run history, including immutable Run snapshots and event timelines. The single Configuration center edits Agent, Agent Engine, Agent Environment, Project and Environment Permission entities through forms or the advanced JSON editor. Project bindings use selectable Agents and Environments, so IDs do not need to be typed manually. Changes are validated, previewed with a diff and dry-run, protected by revision/hash conflict detection, saved atomically with backups, and hot-reloaded when the change is safe. The API also watches the configuration file for external edits; invalid changes leave the last valid runtime active. A data directory change still requires an API restart because the existing SQLite store cannot move while the server is running. The UI supports Chinese and English switching; it follows the browser language on first use and remembers a manual choice in browser local storage. Enter the local Bearer token from the API startup output; the token is kept only in the browser's local storage. It does not start or cancel Runs.

The API supports direct Agent invocation over one SSE connection (`POST /agents/{agentId}/invoke`), as well as asynchronous Run submission, query, cancellation, resumable SSE events and deterministic Agent routing at `/api/v1`. It deliberately listens only on `127.0.0.1`/`::1`, requires a local Bearer token, persists idempotency keys in SQLite and applies request/Run concurrency limits; see the [API reference](docs/api-reference.zh-CN.md) for endpoint and security details. The zero-dependency Node client is documented in the [local SDK guide](docs/sdk-client.zh-CN.md).

AgentDock uses the built-in `node:sqlite` module. It requires Node.js 22.5 or newer; the module currently emits Node's experimental-feature warning.

`dataDir` is a directory, relative to the configuration file. AgentDock stores its SQLite database at `<dataDir>/agentdock.db` (or `.agentdock/data/agentdock.db` by default). Development builds that previously created a database directly at `dataDir` remain readable without moving or deleting data.

See [the requirements analysis](docs/requirements-analysis.zh-CN.md) and [the development plan](docs/development-plan.zh-CN.md) for scope and milestones.
Configuration details are in [the configuration reference](docs/configuration-reference.zh-CN.md); API and SDK upgrades are covered by the [migration guide](docs/migration-guide.zh-CN.md).
The deterministic [example Adapter](examples/adapter-echo/README.md) can be installed without model access.
The [local API client example](examples/api-client/README.md) invokes an Agent and consumes its SSE stream using only Node.js built-ins.
For continuing development in a new Codex session, start with the [session handoff](docs/next-session-handoff.zh-CN.md).
