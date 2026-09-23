# AgentDock

[![CI](https://github.com/parkerluxu/AgentDock/actions/workflows/ci.yml/badge.svg)](https://github.com/parkerluxu/AgentDock/actions/workflows/ci.yml)
[![Node.js 22.5+](https://img.shields.io/badge/Node.js-22.5%2B-339933?logo=node.js&logoColor=white&style=flat)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white&style=flat)](https://www.typescriptlang.org/)

[English Wiki](docs/wiki/en/index.md) · [中文 README](README.zh-CN.md) · [中文 Wiki](docs/wiki/index.md) · [DSH plugin guide](docs/wiki/en/dsh.md)

AgentDock is a local-first control plane for organizing existing local Codex, Claude Code, and other Agent CLIs into routable Agents. It manages their Environments, Projects, permission policies, Sessions, and auditable execution history.

It complements rather than replaces Agent CLIs. The core provides a command-line interface, a loopback-only HTTP API, a Control Center, and SQLite history. The optional DSH plugin makes enabled AgentDock Agents available in the DeepSeek Harness model picker.

## Quick start

You need Node.js `>=22.5` and npm. Echo is built in, so this first run needs no model CLI or AI service login.

```powershell
npm ci
npm run build --workspace agentdock
node .\packages\core\dist\cli.js config validate .\packages\core\examples\config.quickstart.json
node .\packages\core\dist\cli.js run dry-run --config .\packages\core\examples\config.quickstart.json --agent echo-agent --project agentdock-demo "Hello, AgentDock"
node .\packages\core\dist\cli.js run execute --config .\packages\core\examples\config.quickstart.json --agent echo-agent --project agentdock-demo "Hello, AgentDock"
```

The first execution writes its Run data and managed starter Environment under `.agentdock/quickstart-data/`. Echo only returns the input; it does not call a model. For real Agents, the Control Center, and a step-by-step walkthrough, see the [Getting started Wiki](docs/wiki/en/getting-started.md).

## Installation

The current repository supports building and running from source. After checking it out, run `npm ci` at the repository root. To use the CLI, run `npm run build --workspace agentdock`; its entrypoint is `packages/core/dist/cli.js`. To make `agentdock` available from any directory, run `npm pack --workspace agentdock`, then install the local tarball printed by npm with `npm install --global <tarball>`.

DSH is a separate optional plugin. From the repository root, run `npm pack --workspace @agentdock/dsh`, then install the resulting `agentdock-dsh-*.tgz` with `npx @deepseek-ai/dsh plugin --profile web add -w <tarball>`. See the [DSH plugin guide](docs/wiki/en/dsh.md) for the full install, configuration, token, startup, and uninstall flow.

## Main components

| Component | Purpose |
| --- | --- |
| Engine | An executable Runtime/Adapter such as `codex`, `claude-code`, or built-in `echo`. |
| Agent | A selectable work unit that binds one Engine, Environment, and Permission. |
| Environment | The Agent's native home/config/state/cache, separate from the project working directory. |
| Project | Defines the working directory (`rootDir`), allowed Agents, and default Agent. |
| Permission | Application-level filesystem, network, and environment-variable policy—not an OS sandbox. |
| Session / Run | A Session keeps reusable conversation context; a Run is one task with a frozen config snapshot, events, and status. |
| CLI / API / Control Center | Interfaces for terminals, same-machine scripts/integrations, and a browser UI. The API listens only on loopback. |

See the Wiki's [architecture and source map](docs/wiki/en/architecture.md) for object relationships and folder responsibilities.

## Repository map

```text
packages/core/src/       Core CLI, API, routing, runtime, policy, Environment, storage
packages/core/examples/  Sample configs, built-in Echo starter config, API client
packages/dsh/src/        DeepSeek Harness plugin source
docs/                    Project, configuration, API, development, and release docs
docs/wiki/               Chinese and English VitePress Wiki
.agentdock/              Local runtime data (config, DB, Environments, tokens, etc.)
```

## Documentation

- [Install and quick start](docs/wiki/en/getting-started.md): build, run Echo, optional global install, and component map.
- [Architecture and concepts](docs/wiki/en/architecture.md): object relationships, request flow, and source folders.
- [Configuration](docs/wiki/en/configuration.md): Engines, Agents, Environments, Projects, and Permissions.
- [DeepSeek Harness plugin](docs/wiki/en/dsh.md): pack, install, configure, start, and uninstall the DSH plugin.
- [CLI](docs/wiki/en/cli.md), [local API](docs/wiki/en/api.md), [Environment management](docs/wiki/en/environments.md), and [security](docs/wiki/en/security.md).

## Development and Wiki

The root `npm run build` builds both the core and DSH workspaces. The Wiki is built separately:

```text
npm run wiki:dev
npm run wiki:build
npm run wiki:preview
```

Static Wiki output is written to `docs/wiki/.vitepress/dist/`. AgentDock requires Node.js `>=22.5`; its application-level permissions are not OS/container isolation. See the [development plan](docs/local-agent-environment-development-plan.zh-CN.md) and [release checklist](docs/release-checklist.zh-CN.md) for more technical detail.
