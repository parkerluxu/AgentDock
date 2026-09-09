# 架构与核心概念

## 分层结构

```text
CLI / Control Center / HTTP API
              │
        路由与 Policy
              │
        RunService / SessionService
              │
       Runtime Registry + Adapter
              │
       Claude Code / Codex / 本地包
              │
    ProcessRunner 与 Agent 原生目录
              │
             SQLite
```

- **CLI**：`src/cli.ts` 提供校验、诊断、执行、Session、查询和 API 启动命令。
- **API**：`src/api/server.ts` 是只监听 loopback 的 HTTP 服务；`src/web/` 提供内置 Control Center。
- **Policy/Router**：根据显式 Agent、Environment、Project 默认值和能力要求选择执行上下文。
- **RunService**：创建 Run、冻结 snapshot、校验状态迁移、保存事件并处理取消/失败。
- **Runtime Registry**：加载内置 Adapter 和已启用的本地 Adapter，校验 manifest 后创建实例。
- **EnvironmentDirectoryManager**：管理配置目录、state/cache、manifest、hash、备份和恢复。
- **SqliteRunStore**：保存 Run、RunEvent、Session 和幂等键，并在打开时应用保留策略。

## 对象关系

```text
Engine ──被 Agent 引用──> Agent ──绑定──> Environment
                                  └──────> Environment Permission
Project ──允许多个 Agent，选择 defaultAgent──> Agent
Run ──创建时冻结──> Agent / Engine / Environment / Permission / Project
Session ──属于一个 Engine，可被多个 Run 复用──> Run
```

### Engine

Engine 描述可执行的 Agent Runtime：Adapter 名称、binary、额外参数、能力和启用状态。当前内置 `claude-code`、`codex` 和 `echo` Adapter。

### Agent

Agent 是实际的调用单位，把一个 Engine、一个 Environment 和一个 Environment Permission 绑定在一起。Project 通过 `agentIds` 限制可调用的 Agent，并用 `defaultAgentId` 指定默认值。

### Environment

Environment 保存 Agent 的原生 home/config/state/cache 目录。它可以是 AgentDock 管理的 `managed` 目录，也可以引用现有 `external` home。目录 hash 和 manifest 用于识别外部漂移。

### Run 与事件

Run 有 `queued`、`running`、`succeeded`、`failed`、`cancelled`、`timed_out` 六种状态。事件类型包括 `status`、`message`、`tool_call`、`tool_result` 和 `error`；每个 Run 内 sequence 严格递增。

Run snapshot 记录执行时的 Agent、Engine、Environment、Permission、Project、工作目录、允许的环境变量、Secret Reference key 以及 Environment manifest/hash。历史 Run 不会随当前配置变化而改变。

## 事件生命周期

```text
创建 Run → queued(0) → running → message/tool_* → succeeded/failed/cancelled/timed_out
```

如果 Adapter 异常退出，RunService 会写入 `ADAPTER_EXECUTION_ERROR`；如果迭代器结束却没有终态事件，会写入 `NO_TERMINAL_EVENT`。API 侧的 SSE 可回放历史事件，终态 Run 回放完成后关闭连接。
