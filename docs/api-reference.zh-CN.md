# 本地 HTTP API（v1）

AgentDock 的本地 API 是 CLI 之外的可编程入口。当前实现仅监听 `127.0.0.1` 或 `::1`，不提供局域网/公网监听选项；因此它适用于同一台机器上的脚本、IDE 插件和 CI Runner。

启动服务：

```text
node dist/cli.js api serve --config examples/config.example.json --port 4177
```

服务默认生成一个高熵本地 token，并保存到 SQLite 数据库同目录的 `api-token` 文件。CLI 启动输出会给出该文件路径；客户端必须在每次请求中携带：

```http
Authorization: Bearer <api-token>
```

也可以通过 `--api-token` 或 `AGENTDOCK_API_TOKEN` 显式提供 token。显式 token 至少需要 16 个字符，不会写入数据库、事件或服务输出。

服务会输出机器可读的监听地址，例如：

```json
{
  "listening": true,
  "host": "127.0.0.1",
  "port": 4177,
  "apiBaseUrl": "http://127.0.0.1:4177/api/v1"
}
```

按 `Ctrl+C` 或发送 `SIGTERM` 会停止接收请求、取消本服务进程持有的 Run 并关闭数据库。

## 资源与端点

启动 API 后访问 `http://127.0.0.1:<port>/` 可打开内置 Control Center；`/ui` 和 `/ui/` 也指向同一页面。页面支持中文/英文切换：首次打开默认跟随浏览器语言，手动选择会保存在当前浏览器本地。页面不会把 token 放入 URL，首次打开时在浏览器中输入 API 启动输出的本地 token。控制台提供 Engine/Environment/Project/Session/Run 的查看和 Run 详情，也提供受保护的配置编辑入口。

### 配置编辑 API

配置写入仅允许回环 API 的 Bearer token 客户端调用。`GET /config` 返回规范化配置和内容 `revision/hash`；保存或恢复必须携带这两个值，服务会在写入前重新读取配置，发现并发修改时返回 `409 CONFIG_CONFLICT`。配置候选先经过同一份 schema、跨对象引用和 Environment Permission 校验；`POST /config/preview` 还可返回 `dryRun`、差异和高风险变更说明。

