# Local HTTP API and Control Center

The API base path is `/api/v1` and it listens only on `127.0.0.1` / `::1`.

## Start and authenticate

```text
node packages/core/dist/cli.js api serve --config packages/core/examples/config.example.json --port 4177
```

Use the generated `api-token` file, `--api-token`, or `AGENTDOCK_API_TOKEN`. Send `Authorization: Bearer <token>` with every request. The root path `/` (also `/ui/`) opens the Control Center.

## Main endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/health` | API health. |
| `GET` | `/api/v1/agent-health` | Cached read-only Agent health, drift, and Project bindings; never launches a Runtime or reads secret values. |
| `GET` | `/api/v1/openapi.json` | OpenAPI schema. |
| `GET` | `/api/v1/engines` | Engine list. |
| `GET` | `/api/v1/agents` | Callable Agent list and bindings. |
| `POST` | `/api/v1/agents/:agentId/invoke` | Invoke an Agent over one SSE connection (recommended). |
| `GET` | `/api/v1/environments` | Environment status and manifest. |
| `GET/POST` | `/api/v1/environment-templates` | List or create immutable config-only Environment templates. |
| `POST` | `/api/v1/environment-templates/:templateId/apply` | Create a new managed Environment from a template without login or runtime state. |
| `GET` | `/api/v1/projects` | Project list. |
| `PUT` | `/api/v1/projects/:projectId/agents` | Update the Agents allowed for a Project and its default Agent. |
| `GET` | `/api/v1/sessions` | Session list. |
| `POST` | `/api/v1/routing/preview` | Read-only route candidates and rejection reasons; never creates a Run. |
| `GET` | `/api/v1/runs` | Run list. |
| `POST` | `/api/v1/runs` | Create an asynchronous Run. |
| `GET` | `/api/v1/runs/:runId` | Run and immutable snapshot. |
| `GET` | `/api/v1/runs/:runId/events` | JSON history or SSE. |
| `POST` | `/api/v1/runs/:runId/cancel` | Request cancellation. |

## Invoke an Agent

For normal UI, script, and product calls, invoke the Agent directly instead of creating a Run and opening a second events request:

```text
POST /api/v1/agents/codex-reviewer/invoke
Accept: text/event-stream
Authorization: Bearer <api-token>
```

The JSON body requires `task` and may include `projectId`, `sessionId`, capability requirements, and policy requirements. The response sends an `accepted` event containing the Run ID and replay URL, followed by the standard sequenced Run events until a terminal status. The Agent's bound Environment is selected automatically, so `environmentId` is not accepted on this endpoint. Reconnect through the returned events URL with `after=<sequence>` when needed. Use `POST /api/v1/runs` for explicit asynchronous or batch semantics.

## Preview routing

Send the same JSON body accepted by Run creation to `POST /api/v1/routing/preview` before submitting a Run. This endpoint is always read-only: it returns `executes: false` and never creates a Run. `routing.candidates` includes every candidate's `agentId`, `accepted` result, and `reasons`; even an unroutable request returns a top-level `error` alongside explainable rejections. Resolve `ENVIRONMENT_RESCAN_REQUIRED` or `ENVIRONMENT_DIRECTORY_INVALID` before creating a Run.

## Agent health

`GET /api/v1/agent-health` is the Control Center's short-lived cached read model. It shows Engine configuration and Adapter registration, Environment manifest/drift, Permission summary, default Project bindings, recent Sessions/Runs, and recommended actions. It reads only local configuration, directories, and SQLite metadata: it never calls a native Runtime or resolves Secret References. `runtimeHealth: "unknown"` means no explicit probe has run; use `engine health <engine-id>` to check the binary version. The response always includes `isSecuritySandbox: false`.

## Create a Run and reconnect

`POST /api/v1/runs` requires `task`; `agentId`, `environmentId`, `projectId`, `sessionId`, capability requirements, network, and filesystem-write requirements are optional. A stable `Idempotency-Key` makes retries safe. Use `Accept: text/event-stream` or `?stream=sse` for events and `?after=<sequence>` after a disconnect.

The API returns structured errors under `error.code` and `error.message`. Default limits are 4 concurrent Runs, 32 HTTP requests, and a 64 KiB request body.

Session resume uses stable error codes: `SESSION_AGENT_MISMATCH`,
`SESSION_ENGINE_MISMATCH`, `SESSION_ENVIRONMENT_MISMATCH`, and
`SESSION_ARCHIVED` return HTTP `409`; `SESSION_NOT_FOUND` returns HTTP `404`.
The Node SDK exposes the API code as `AgentDockClientError.code`.
