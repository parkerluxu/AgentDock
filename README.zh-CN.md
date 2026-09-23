# AgentDock

[![CI](https://github.com/parkerluxu/AgentDock/actions/workflows/ci.yml/badge.svg)](https://github.com/parkerluxu/AgentDock/actions/workflows/ci.yml)
[![Node.js 22.5+](https://img.shields.io/badge/Node.js-22.5%2B-339933?logo=node.js&logoColor=white&style=flat)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white&style=flat)](https://www.typescriptlang.org/)

[中文 Wiki](docs/wiki/index.md) · [English README](README.md) · [English Wiki](docs/wiki/en/index.md) · [DSH 插件安装指南](docs/dsh-plugin.zh-CN.md)

AgentDock 是一个本机优先的 AI Agent 控制面：把本机已有的 Codex、Claude Code 等 Agent CLI 组织成可路由的 Agent，并管理它们的 Environment、Project、权限策略、Session 和可审计执行记录。

它是本地 Agent 工具的协作层，不替代 Agent CLI。核心提供命令行、只监听本机的 HTTP API、Control Center 和 SQLite 历史；可选 DSH 插件则把 AgentDock Agent 接入 DeepSeek Harness 的模型选择器。

## 五分钟快速上手

需要 Node.js `>=22.5` 和 npm。Echo 是内置的演示引擎，不需要安装模型 CLI 或登录 AI 服务。

```powershell
npm ci
npm run build --workspace agentdock
node .\packages\core\dist\cli.js config validate .\packages\core\examples\config.quickstart.json
node .\packages\core\dist\cli.js run dry-run --config .\packages\core\examples\config.quickstart.json --agent echo-agent --project agentdock-demo "你好，AgentDock"
node .\packages\core\dist\cli.js run execute --config .\packages\core\examples\config.quickstart.json --agent echo-agent --project agentdock-demo "你好，AgentDock"
```

第一次执行后，Run 数据和入门 Environment 会写到 `.agentdock/quickstart-data/`。Echo 只原样返回消息，不调用模型。真实 Agent、Control Center、配置方法和逐步说明见[快速开始 Wiki](docs/wiki/getting-started.md)。

## 安装方式

AgentDock 当前从源码仓库构建和运行。检出仓库后，在根目录执行 `npm ci`；只用 CLI 时执行 `npm run build --workspace agentdock`，CLI 入口为 `packages/core/dist/cli.js`。若希望在任意目录使用 `agentdock` 命令，可执行 `npm pack --workspace agentdock`，再将 npm 输出的本地 `.tgz` 通过 `npm install --global <tarball>` 安装。

DSH 是独立的可选插件：在仓库根目录执行 `npm pack --workspace @agentdock/dsh`，将生成的 `agentdock-dsh-*.tgz` 用 `npx @deepseek-ai/dsh plugin --profile web add -w <tarball>` 安装。插件完整流程、Token 和配置说明见[DSH 插件指南](docs/dsh-plugin.zh-CN.md)。

## 主要组件

| 名称 | 作用 |
| --- | --- |
| Engine | 一种可执行 Runtime/Adapter，例如 `codex`、`claude-code` 或内置 `echo`。 |
| Agent | 可选择调用的工作单元，绑定一个 Engine、Environment 和 Permission。 |
| Environment | Agent 专用的原生 home/config/state/cache；与任务所在项目目录分开。 |
| Project | 规定工作目录 `rootDir`、允许使用的 Agent 和默认 Agent。 |
| Permission | 应用层文件读写、网络和环境变量策略；不是操作系统级沙箱。 |
| Session / Run | Session 保存可复用的对话上下文；Run 是一次任务及其不可变配置快照、事件和状态。 |
| CLI / API / Control Center | 分别供终端、同机脚本/集成、浏览器 UI 使用。API 仅监听本机回环地址。 |

源码目录地图见 Wiki 的[项目结构与架构说明](docs/wiki/architecture.md)。

## 仓库目录

```text
packages/core/src/     核心 CLI、API、路由、运行时、权限、Environment、存储
packages/core/examples/ 示例配置、内置 Echo 入门配置及 API 客户端
packages/dsh/src/      DeepSeek Harness 插件源码
docs/                  项目说明、配置、API、开发与发布文档
docs/wiki/             中英文 VitePress Wiki
.agentdock/             本机运行数据（配置、数据库、Environment、Token 等）
```

## 文档入口

- [安装与快速开始](docs/wiki/getting-started.md)：构建、Echo 首次运行、全局安装和组件地图。
- [架构与核心概念](docs/wiki/architecture.md)：对象关系、请求流和源码目录职责。
- [配置模型](docs/wiki/configuration.md)：Engine、Agent、Environment、Project 和 Permission。
- [DeepSeek Harness 插件指南](docs/dsh-plugin.zh-CN.md)：打包、安装、配置、启动和卸载 DSH 插件。
- [CLI 使用手册](docs/wiki/cli.md)、[本地 API](docs/wiki/api.md)、[Environment 管理](docs/wiki/environments.md)、[安全说明](docs/wiki/security.md)。

## 开发与文档站

根目录 `npm run build` 会构建 core 和 DSH 两个 workspace。Wiki 单独构建：

```text
npm run wiki:dev
npm run wiki:build
npm run wiki:preview
```

Wiki 静态产物位于 `docs/wiki/.vitepress/dist/`。AgentDock 需要 Node.js `>=22.5`；本地应用层权限声明不是 OS 或容器隔离。更多技术细节见[开发计划](docs/local-agent-environment-development-plan.zh-CN.md)与[发布检查清单](docs/release-checklist.zh-CN.md)。
