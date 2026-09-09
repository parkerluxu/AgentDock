# API/SDK 迁移指南（v1）

本文面向从 CLI 直接调用、早期 API 第一切片或 Adapter SDK `0.1.x` 升级的使用者。当前 API 路径是 `/api/v1`，Adapter manifest 的 `agentDockApi` 是 `v1`。

## 从 CLI 调用迁移到 API

CLI 的 `run execute` 参数对应 API 的 `POST /api/v1/runs`：

| CLI | API JSON |
| --- | --- |
| `--environment <id>` | `environmentId` |
| `--project <id>` | `projectId` |
| `--session <id>` | `sessionId` |
| 任务文本 | `task` |
| 路由能力条件 | `requiredCapabilities` |
| 策略网络要求 | `network` |
| 是否写入文件 | `filesystemWrite` |

请求必须带 `Authorization: Bearer <token>` 和 `Content-Type: application/json`。需要重试的客户端应提供稳定的 `Idempotency-Key`；相同 key 和相同请求会返回原 Run，key 复用到不同请求会返回 `409 IDEMPOTENCY_KEY_CONFLICT`。

API 创建成功返回 `202`，随后从 `GET /api/v1/runs/{runId}/events` 读取历史 JSON 或 SSE。SSE 的 `id` 是 Run 内事件序号，断线后使用 `after=<最后确认的序号>`，客户端必须能处理重复连接而不能假定服务保留内存游标。

## 从 API 第一切片迁移

配置模型已经破坏性替换为 `engines`、`environments`、`environmentPermissions` 和 `projects[].environmentIds/defaultEnvironmentId`。旧 `runtimes/profiles/policies` 配置不会自动投影或兼容读取；迁移前请人工转换并校验。该变化不会删除 `.agentdock` 中的 SQLite、历史 Run 或 Agent 原生目录。

1. 将旧路径统一改为 `/api/v1`，不要依赖未版本化路径。
2. 对 `POST /runs` 保存并重用 `Idempotency-Key`，不要用 Run id 自行模拟幂等。
3. 处理 `202`、`200`（幂等重放）、`409`、`429` 和 `413`；错误体统一读取 `error.code` 与 `error.message`。
4. SSE 消费器只依据 `id` 去重，并在收到终态 `status` 或 `error` 后关闭连接。
5. 不把 Bearer token 写入任务、日志、导出或错误上报；API 只监听回环地址，token 不代表远程身份认证。

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
