# AgentDock

[![CI](https://github.com/parkerluxu/AgentDock/actions/workflows/ci.yml/badge.svg)](https://github.com/parkerluxu/AgentDock/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/parkerluxu/AgentDock?style=flat)](https://github.com/parkerluxu/AgentDock/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/parkerluxu/AgentDock?style=flat)](https://github.com/parkerluxu/AgentDock/network/members)
[![Last commit](https://img.shields.io/github/last-commit/parkerluxu/AgentDock?style=flat)](https://github.com/parkerluxu/AgentDock/commits/main)
[![Node.js 22.5+](https://img.shields.io/badge/Node.js-22.5%2B-339933?logo=node.js&logoColor=white&style=flat)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white&style=flat)](https://www.typescriptlang.org/)

[English README](README.md) · [中文 README](README.zh-CN.md) · [中文 Wiki](docs/wiki/index.md) · [English Wiki](docs/wiki/en/index.md) · [API 参考](docs/api-reference.zh-CN.md) · [安全边界](docs/wiki/security.md)

## 项目简介

AgentDock 是一个 local-first 的控制面，运行在安装 Agent CLI 的本机上，用于管理多个 AI Agent Engine、隔离的 Environment、Project、Session 以及可审计的 Run 执行记录。

现在也可作为 DeepSeek Harness 的 Web 插件使用：在 DSH 的 **Settings → AgentDock** 中管理多 Agent 配置，并沿用 AgentDock 的校验、风险确认、原子保存和备份机制。安装及配置请见[DeepSeek Harness 插件指南](docs/dsh-plugin.zh-CN.md)。

它是本地 Agent 工具的协作层，而不是替代品：提供 Engine 发现、确定性路由、配置隔离、不可变执行快照、仅回环 HTTP API、内置 Control Center 和本地 Adapter 生命周期管理。

## 项目标签

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

## 项目速览

| 能力 | 说明 |
| --- | --- |
| Local-first 控制面 | 管理本机已安装的 Agent CLI |
| Engine、Agent、Environment、Permission、Project 模型 | 明确路由、配置和权限边界 |
| CLI、回环 HTTP API、SSE 和零依赖 Node SDK | 支持 Shell、脚本、IDE 和本地工具集成 |
| 不可变 Run 快照、有序事件和 SQLite 持久化 | 保留每次执行的可审计记录 |
| Control Center | 查看历史、配置和诊断信息 |

## 边界说明

AgentDock 会把 Agent 配置和状态放入命名 Environment，并执行应用层权限检查。Adapter 权限声明和生命周期检查不等同于操作系统或容器级沙箱。API 只监听 `127.0.0.1` / `::1`，要求本地 Bearer Token，面向同机集成，不是公网或远程部署端点。

## 快速开始

安装 Node.js `>=22.5`，然后安装依赖并构建 CLI：

```text
npm ci
npm run build
npm run config:validate -- examples/config.example.json
node dist/cli.js doctor --config examples/config.example.json
```

在不启动真实 Agent 的情况下预览执行计划：

```text
node dist/cli.js run dry-run --config examples/config.example.json --project agentdock "inspect the repository"
```

完整的 CLI、API、Environment、Adapter 和故障排查流程，请阅读[中文 Wiki](docs/wiki/index.md)或[English Wiki](docs/wiki/en/index.md)。

## 开发

```text
npm ci
npm run typecheck
npm test
npm run build
```

`npm run build` 会把 `src/` 编译到 `dist/`，并生成可运行的 `dist/cli.js` 入口。Wiki 涵盖配置、CLI 工作流、本地 API 部署、Environment 管理、Adapter 开发、安全边界和故障排查。

### 构建与本地运行

完成首次检出或 TypeScript 修改后，执行：

```text
npm ci
npm run typecheck
npm test
npm run build
npm run config:validate -- examples/config.example.json
node dist/cli.js doctor --config examples/config.example.json
```

从构建产物启动仅回环 API：

```text
node dist/cli.js api serve --config examples/config.example.json --port 4177
```

在浏览器打开 `http://127.0.0.1:4177/` 进入 Control Center。启动 JSON 会打印 API 地址；未显式提供 Token 时，也会打印生成的本地 `api-token` 文件路径。可以使用 `--api-token <token>` 或 `AGENTDOCK_API_TOKEN` 提供稳定 Token。API 只监听 `127.0.0.1` / `::1`，用于同机集成，不是远程部署端点。使用 `--port 0` 可让操作系统自动选择可用端口。

PowerShell 中可以显式提供 Token：

```powershell
$env:AGENTDOCK_API_TOKEN = "replace-with-a-long-local-token"
node dist/cli.js api serve --config examples/config.example.json --port 4177
```

### 构建 Wiki 网站

Wiki 是由 `docs/wiki/` 下多个 Markdown 页面组成的 VitePress 网站：

```text
npm run wiki:dev       # 带热重载的本地编辑服务
npm run wiki:build     # 静态网站输出：docs/wiki/.vitepress/dist/
npm run wiki:preview   # 本地预览生成的网站
```

生成的 `docs/wiki/.vitepress/dist/` 可以复制到任意静态文件服务器。Wiki 构建独立于 AgentDock TypeScript 构建，准备发布时建议两个构建都运行。

校验配置文件：

```text
npm run config:validate -- .agentdock/config.json
```

列出已配置的 Engine 并检查安装版本：

```text
npm run build
node dist/cli.js engine list --config examples/config.example.json
node dist/cli.js engine health claude-code --config examples/config.example.json
node dist/cli.js engine health codex --config examples/config.example.json
node dist/cli.js doctor --config examples/config.example.json
```

管理本地 Adapter 包。安装默认关闭；声明了 manifest 权限的 Adapter 必须通过显式授权才能启用：

```text
node dist/cli.js adapter install ./path/to/adapter --config examples/config.example.json
node dist/cli.js adapter list --config examples/config.example.json
node dist/cli.js adapter enable example --grant filesystem.read --config examples/config.example.json
node dist/cli.js adapter disable example --config examples/config.example.json
node dist/cli.js adapter uninstall example --config examples/config.example.json
```

在不启动 Agent 的情况下预览解析后的执行：

```text
node dist/cli.js run dry-run --config examples/config.example.json --project agentdock "inspect the repository"
```

`run execute` 会输出 JSONL 事件，并将 Run、不可变执行快照、Session 映射和有序事件持久化到本地 SQLite。它会启动真实 Agent，可能消耗模型额度：

```text
node dist/cli.js run execute --config examples/config.example.json --environment claude-code-home "summarize the repository"
```

查看持久化执行数据或创建可复用 Session：

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

为脚本或 IDE 集成启动仅回环本地 HTTP API：

```text
node dist/cli.js api serve --config examples/config.example.json --port 4177
```

在浏览器打开 `http://127.0.0.1:4177/` 进入 Control Center。它会显示 Agent Engine、Project、Session 和 Run 历史，包括不可变 Run 快照和事件时间线。Configuration center 可以通过表单或高级 JSON 编辑器修改 Agent、Agent Engine、Agent Environment、Project 和 Environment Permission。Project 绑定支持选择 Agent 和 Environment，不需要手工输入 ID。变更会经过校验、差异预览和 dry-run，并通过 revision/hash 冲突检测、备份和原子保存保护；安全变更会热加载，不安全变更会提示重启。UI 支持中英文切换，并会根据浏览器语言初始化、在浏览器本地存储手动选择。输入 API 启动输出中的本地 Bearer Token；Token 只保存在浏览器本地存储中。Control Center 不会启动或取消 Run。

API 支持通过一条 SSE 连接直接调用 Agent（`POST /agents/{agentId}/invoke`），也支持异步提交、查询、取消、可恢复 SSE 事件以及 `/api/v1` 下的确定性 Agent 路由。API 只监听 `127.0.0.1` / `::1`，要求本地 Bearer Token，将幂等键保存到 SQLite，并应用请求/Run 并发限制；详见 [API 参考](docs/api-reference.zh-CN.md)。零依赖 Node 客户端见[本地 SDK 指南](docs/sdk-client.zh-CN.md)。

AgentDock 使用 Node.js 内置的 `node:sqlite` 模块，要求 Node.js 22.5 或更高版本；该模块当前会输出 Node.js 的实验性功能警告。

`dataDir` 是相对于配置文件的目录。AgentDock 将 SQLite 数据库存储在 `<dataDir>/agentdock.db`（默认是 `.agentdock/data/agentdock.db`）。之前直接在 `dataDir` 创建数据库的开发版本仍可读取，无需移动或删除数据。

需求范围和里程碑见[需求分析](docs/requirements-analysis.zh-CN.md)与[开发计划](docs/development-plan.zh-CN.md)。配置详情见[配置参考](docs/configuration-reference.zh-CN.md)；API 和 SDK 升级见[迁移指南](docs/migration-guide.zh-CN.md)。确定性的[示例 Adapter](examples/adapter-echo/README.md)无需模型访问即可安装。[本地 API 客户端示例](examples/api-client/README.md)只使用 Node.js 内置能力调用 Agent 并消费 SSE 流。若要在新的 Codex 会话中继续开发，请先阅读[会话交接文档](docs/next-session-handoff.zh-CN.md)。

更多关于从任意 PowerShell 目录调用 CLI、SDK、绝对路径和 Project `rootDir` 的说明，见 Wiki 的[任意目录调用 CLI 与 SDK](docs/wiki/sdk.md)。
