# Local API Client Example

这是一个零依赖的 Node.js 本地 API 调用示例。

This zero-dependency Node.js client invokes an Agent and consumes its complete SSE stream through one HTTP request. It uses Node 22's built-in `fetch` and does not contain a token in source code.

本示例使用 Node 22 内置的 `fetch`，通过一次 HTTP 请求调用 Agent 并消费完整 SSE 流；源码不保存 Token。See the [SDK guide](../../docs/sdk-client.zh-CN.md) and [API reference](../../docs/api-reference.zh-CN.md) for the reusable client contract.

[![local-api](https://img.shields.io/badge/local--api-DB2777?style=flat-square)](../../docs/wiki/api.md)
[![sse](https://img.shields.io/badge/SSE-9333EA?style=flat-square)](../../docs/sdk-client.zh-CN.md)
[![node.js](https://img.shields.io/badge/Node.js-22.5%2B-339933?style=flat-square)](https://nodejs.org/)
[![zero-dependency](https://img.shields.io/badge/zero--dependency-0F766E?style=flat-square)](client.mjs)

Start the local API in one terminal. For a deterministic run, configure and install [`../adapter-echo`](../adapter-echo/README.md) as the `example-echo` Runtime first; the standard config can instead use a locally installed Claude Code or Codex Runtime.

```text
node dist/cli.js api serve --config examples/config.example.json --port 4177
```

Read the generated `api-token` file path from the startup JSON, then run:

```text
set AGENTDOCK_API_TOKEN=<token>
set AGENTDOCK_PROJECT_ID=agentdock
set AGENTDOCK_AGENT_ID=codex-reviewer
node examples/api-client/client.mjs "inspect the current repository"
```

PowerShell uses `$env:AGENTDOCK_API_TOKEN`, `$env:AGENTDOCK_PROJECT_ID` and `$env:AGENTDOCK_AGENT_ID` for the environment variables. The client prints the `accepted` event first, then standard JSON Run events. It sends an `Idempotency-Key`; the accepted event supplies `eventsUrl`, which a production client can use with `after=<last-sequence>` to reconnect after a disconnect.
