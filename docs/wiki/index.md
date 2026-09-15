# AgentDock Wiki

AgentDock 是一个 local-first 的 AI Agent 控制面：它发现并管理多个 Agent Engine，为不同 Agent 提供隔离的 Environment 和权限策略，执行任务并把每次执行保存为带不可变快照的 Run。当前版本还提供 loopback HTTP API、内置 Control Center、SQLite 存储和本地 Adapter 生命周期管理。

推荐阅读路径如下：

1. [快速开始](./getting-started) —— 安装依赖、构建项目并完成第一次 dry-run。
2. [配置模型](./configuration) —— 理解 Engine、Agent、Environment、Permission 和 Project 的关系。
3. [典型工作流](./workflows) —— 执行、审计、Session、API 和 Adapter 的完整示例。
4. [从源码构建与本地部署](./build-and-deploy) —— 构建 AgentDock 和 Wiki，并在本机运行。

## AgentDock 能解决什么问题？

- 支持 Claude Code、Codex 以及本机安装的其他 Agent 适配器。
- 在执行前解析工作目录、Environment、网络和文件权限。
- 将路由结果、权限、配置目录 hash 和执行参数冻结到 Run snapshot。
- 通过 CLI、loopback API 和 Control Center 读取历史、事件和配置。
- 使用 SQLite 保存 Run、Session、事件和幂等键，便于审计与恢复。

## 版本与边界

当前版本为 `0.1.0-dev`，要求 Node.js `>=22.5`。本地 Adapter 的权限声明不是操作系统或容器级沙箱；API 只监听 `127.0.0.1` / `::1`，适合同机脚本、IDE 和 CI Runner，不是远程服务端点。

## 页面地图

| 主题 | 页面 |
| --- | --- |
| 入门 | [快速开始](./getting-started)、[构建与部署](./build-and-deploy) |
| 概念 | [架构与核心概念](./architecture)、[配置模型](./configuration) |
| 使用 | [CLI](./cli)、[典型工作流](./workflows) |
| 集成 | [本地 API](./api)、[本地调用 SDK](./sdk)、[Adapter SDK](./adapters)、[DeepSeek Harness 集成](./dsh) |
| 运维 | [Environment](./environments)、[安全边界](./security)、[故障排查](./troubleshooting) |

如果 PowerShell 当前目录不在源码目录，请先阅读[任意目录调用 CLI 与 SDK](./sdk)，其中说明绝对路径、Project `rootDir`、`npm link` 以及 ESM Node.js SDK 的使用方式。

更细的字段和兼容性说明仍保留在仓库的 [配置参考](https://github.com/parkerluxu/AgentDock/blob/main/docs/configuration-reference.zh-CN.md)、[API 参考](https://github.com/parkerluxu/AgentDock/blob/main/docs/api-reference.zh-CN.md)、[Adapter SDK](https://github.com/parkerluxu/AgentDock/blob/main/docs/adapter-sdk.zh-CN.md) 和 [迁移指南](https://github.com/parkerluxu/AgentDock/blob/main/docs/migration-guide.zh-CN.md)。
