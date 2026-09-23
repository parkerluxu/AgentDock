# 安装与快速上手

如果你第一次接触 AgentDock，可以先把它理解成“把本机不同 AI Agent 的命令行工具统一管理起来”的控制面。最快的体验方式不需要 Codex/Claude 账号，也不会调用模型：先用内置 Echo 完成一次 dry-run 和一次本地执行。

## 需要准备什么

- Node.js `>=22.5` 和 npm。Node.js 22.5 起提供项目使用的内置 `node:sqlite`。
- Git，用于获取源码（若你已经打开本仓库则无需再克隆）。
- Codex、Claude Code 等 Agent CLI 只在你要运行真实模型时需要；Echo 演示不需要它们。
- DSH 插件是可选集成，安装步骤见[DeepSeek Harness 插件指南](./dsh)。

## 获取代码并构建

在仓库根目录运行：

```powershell
git clone https://github.com/parkerluxu/AgentDock.git
cd AgentDock
npm ci
npm run build --workspace agentdock
```

`npm ci` 安装 monorepo 的依赖。只使用 AgentDock CLI 时，构建 core workspace 即可；`npm run build` 会额外构建可选的 DSH 插件。当前仓库可从源码直接运行；如需全局 `agentdock` 命令，可看[从源码构建与本地部署](./build-and-deploy)中的本地打包说明。

本仓库 CLI 的入口是 `packages/core/dist/cli.js`，不是仓库根目录下的 `dist/cli.js`。以下命令都从仓库根目录执行。

## 第一次体验：不安装模型也能运行

`packages/core/examples/config.quickstart.json` 是专为入门准备的配置：只使用内置 Echo Adapter、只读文件策略和独立的 `.agentdock/quickstart-data` 数据目录，不会改动默认 `.agentdock/config.json` 或已有 Run 数据。

先校验配置：

```powershell
node .\packages\core\dist\cli.js config validate .\packages\core\examples\config.quickstart.json
```

预览路由和权限（dry-run 不会启动 Agent，也不写入 Run）：

```powershell
node .\packages\core\dist\cli.js run dry-run --config .\packages\core\examples\config.quickstart.json --agent echo-agent --project agentdock-demo "你好，AgentDock"
```

执行一次本地 Echo Run：

```powershell
node .\packages\core\dist\cli.js run execute --config .\packages\core\examples\config.quickstart.json --agent echo-agent --project agentdock-demo "你好，AgentDock"
node .\packages\core\dist\cli.js run list --config .\packages\core\examples\config.quickstart.json
```

Echo 会把输入原样作为消息返回，不会调用模型或启动外部进程。首次执行会在 `.agentdock/quickstart-data/` 下创建本地 SQLite 数据和 managed Environment 文件；这些内容是运行数据，不是源代码。

## 接入真实 Agent

先按 Codex 或 Claude Code 提供方的说明安装并登录对应 CLI，确认 `codex --version` 或 `claude --version` 在当前终端能运行。AgentDock 不会替你安装这些 Runtime。

然后查看 [`packages/core/examples/config.example.json`](https://github.com/parkerluxu/AgentDock/blob/main/packages/core/examples/config.example.json)，按你的 Runtime、Environment 和权限需要创建或调整一份配置。开始真实执行前，建议依次：

```powershell
node .\packages\core\dist\cli.js config validate .\packages\core\examples\config.example.json
node .\packages\core\dist\cli.js doctor --config .\packages\core\examples\config.example.json
node .\packages\core\dist\cli.js engine list --config .\packages\core\examples\config.example.json
```

确认 Agent、Engine、Project 和权限都符合预期后，先运行 `run dry-run` 检查最终工作目录和路由，再执行真实 Run。真实 Agent 可能消耗模型额度；文件和网络策略也不是操作系统或容器级沙箱。

## 安装成全局命令（可选）

若希望在任意目录输入 `agentdock` 而不写 Node 入口路径，可从仓库根目录打包并全局安装本地 core 包：

```powershell
npm pack --workspace agentdock
# npm pack 会打印实际生成的 .tgz 文件名；当前版本形如 agentdock-0.1.3-dev.tgz
npm install --global .\agentdock-0.1.3-dev.tgz
agentdock --help
```

这是从当前源码生成的本地包，不等于从公共 npm registry 安装。升级源码后需重新打包并安装新 tarball。也可以始终使用 `node .\packages\core\dist\cli.js ...`，不做全局安装。

## 打开 Control Center

在一个终端启动本地 API：

```powershell
node .\packages\core\dist\cli.js api serve --config .\packages\core\examples\config.quickstart.json --port 4177
```

打开 `http://127.0.0.1:4177/`。API 只监听本机回环地址；未自行提供 Token 时，终端会打印本地 token 文件路径。按 `Ctrl+C` 停止服务。更完整的 API 与 UI 说明见[本地 API 与 Control Center](./api)及[Control Center 用法](./ui-guide)。

## 项目目录里各部分是什么

| 路径 | 用途 |
| --- | --- |
| `packages/core/src/` | AgentDock 核心 TypeScript 源码；CLI、API、路由、Environment、运行时、策略和存储都在这里。 |
| `packages/core/dist/` | core 构建产物；CLI 实际入口为 `cli.js`。重新构建即可生成，不是主要源码目录。 |
| `packages/core/examples/` | core 自带的配置、Echo 示例和 API 客户端示例。 |
| `packages/dsh/src/` | DeepSeek Harness 插件源码及其对接 AgentDock API 的前端/适配层。 |
| `docs/` | 中文开发、配置、API、发布和迁移文档。 |
| `docs/wiki/` | VitePress Wiki 页面与网站配置，含中英文内容。 |
| `.agentdock/` | 本机配置、数据库、Environment 元数据、Token 和备份等运行数据；不是程序源码。 |
| 根目录 `package.json` | npm workspaces 与跨包脚本；core、DSH 各自也有 package manifest。 |

每次任务的概念关系和一次请求如何经过这些代码，请看[架构与核心概念](./architecture)。

## 下一步

- 按对象理解配置： [配置模型](./configuration)
- 查命令与选项： [CLI 使用手册](./cli)
- 安装 DSH 插件： [DeepSeek Harness 集成](./dsh)
- 任意目录运行、SDK 和项目路径： [CLI 与 SDK](./sdk)
- 查运行问题： [故障排查](./troubleshooting)