`PUT /config` 使用同目录临时文件和原子替换，成功前保留带随机标识的备份；安全变更会在保存后立即热加载，并返回 `restartRequired: false`。API 也会监听配置文件的外部修改，读取失败时保留上一次有效运行配置。只有数据目录改变或运行时组件无法热加载时才返回 `restartRequired: true`，同时在 `restartReasons` 中说明原因。写入、网络、shell/command 或 Secret Reference 变化会返回高风险说明；请求必须明确设置 `confirmHighRisk: true` 才能保存。明文 secret 不接受，配置中只能使用 `environment.secretRefs`。审计事件追加到配置文件同目录的 `config-audit.jsonl`，只记录版本、差异路径和风险摘要，不记录配置值。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/health` | API 服务自身的健康检查。 |
| `GET` | `/api/v1/openapi.json` | 获取当前 API v1 的 OpenAPI 3.0 schema。 |
| `GET` | `/api/v1/engines` | 配置中的 Agent Engine 描述符。 |
| `GET` | `/api/v1/agents` | 对外可调用的 Agent 及其 Engine、Environment、Permission 绑定。 |
| `POST` | `/api/v1/agents/:agentId/invoke` | 通过一条 SSE 连接调用 Agent（推荐的交互入口）。 |
| `PUT` | `/api/v1/projects/:projectId/agents` | 原子更新 Project 可调用的 Agent 列表和默认 Agent。 |
| `GET/POST` | `/api/v1/environments` | 列出或创建 Agent Environment。 |
| `GET/PUT/DELETE` | `/api/v1/environments/:environmentId` | 查看、修改或移除 Environment 配置；删除不会删除目录。 |
| `POST` | `/api/v1/environments/:environmentId/rescan` | 重新扫描配置目录并更新 manifest/hash。 |
| `POST` | `/api/v1/environments/:environmentId/copy` | 复制配置目录到新的 managed Environment。 |
| `POST` | `/api/v1/environments/import` | 从现有目录导入 Environment 配置。 |
| `GET/POST` | `/api/v1/environments/:environmentId/backups` | 列出或创建 Environment 配置备份。 |
| `POST` | `/api/v1/environments/:environmentId/restore` | 恢复 Environment 配置备份。 |
| `GET` | `/api/v1/sessions` | 本地 Session 列表。 |
| `GET` | `/api/v1/projects` | 配置中的 Project 列表。 |
| `PUT` | `/api/v1/projects/:projectId/agents` | 原子更新 Project 可调用的 Agent 列表和默认 Agent。 |
| `GET` | `/api/v1/config` | 获取配置快照、revision 和 hash。 |
| `POST` | `/api/v1/config/preview` | 校验候选配置并返回 Policy、dry-run、风险和差异预览。 |
| `PUT` | `/api/v1/config` | 按 revision/hash 原子保存配置；安全变更会热加载，响应会说明是否仍需重启。 |
| `GET` | `/api/v1/config/backups` | 列出可恢复的配置备份。 |
| `POST` | `/api/v1/config/restore` | 按备份 ID 恢复配置，同样执行并发检查、原子写入和安全热加载。 |
| `GET` | `/api/v1/runs?status=&projectId=&limit=` | Run 列表；`status` 必须是有效的统一 Run 状态。 |
| `POST` | `/api/v1/runs` | 创建并异步执行一个 Run。 |
| `GET` | `/api/v1/runs/:runId` | 获取 Run 与不可变执行快照。 |
| `POST` | `/api/v1/runs/:runId/cancel` | 请求取消本 API 进程正在管理的 Run。 |
| `GET` | `/api/v1/runs/:runId/events` | 获取历史事件 JSON，或通过 SSE 订阅事件。 |

## 调用 Agent（推荐）

普通交互不需要先创建 Run、再用 Run ID 建立第二条 SSE 连接。将 Agent ID 放在 URL 中，并声明 `Accept: text/event-stream`；响应会在同一条连接上持续返回事件：

```http
POST /api/v1/agents/codex-reviewer/invoke
Authorization: Bearer <api-token>
Content-Type: application/json
Accept: text/event-stream
Idempotency-Key: review-20260912-001

{
  "task": "审查当前仓库的测试失败原因",
  "projectId": "agentdock"
}
```

第一个 SSE frame 是没有 sequence 的 `accepted` 事件，包含内部 Run ID、是否新建和事件重放 URL；后续 frame 是同一 Run 的标准事件，`id` 等于严格递增的 sequence：

```text
event: accepted
data: {"runId":"...","created":true,"eventsUrl":"/api/v1/runs/.../events"}

id: 0
event: status
data: {"runId":"...","sequence":0,"type":"status","payload":{"status":"queued"}}
```

请求可携带 `projectId`、`sessionId`、能力和 Permission 要求；不接受 `environmentId`，因为 Agent 已经绑定其独立的 Environment。断线后使用 `accepted` 中的 `eventsUrl` 和 `after=<最后确认 sequence>` 恢复。没有 SSE `Accept` 的调用会返回 `406 SSE_REQUIRED`；需要显式异步/批处理语义时使用下面的 `POST /runs`。

## 创建 Run

```http
POST /api/v1/runs
Content-Type: application/json
Authorization: Bearer <api-token>
Idempotency-Key: review-20260822-001

