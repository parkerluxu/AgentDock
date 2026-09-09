# 本地 HTTP API 与 Control Center

API 基础路径是 `/api/v1`，只监听 `127.0.0.1` / `::1`。它适合同机脚本、IDE 插件和 CI Runner，不提供局域网或公网监听。

## 启动

```text
node dist/cli.js api serve --config examples/config.example.json --port 4177
```

启动 JSON 包含 `apiBaseUrl`。未提供 `--api-token` 且未设置 `AGENTDOCK_API_TOKEN` 时，服务会在数据库同目录生成 `api-token` 文件并打印路径。显式 token 至少应为 16 个字符：

```powershell
$env:AGENTDOCK_API_TOKEN = "replace-with-a-long-local-token"
node dist/cli.js api serve --config examples/config.example.json --port 4177
```

每次请求都带：

```http
Authorization: Bearer <api-token>
```

根路径 `/`、`/ui` 和 `/ui/` 都打开内置 Control Center。页面支持中英文切换，可以查看 Engine、Environment、Project、Session、Run 和配置差异；配置保存后需要重启 API。

## 主要端点

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/v1/health` | API 自身健康检查。 |
| `GET` | `/api/v1/openapi.json` | OpenAPI 3 schema。 |
| `GET` | `/api/v1/engines` | Engine 列表。 |
| `GET` | `/api/v1/environments` | Environment 状态、manifest 和漂移信息。 |
| `GET` | `/api/v1/projects` | Project 列表。 |
| `GET` | `/api/v1/sessions` | Session 列表。 |
| `GET` | `/api/v1/runs?status=&projectId=&limit=` | Run 列表。 |
| `POST` | `/api/v1/runs` | 异步创建 Run。 |
| `GET` | `/api/v1/runs/:runId` | Run 与不可变 snapshot。 |
| `GET` | `/api/v1/runs/:runId/events` | 历史事件或 SSE。 |
| `POST` | `/api/v1/runs/:runId/cancel` | 请求取消 Run。 |
| `GET/POST/PUT` | `/api/v1/config...` | 配置读取、预览、保存和恢复。 |

完整端点、错误码和配置编辑协议见[API 参考](https://github.com/parkerluxu/AgentDock/blob/main/docs/api-reference.zh-CN.md)。

## 创建 Run

```powershell
$headers = @{
  Authorization = "Bearer $env:AGENTDOCK_API_TOKEN"
  "Content-Type" = "application/json"
  "Idempotency-Key" = "review-20260909-001"
}
$body = @{
  task = "审查当前仓库的测试失败原因"
  projectId = "agentdock"
  requiredCapabilities = @("execute", "stream_events")
  network = "deny"
  filesystemWrite = $false
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4177/api/v1/runs -Headers $headers -Body $body
```

成功请求返回 `202 Accepted`、`run.id` 和 `eventsUrl`。`task` 是唯一必填字段；`agentId`、`environmentId`、`projectId`、`sessionId` 用于约束路由。

## 事件流与重连

普通请求返回 JSON 数组：

```text
GET /api/v1/runs/<run-id>/events
```

指定 `Accept: text/event-stream` 或 `?stream=sse` 获取 SSE：

```text
GET /api/v1/runs/<run-id>/events?after=17
Accept: text/event-stream
Authorization: Bearer <api-token>
```

事件 `id` 是单个 Run 内严格递增的 sequence。客户端应保存最后确认的序号，断线重连时传给 `after`，并按 id 去重。终态 Run 回放完成后会关闭 SSE；运行中的 Run 会保持连接直到终态事件。

## 幂等、限流和错误

同一 `Idempotency-Key` 加相同请求内容会返回已有 Run；复用到不同请求会返回 `409 IDEMPOTENCY_KEY_CONFLICT`。默认最多同时管理 4 个 Run、32 个 HTTP 请求，请求体上限为 64 KiB。

错误体统一为：

```json
{
  "error": { "code": "RUN_NOT_FOUND", "message": "Run not found." }
}
```

常见状态码：`400` 输入错误、`401` token 错误、`404` 不存在、`409` 路由/幂等/Session 冲突、`413` 请求体过大、`415` 非 JSON、`429` 并发限制。
