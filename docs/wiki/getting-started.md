# 快速开始

## 前置条件

- Node.js `>=22.5`，项目使用 Node.js 内置 `node:sqlite`。
- npm（随 Node.js 一起安装）。
- 若执行真实 Agent，需要在 PATH 中安装对应 Runtime，例如 `claude` 或 `codex`。
- 只做演示和集成测试时，可以使用仓库内置的 `echo` Adapter。

## 安装与构建

在仓库根目录执行：

```text
npm ci
npm run typecheck
npm test
npm run build
```

构建产物位于 `dist/`，入口是 `dist/cli.js`。默认配置路径是 `.agentdock/config.json`；快速体验可直接使用 `examples/config.example.json`：

```text
npm run config:validate -- examples/config.example.json
node dist/cli.js doctor --config examples/config.example.json
node dist/cli.js engine list --config examples/config.example.json
```

## 第一次 dry-run

dry-run 只解析路由、工作目录和权限，不启动 Agent：

```text
node dist/cli.js run dry-run --config examples/config.example.json --project agentdock "inspect the repository"
```

输出中重点关注选择的 Agent/Engine/Environment、工作目录、网络策略和文件写入策略。

## 第一次真实执行

确认 dry-run 后执行任务：

```text
node dist/cli.js run execute --config examples/config.example.json --environment claude-code-home "summarize the repository"
```

命令会以 JSONL 输出事件，并把 Run、不可变快照、Session 映射和有序事件写入 SQLite。真实 Runtime 可能消耗模型配额。

## 没有真实 Runtime 时使用 Echo Adapter

Echo Adapter 不访问网络、不启动外部进程，适合测试 CLI、API 和 SDK：

```text
node dist/cli.js adapter install examples/adapter-echo --config examples/config.example.json
node dist/cli.js adapter enable example-echo --config examples/config.example.json
```

安装后需要在测试配置中声明使用 `example-echo` 的 Engine 和 Agent；示例包本身见 [examples/adapter-echo](https://github.com/parkerluxu/AgentDock/tree/main/examples/adapter-echo)。

## 下一步

- 想了解对象关系，阅读[配置模型](./configuration)。
- 想搭建本地文档站，阅读[构建与部署](./build-and-deploy)。
- 想从命令行执行和审计，阅读[CLI 使用手册](./cli)。
- 想用脚本或 IDE 集成，阅读[本地 API](./api)。
