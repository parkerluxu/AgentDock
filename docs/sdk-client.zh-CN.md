# 本地 Agent 调用 SDK

`AgentDockClient` 是面向本地 HTTP API 的零额外依赖 Node.js SDK。它把“创建 Run、消费 SSE、断线重连、按 sequence 去重、读取最终 Run”封装成一次 Agent 调用。

```ts
import { AgentDockClient } from "agentdock";

const client = new AgentDockClient({
  baseUrl: "http://127.0.0.1:4177/api/v1",
  token: process.env.AGENTDOCK_API_TOKEN!,
});

const result = await client.agent("codex-reviewer").run({
  projectId: "agentdock",
  task: "审查当前改动",
  onEvent(event) {
    if (event.type === "accepted") console.log(`Run: ${event.payload.runId}`);
    else if (event.type === "message") console.log(event.payload.text);
  },
});

console.log(result.run.status, result.runId);
```

SDK 会为没有显式提供的调用生成一个 `Idempotency-Key`。初次 SSE 连接断开时，会用相同 key 重试调用；收到 `accepted` 后，则改为请求 `/runs/{runId}/events?after={lastSequence}`。重复或已确认的事件不会再次触发 `onEvent`。

`maxReconnects` 和 `reconnectDelayMs` 可以在构造客户端或单次 `run` 时覆盖。`AbortSignal` 会同时取消当前 HTTP 请求和等待中的重连。

SDK 只封装本地 Agent 调用，不读取或保存 secret；Bearer token 仅放入 HTTP `Authorization` 请求头。API 仍只应监听回环地址，Agent Environment 的目录约束也不是 OS/容器级安全沙箱。
