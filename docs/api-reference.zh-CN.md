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

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/health` | API 服务自身的健康检查。 |
| `GET` | `/api/v1/openapi.json` | 获取当前 API v1 的 OpenAPI 3.0 schema。 |
| `GET` | `/api/v1/runtimes` | 配置中的 Runtime 描述符。 |
| `GET` | `/api/v1/sessions` | 本地 Session 列表。 |
| `GET` | `/api/v1/runs?status=&projectId=&limit=` | Run 列表；`status` 必须是有效的统一 Run 状态。 |
| `POST` | `/api/v1/runs` | 创建并异步执行一个 Run。 |
| `GET` | `/api/v1/runs/:runId` | 获取 Run 与不可变执行快照。 |
| `POST` | `/api/v1/runs/:runId/cancel` | 请求取消本 API 进程正在管理的 Run。 |
| `GET` | `/api/v1/runs/:runId/events` | 获取历史事件 JSON，或通过 SSE 订阅事件。 |

## 创建 Run

```http
POST /api/v1/runs
Content-Type: application/json
Authorization: Bearer <api-token>
Idempotency-Key: review-20260822-001

{
  "task": "审查当前仓库的测试失败原因",
  "projectId": "agentdock",
  "profileId": "claude-code-readonly",
  "requiredCapabilities": ["execute", "stream_events"],
  "network": "deny",
  "filesystemWrite": false
}
```

`task` 是唯一必填字段。`profileId`、`projectId` 和 `sessionId` 对应 CLI 的同名选择条件。`requiredCapabilities`、`network` 和 `filesystemWrite` 是可选的路由要求。未明确选择 Profile 时，路由依次使用 Project 默认 Profile、唯一满足要求的候选；多个候选同时满足时返回 `409 AMBIGUOUS_ROUTE`，不会猜测。

成功的新请求返回 `202 Accepted`：

```json
{
  "run": {
    "id": "...",
    "status": "queued",
    "snapshot": {
      "routing": {
        "mode": "project_default",
        "profileId": "claude-code-readonly",
        "runtimeId": "claude-code",
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

常见状态码包括：`400`（输入、JSON、查询参数错误）、`401`（缺少或无效 token）、`404`（资源不存在）、`409`（幂等冲突、路由冲突、Session 已归档、Runtime 不匹配或 Run 不可取消）、`413`（请求体超过 64 KiB）、`415`（非 JSON 创建请求）、`429`（请求或 Run 并发达到上限）。路由错误的 `error.details.candidates` 会列出每个候选及拒绝原因。默认请求读取超时为 30 秒，默认最多同时管理 4 个 Run 和 32 个 HTTP 请求；可在嵌入 API 时通过服务选项调整。

API 仍然只监听回环地址，token 是同机进程边界的最小认证措施，不等价于 OS/容器沙箱，也未提供 TLS 或远程身份管理。不要通过端口转发、反向代理或防火墙规则把它暴露给其他主机。服务会对运行事件和 API 错误响应做 token 脱敏；SSE 客户端断开会释放连接配额，过慢且持续无法排空的连接会被关闭。

完整机器可读 schema 可通过带 Bearer token 的 `GET /api/v1/openapi.json` 获取，也保存在源码导出的 `openApiDocument` 中。健康检查同样需要认证。
