# AgentDock 本地 Agent 环境管理方向（提案）

> 状态：提案
> 日期：2026-09-12
> 适用范围：下一阶段本地产品收敛；不改变远程/多租户能力的后续决策。

## 1. 产品定位

AgentDock 是**单个可信操作者或可信节点上的 Agent 环境管理与运行控制层**。它让用户为 Codex、Claude Code 和后续 Runtime 注册多个可调用的 Agent，并在不同 Project 中稳定地选择和执行它们。

首要解决的是 Agent 的原生配置、插件、技能、MCP、会话状态和缓存互不混用；不是把不受信任的代码或多租户工作负载关进安全沙箱。

### 本阶段承诺

- 同一机器上多套 Codex / Claude Code 原生环境可独立创建、导入、复制、诊断、备份和恢复。
- Project 显式限定可调用的 Agent，并提供默认 Agent。
- 每次执行可追溯到实际 Agent、Environment、Project、Session 和不可变配置快照。
- CLI、SDK 和本地 HTTP 调用都能以一次“调用 Agent”的心智模型消费流式结果。

### 明确不承诺

- 不提供 OS、容器或 VM 级安全隔离；目录/环境变量/网络策略仍是本机可信 Runtime 的运行约束和审计依据。
- 不开放公网 API，不建设组织、RBAC、计费、跨机器调度或不互信租户的安全边界。
- 不重新实现 Codex 或 Claude Code 的推理、工具调用或原生会话格式。

## 2. 以 Agent 为中心的领域模型

```text
Engine ──定义怎样启动──> Agent ──使用──> Environment
                                  └──应用──> Permission
Project ──允许并选择默认──> Agent
Session ──属于──> Agent + Environment 身份
Run ──冻结──> Agent / Environment / Project / Session 快照
```

| 对象 | 用户可理解的含义 | 责任 |
| --- | --- | --- |
| Engine | 哪个 Runtime | 二进制、Adapter、版本、能力和健康状态。 |
| Environment | Agent 的独立原生档案 | config、state、cache、启动设置以及目录生命周期；不默认复制登录缓存或明文凭证。 |
| Agent | 对外可调用的角色 | 绑定一个 Engine、一个 Environment 和 Permission，例如 `codex-reviewer`。 |
| Project | 工作发生在哪里 | 绑定仓库根目录、可用 Agent 和默认 Agent；不再承担“Agent 配置容器”的职责。 |
| Session | 可延续的对话 | 绑定创建它的 Agent 和 Environment 身份；禁止无声明地跨 Agent 恢复。 |
| Run | 一次执行记录 | 内部状态机、事件、取消、幂等、审计与不可变快照。 |

典型配置是同一 Project 同时拥有 `codex-reviewer`、`codex-implementer` 和 `claude-researcher`。它们可以在同一个仓库工作，但各自使用独立的原生 home/profile，因此 skill、plugin、MCP、会话和本地状态不会串用。

## 3. Environment 的产品能力

Environment 是本阶段的核心资产，而不是仅为启动进程准备的若干路径。

1. **创建与导入**：创建 managed Environment，或安全引用已有外部原生目录；执行目录、Runtime 版本和必需配置诊断。
2. **配置与状态分层**：显式区分可复制的 config 与不默认复制的 state、cache、session、认证缓存和 secret。复制操作默认仅复制已审查的配置层。
3. **身份与凭证选择**：创建时明确选择“使用一个 Secret Reference”或“在该原生环境中单独完成登录”；绝不静默复制其他 Environment 的 token/登录状态。
4. **变更可见性**：记录 manifest、hash、最后扫描时间和 Runtime 版本；外部修改后提示 rescan，再允许执行。
5. **可恢复性**：提供受控备份、克隆、恢复和归档；恢复或修改不改变历史 Run snapshot。
6. **运行前校验**：检查 Engine、native home、Project 根目录、Permission、Secret Reference 和可恢复 Session 是否匹配。

Permission 继续保留，但文案统一为“启动约束与审计策略”，不得称为安全沙箱。

## 4. 调用体验：Run 留在内部，Agent 调用面向用户

现有异步 `Run` API 保留为稳定的控制面，适合队列、审计、取消和自动化恢复。但普通调用方不应自行完成“创建 Run、保存 ID、连接 SSE、断线续传”的编排。

### 第一优先级：本地 SDK / CLI 封装

提供一条高层调用链：

```text
agentdock agent run codex-reviewer --project my-product "审查当前改动"
await client.agent("codex-reviewer").run({ projectId, task, sessionId, onEvent })
```

SDK 在内部创建 Run、立即订阅 SSE、保存最后 sequence、自动重连和去重；调用方只消费事件和最终结果。CLI 持续输出统一 JSONL/人类可读流。