{
  "task": "审查当前仓库的测试失败原因",
  "projectId": "agentdock",
  "environmentId": "claude-code-readonly",
  "requiredCapabilities": ["execute", "stream_events"],
  "network": "deny",
  "filesystemWrite": false
}
```

`task` 是唯一必填字段。`environmentId`、`projectId` 和 `sessionId` 对应 CLI 的选择条件。`requiredCapabilities`、`network` 和 `filesystemWrite` 是可选的路由要求。未明确选择 Environment 时，路由依次使用 Project 默认 Environment、唯一满足要求的候选；多个候选同时满足时返回 `409 AMBIGUOUS_ROUTE`，不会猜测。

成功的新请求返回 `202 Accepted`：

```json
{
  "run": {
    "id": "...",
    "status": "queued",
    "snapshot": {
      "routing": {
        "mode": "project_default",
        "environmentId": "claude-code-readonly",
        "engineId": "claude-code",
        "candidates": [],
        "explanation": "..."
      }
    }
  },
  "created": true,
  "eventsUrl": "/api/v1/runs/.../events"
}
```

`Idempotency-Key` 可放在 HTTP header 或 JSON 的 `idempotencyKey` 字段中；两者同时出现时必须相同。映射持久化在 SQLite 中，同一 key 和相同请求内容会返回已有 Run（`200`、`created: false`），跨服务重启仍然有效；同一 key 对应不同请求会返回 `409 IDEMPOTENCY_KEY_CONFLICT`。

## 事件流与重连

默认请求返回 JSON：

```text
GET /api/v1/runs/:runId/events
```

指定 `Accept: text/event-stream`（或 `?stream=sse`）可得到 SSE。每个事件的 `id` 是单个 Run 内严格递增的 `sequence`；使用 `?after=<sequence>` 可以在断线后只接收该序号之后的事件。

```text
GET /api/v1/runs/:runId/events?after=17
Accept: text/event-stream
Authorization: Bearer <api-token>
```

终态 Run 的 SSE 会回放符合 cursor 的历史事件后关闭连接。运行中的 Run 会保持连接，直到写入终态事件或客户端断开。

## 错误格式与边界

所有已知请求错误返回以下 JSON：

```json
{
  "error": {
    "code": "RUN_NOT_FOUND",
    "message": "Run \"...\" was not found."
  }
}
```

常见状态码包括：`400`（输入、JSON、查询参数错误）、`401`（缺少或无效 token）、`404`（资源不存在）、`406`（Agent 调用未声明 SSE）、`409`（幂等冲突、路由冲突、Session 已归档、Runtime 不匹配或 Run 不可取消）、`413`（请求体超过 64 KiB）、`415`（非 JSON 创建请求）、`429`（请求或 Run 并发达到上限）。路由错误的 `error.details.candidates` 会列出每个候选及拒绝原因。默认请求读取超时为 30 秒，默认最多同时管理 4 个 Run 和 32 个 HTTP 请求；可在嵌入 API 时通过服务选项调整。

API 仍然只监听回环地址，token 是同机进程边界的最小认证措施，不等价于 OS/容器沙箱，也未提供 TLS 或远程身份管理。不要通过端口转发、反向代理或防火墙规则把它暴露给其他主机。服务会对运行事件和 API 错误响应做 token 脱敏；SSE 客户端断开会释放连接配额，过慢且持续无法排空的连接会被关闭。

## 数据策略

SQLite 打开时可按 `storage.retentionDays` 清理超过期限的终态 Run；运行中或排队中的 Run 不会被保留策略删除。`storage.saveOutput` 设为 `false` 时，消息、工具参数/结果以及 stdout/stderr 不写入 SQLite，但状态、序号、时间和错误码仍保留。日志级别和额外脱敏键分别由 `logging.level` 与 `redaction.additionalKeys` 配置；默认敏感键和 Secret Resolver 返回值也会遮蔽。详见[配置参考](./configuration-reference.zh-CN.md)。

完整机器可读 schema 可通过带 Bearer token 的 `GET /api/v1/openapi.json` 获取，也保存在源码导出的 `openApiDocument` 中。健康检查同样需要认证。
