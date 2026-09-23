# API/SDK 迁移指南（v1）

本文面向从 CLI 直接调用、早期 API 第一切片或 Adapter SDK `0.1.x` 升级的使用者。当前 API 路径是 `/api/v1`，Adapter manifest 的 `agentDockApi` 是 `v1`。

## 从 CLI 调用迁移到 API

CLI 的 `run execute` 参数对应 API 的 `POST /api/v1/runs`；面向固定 Agent 的新调用也可以使用 `POST /api/v1/agents/:agentId/invoke`，一次请求直接消费 SSE。

| CLI | API JSON |
| --- | --- |
| `--environment <id>` | `environmentId` |
| `--project <id>` | `projectId` |
| `--session <id>` | `sessionId` |
| 任务文本 | `task` |
| 路由能力条件 | `requiredCapabilities` |
| 策略网络要求 | `network` |
| 是否写入文件 | `filesystemWrite` |

## Agent-first 调用迁移

日常调用现在以 Agent 为默认对象；Environment 仍保留给配置、诊断、恢复和明确的高级路由。迁移前先用 `agent run --dry-run` 或 `POST /api/v1/routing/preview` 检查 Agent binding、Project 默认值、Environment readiness 和拒绝原因；这些操作不会创建 Run。

| 旧/高级入口 | 推荐调用 | 仍应使用旧/高级入口的场景 | 回滚方法 |
| --- | --- | --- | --- |
| `agentdock run execute --environment <id> <task>` | `agentdock agent run <agent-id> <task>` | 批处理、队列、恢复工具或需要明确选择 Environment 的诊断。 | 继续使用 `run execute`；它仍是 v1 兼容入口。 |
| `POST /api/v1/runs` 带 `environmentId` | `POST /api/v1/agents/:agentId/invoke`（SSE）或 SDK `client.agent(id).run()` | 需要 `202 Accepted`、幂等键、异步队列或显式 Environment 路由。 | 继续 `POST /runs`，请求格式未删除。 |
| 旧 Project `environmentIds/defaultEnvironmentId` | `agentIds/defaultAgentId` | 尚未迁移的 v1 配置。 | 保留旧字段；配置读取器仍合成确定性的 Agent。 |

高层 `agent run` 与 `/agents/:agentId/invoke` 不接受 `environmentId`，避免把 Session 恢复到意外的原生 home。旧 Project Environment 字段是兼容输入而不是新配置建议：至少保留一个完整发布周期；任何移除都只会在后续配置主版本中进行，并先提供本地、可预览且带可恢复配置备份的迁移命令。当前没有已宣布的移除日期。

迁移后，Run snapshot 会冻结实际 Agent、Engine、Environment manifest/hash、Permission、Project 和 Session。若新路由无法满足要求，读取 `routing.candidates[].reasons`，修正 binding 或 Permission；不要静默切换到另一个 Environment。

请求必须带 `Authorization: Bearer <token>` 和 `Content-Type: application/json`。需要重试的客户端应提供稳定的 `Idempotency-Key`；相同 key 和相同请求会返回原 Run，key 复用到不同请求会返回 `409 IDEMPOTENCY_KEY_CONFLICT`。

API 创建成功返回 `202`，随后从 `GET /api/v1/runs/{runId}/events` 读取历史 JSON 或 SSE。SSE 的 `id` 是 Run 内事件序号，断线后使用 `after=<最后确认的序号>`，客户端必须能处理重复连接而不能假定服务保留内存游标。

## 从 API 第一切片迁移

配置模型已经破坏性替换为 `engines`、`environments`、`environmentPermissions` 和 `projects[].environmentIds/defaultEnvironmentId`。旧 `runtimes/profiles/policies` 配置不会自动投影或兼容读取；迁移前请人工转换并校验。该变化不会删除 `.agentdock` 中的 SQLite、历史 Run 或 Agent 原生目录。

1. 将旧路径统一改为 `/api/v1`，不要依赖未版本化路径。
2. 对 `POST /runs` 保存并重用 `Idempotency-Key`，不要用 Run id 自行模拟幂等。
3. 处理 `202`、`200`（幂等重放）、`409`、`429` 和 `413`；错误体统一读取 `error.code` 与 `error.message`。
4. SSE 消费器只依据 `id` 去重，并在收到终态 `status` 或 `error` 后关闭连接。
5. 不把 Bearer token 写入任务、日志、导出或错误上报；API 只监听回环地址，token 不代表远程身份认证。

`POST /api/v1/agents/:agentId/invoke` 要求 `Accept: text/event-stream`。它会先发送 `accepted`（含 `runId` 和 `eventsUrl`），再发送标准 Run 事件；Agent 已绑定 Environment，因此请求体不能传 `environmentId`。现有 `POST /api/v1/runs` 保持兼容，适用于需要显式异步 Run 的客户端。

Node 调用方可以使用包入口导出的 `AgentDockClient`，由 SDK 自动完成上述 SSE 消费、断线重连和 sequence 去重；参见[本地 Agent 调用 SDK](./sdk-client.zh-CN.md)。Project 的可调用 Agent 列表和默认 Agent 可通过 `PUT /api/v1/projects/:projectId/agents` 原子更新，并携带当前 `revision/hash`。

## Adapter SDK v0.1 到 v1 兼容边界

Adapter 必须提供 `healthCheck()`、`execute(request)` 和 `cancel(runId)`，并通过 `agentDockApi: "v1"` manifest 校验。事件的 `runId` 必须匹配请求，序号必须严格递增，最后必须是 `succeeded`、`failed`、`cancelled` 或 `timed_out` 终态。

如果 Adapter 可能在第一个运行事件前失败，直接抛出异常即可，RunService 会记录 `ADAPTER_EXECUTION_ERROR`；如果迭代器正常结束但未产生终态，控制面会记录 `NO_TERMINAL_EVENT`。不要依赖内部的 RunService、SQLite 表或 HTTP handler；只依赖 `src/adapter-sdk` 导出的公共类型和工具。

使用仓库内契约测试：

```ts
import { assertAdapterContract } from "agentdock";

await assertAdapterContract(adapter, { runtime, task: "contract smoke task" });
```

manifest 的 `requiredPermissions` 只表示所需权限。第三方本地包安装后默认禁用，启用时必须逐项授予 manifest 声明的权限；这不是 OS/容器级沙箱。

## 破坏性变更规则

- v1 路径、错误码、Run 状态、事件类型和 manifest API 版本不得在小版本中删除或改变语义。
- 新增响应字段和可选请求字段属于兼容扩展；客户端必须忽略未知字段。
- 新增事件类型、能力或权限时，先更新兼容矩阵、OpenAPI/SDK 类型和契约测试。
- 删除字段、改变状态迁移或改变事件 payload 语义时，必须发布新的 API/Adapter API 版本，并在本指南增加迁移段落。
