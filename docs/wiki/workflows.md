# 典型工作流

## 新项目初始化

1. 复制 [`packages/core/examples/config.example.json`](https://github.com/parkerluxu/AgentDock/blob/main/packages/core/examples/config.example.json) 或创建 `.agentdock/config.json`。
2. 配置 `engines`，确认对应 binary 可执行。
3. 创建 managed Environment，或将 `homeDir` 指向现有 Agent home。
4. 定义默认关闭网络和写入的 `environmentPermissions`。
5. 创建 Agent，把 Engine、Environment、Permission 绑定起来。
6. 创建 Project，设置 `rootDir`、`agentIds` 和 `defaultAgentId`。
7. 运行 `config validate`、`doctor` 和 `engine health`。

## 预览 → 执行 → 审计

```text
node packages/core/dist/cli.js run dry-run --config .agentdock/config.json --project my-project "review the current changes"
node packages/core/dist/cli.js run execute --config .agentdock/config.json --project my-project "review the current changes"
node packages/core/dist/cli.js run list --config .agentdock/config.json --project my-project
node packages/core/dist/cli.js run show --config .agentdock/config.json <run-id>
node packages/core/dist/cli.js run export --format jsonl --config .agentdock/config.json <run-id>
```

dry-run 用来确认最终 Agent、Engine、Environment、工作目录和权限。执行后再用 `run show/events/export` 审计结果。Run snapshot 会保留执行时的配置解释。

## API + SSE 集成

1. 运行 `node packages/core/dist/cli.js api serve ...`，保存启动输出中的 token。
2. 客户端带 `Authorization: Bearer <token>` 调用 `POST /api/v1/runs`。
3. 保存返回的 `run.id` 和 `eventsUrl`。
4. 使用 JSON 或 SSE 读取事件；断线时用最后确认的 sequence 作为 `after`。
5. 收到终态 status/error 后关闭连接。

仓库内的本地 API 客户端示例位于 packages/core/examples/api-client/，且无需额外依赖。

## Session 连续任务

```text
node packages/core/dist/cli.js session create --config .agentdock/config.json --agent claude-reviewer
node packages/core/dist/cli.js run execute --config .agentdock/config.json --session <session-id> "先分析测试失败"
node packages/core/dist/cli.js run execute --config .agentdock/config.json --session <session-id> "继续给出修复建议"
```

两个 Run 共享 AgentDock Session 元数据；是否能恢复 Runtime 原生会话取决于 Adapter 能力。

## 发布一个本地 Adapter

1. 从 [`packages/core/examples/adapter-echo`](https://github.com/parkerluxu/AgentDock/tree/main/packages/core/examples/adapter-echo) 复制 manifest 和入口结构。
2. 实现 `healthCheck`、`execute` 和 `cancel`。
3. 使用 `assertAdapterContract` 做契约测试。
4. `adapter install` 安装包，检查 `adapter list`。
5. 用 `adapter enable --grant ...` 明确授予 manifest 权限。
6. 用独立配置运行 dry-run、CLI 和 API 集成测试。
