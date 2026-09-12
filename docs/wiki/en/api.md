# Local HTTP API and Control Center

The API base path is `/api/v1` and it listens only on `127.0.0.1` / `::1`.

## Start and authenticate

```text
node dist/cli.js api serve --config examples/config.example.json --port 4177
```

Use the generated `api-token` file, `--api-token`, or `AGENTDOCK_API_TOKEN`. Send `Authorization: Bearer <token>` with every request. The root path `/` (also `/ui/`) opens the Control Center.

## Main endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/health` | API health. |
| `GET` | `/api/v1/openapi.json` | OpenAPI schema. |
| `GET` | `/api/v1/engines` | Engine list. |
| `GET` | `/api/v1/agents` | Callable Agent list and bindings. |
| `POST` | `/api/v1/agents/:agentId/invoke` | Invoke an Agent over one SSE connection (recommended). |
| `GET` | `/api/v1/environments` | Environment status and manifest. |
| `GET` | `/api/v1/projects` | Project list. |
| `PUT` | `/api/v1/projects/:projectId/agents` | Update the Agents allowed for a Project and its default Agent. |
| `GET` | `/api/v1/sessions` | Session list. |
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

## Create a Run and reconnect

`POST /api/v1/runs` requires `task`; `agentId`, `environmentId`, `projectId`, `sessionId`, capability requirements, network, and filesystem-write requirements are optional. A stable `Idempotency-Key` makes retries safe. Use `Accept: text/event-stream` or `?stream=sse` for events and `?after=<sequence>` after a disconnect.

The API returns structured errors under `error.code` and `error.message`. Default limits are 4 concurrent Runs, 32 HTTP requests, and a 64 KiB request body.