当前 Node SDK 入口为 `AgentDockClient`，可从包入口导出；Project 的 Agent 绑定通过 `PUT /api/v1/projects/{projectId}/agents` 完成，保存时同样使用 revision/hash 并执行引用校验。

### 第二优先级：直接流式 HTTP 入口

新增一个不破坏现有 API 的便利端点，例如：

```http
POST /api/v1/agents/{agentId}/invoke
Accept: text/event-stream
```

请求带 `projectId`、`task`、可选 `sessionId` 和 `Idempotency-Key`。响应在同一条 SSE 连接中发送 `accepted`（含 `runId`）、`message`、`tool_call`、`tool_result`、终态 `status` / `error`。客户端无需轮询；断线后仍可用既有 `GET /runs/{runId}/events?after=` 恢复。

`POST /runs` 继续作为底层显式异步接口，服务 CI 队列、批处理和长期任务；不是普通 UI/上游业务的默认入口。

### DSH 一键启动：Token 留在启动器内部

DSH 是 AgentDock 的聊天入口之一，但普通用户不应手动启动 API、寻找 `api-token` 文件，或把 `AGENTDOCK_API_TOKEN` 写入自己的终端环境。提供高层命令：

```text
agentdock dsh start --config .agentdock/config.json
```

启动器按以下规则工作：

1. 检查指定配置对应的本机 AgentDock API 是否已健康运行；未运行时启动受管的仅回环 API，已运行时复用它。
2. 从 API 受控生成或保存的本机 token 位置读取 token，不在屏幕、DSH profile、AgentDock 业务配置、聊天记录或日志中输出 token。
3. 启动 DSH 子进程，并仅将 `AGENTDOCK_API_TOKEN` 注入该子进程环境；不修改调用者的 PowerShell/CMD 环境，也不要求用户复制粘贴 token。
4. 清楚报告复用或新启动的 API 地址、DSH 进程状态与可操作的故障原因；仅在启动器拥有该 API 进程时负责其退出清理。

这不是放宽回环 API 的认证边界：Bearer token 仍是同机进程间的最小认证措施；变化只是把凭证传递封装到可信的本地启动链中。

## 5. 实施顺序

### P0：收敛语义和安全边界（短迭代）

- 在 README、快速开始、UI 和 API 文案中统一声明“本地 Agent profile/state 隔离，非 OS 安全沙箱”。
- 所有入口以 `Agent` 作为选择对象；Environment 仅在诊断、配置和高级显式路由中露出。
- 将 Session 绑定扩展为 Agent + Environment 身份校验，避免错误恢复到另一套原生 home。
- 完善 Environment 复制规则和凭证处理提示，确保默认不迁移 token、认证缓存和历史 session。

**验收**：用户能清楚回答“我调用的是哪个 Agent、它使用哪套原生环境、在哪个 Project 中工作”；任何复制操作不会意外带走凭证或历史状态。

### P1：让调用像调用 Agent（中迭代）

- 增加 `agent run` CLI 和本地 SDK 的自动订阅/重连封装。
- 增加 `POST /agents/{agentId}/invoke` SSE 便利入口，复用现有 RunService、事件序列、幂等和取消实现。
- 在 Control Center 中以 Agent 为主视图显示其 Engine、Environment 健康、绑定 Project 和最近 Session/Run。
- 增加 `agentdock dsh start`，自动管理本机 API 的复用/启动，并只向它启动的 DSH 子进程注入 API token。

**验收**：上游应用只需一次调用即可持续接收 Agent 输出；不需要自己实现轮询或 SSE 断线续传，同时仍能获得 `runId` 用于审计和取消。通过 DSH 使用 AgentDock 时，用户只需执行一条启动命令，不需要接触或持久化 API token。

### P2：完善本地 Environment 生命周期（后续迭代）

- Environment 模板、只复制 config 的克隆、备份恢复和漂移修复工作流。
- Runtime 兼容矩阵、Agent 健康看板和针对 Codex/Claude Code 的诊断建议。
- Project 内多 Agent 的默认选择、能力筛选和清晰路由解释。

**验收**：用户可在两个以上 Project、两个以上 Agent 和两种 Runtime 之间可靠切换，且环境状态、会话归属和 Run snapshot 可解释。

## 6. 推迟但不封死的未来路径

未来若出现持续、重复的远程或不互信工作负载需求，可在不改变本模型的前提下增加 Worker、容器/VM 隔离、远程身份和中央审计。届时 Engine/Environment/Agent/Project/Session/Run 仍是领域对象；只需将本机 ProcessRunner 替换或扩展为受管 Worker 执行器。

在该需求被验证前，避免为假想的多租户平台引入网络暴露、复杂调度和安全承诺，保持本地配置环境管理的体验与可靠性优先。
