# 从零理解 Cordis DSH 插件与 RPC

本文从最基础的 JavaScript `import` 开始，逐步说明 Cordis 插件是什么、DSH 如何自动加载 AgentDock、浏览器页面如何通过 RPC 调用宿主端，以及一条聊天消息如何最终交给 Codex 或 Claude Code。

## 1 插件的最小本质

先暂时忽略 Cordis、DSH 与 AgentDock。一个“插件”最初只是主程序从另一个文件导入并调用的一段代码。

```text
my-app/
  src/
    main.ts
    hello-plugin.ts
```

`hello-plugin.ts`：

```ts
export function apply(name: string) {
  console.log(`你好，${name}`);
}
```

`main.ts`：

```ts
import { apply } from "./hello-plugin.js";

apply("Luxu");
```

运行时没有自动扫描：

```text
main.ts 明确 import hello-plugin.ts
  ↓
取得 apply 函数
  ↓
main.ts 明确调用 apply("Luxu")
```

这里已经包含插件的最小原型：

- 主程序：`main.ts`
- 插件代码：`hello-plugin.ts`
- 插件入口：`apply()`
- 加载插件：`import`
- 启动插件：调用 `apply()`

Cordis 和 DSH 并没有改变这些基本事实；它们只是把“谁导入、谁调用、什么时候调用”统一成了一个框架协议。

## 2 Cordis 做的事情

实际应用常常有很多公共能力：日志、数据库、HTTP 服务、模型服务与会话管理。如果每个插件都自己创建这些能力，会产生重复和冲突。

```text
主程序统一创建服务
  ↓
把服务放进 ctx
  ↓
插件声明自己需要哪些服务
  ↓
Cordis 在服务准备好后启动插件
```

一个最小 Cordis 插件可以写成：

`hello-plugin.ts`：

```ts
import type { Context } from "@deepseek-ai/cordis";

export interface HelloConfig {
  name: string;
}

export const helloPlugin = {
  name: "hello",

  // 不依赖额外服务。
  inject: [],

  // Cordis 启动插件时会调用这里。
  apply(ctx: Context, config: HelloConfig) {
    ctx.logger("hello").info(`你好，${config.name}`);
  },
};
```

主程序：

```ts
import { Context } from "@deepseek-ai/cordis";
import { helloPlugin } from "./hello-plugin.js";

const ctx = new Context();

await ctx.plugin(helloPlugin, {
  name: "Luxu",
});
```

执行过程仍然很简单：

```text
1. main.ts 创建 ctx
2. main.ts 将 helloPlugin 交给 Cordis
3. Cordis 检查 helloPlugin.inject
4. inject 是 []，没有要等待的服务
5. Cordis 调用 helloPlugin.apply(ctx, { name: "Luxu" })
```

可以暂时把 Cordis 理解为：

> 一个负责管理插件启动顺序、依赖和清理的主程序助手。

## 3 inject 的含义

假设插件需要 HTTP 通信能力：

```ts
export const helloPlugin = {
  name: "hello",
  inject: ["connection"],
  apply(ctx, config) {
    ctx.connection.fetch.register(...);
  },
};
```

`inject: ["connection"]` 不是“导入一个叫 connection 的文件”。它的含义是：

```text
主程序，请在你已经提供 ctx.connection 后，再启动这个插件。
```

DSH 中的：

```ts
export const inject = ["connection", "llm", "sessionController"];
```

意思是 AgentDock 的宿主端插件需要 DSH 先提供：

| 服务 | 用途 |
|---|---|
| `connection` | 浏览器与 DSH 宿主的安全通信通道 |
| `llm` | DSH 模型 provider 注册表 |
| `sessionController` | 改变某个 DSH 会话当前使用的模型 |

只有这些服务可用后，Cordis 才调用 AgentDock 的 `apply()`。

## 4 从手动 Cordis 到 DSH 自动加载

在纯 Cordis 示例中，我们自己写：

```ts
import { helloPlugin } from "./hello-plugin.js";
await ctx.plugin(helloPlugin, { name: "Luxu" });
```

DSH 的差别是：DSH 的插件 loader 依据配置自动完成这两步。为了理解，可以将它想成下面的伪代码：

```ts
const pluginModule = await import("agentdock");

await ctx.plugin(pluginModule, {
  apiBaseUrl: "http://127.0.0.1:4177",
});
```

DSH 需要知道三件事：

```text
加载哪个 npm 包
插件实例叫什么
调用 apply(ctx, config) 时传什么配置
```

这正是 `package.json` 与 `cordis.patch.yml` 分别提供的信息。

## 5 Node 如何找到 agentdock 包

当 DSH 的 loader 执行：

```ts
await import("agentdock");
```

Node 会在插件已安装的位置寻找这个 npm 包。概念上的目录结构如下：

```text
某个 DSH profile 的插件安装目录/
  node_modules/
    agentdock/
      package.json
      dist/
        index.js
```

Node 读取 `agentdock/package.json`，根据其中的 `exports` 找包根入口：

```json
"exports": {
  ".": {
    "default": "./dist/index.js"
  },
  "./dsh": {
    "default": "./dist/dsh/host.js"
  },
  "./dsh/client": {
    "default": "./dist/dsh/client.js"
  }
}
```

因此：

```text
import "agentdock"
  ↓
读取 agentdock/package.json
  ↓
找到 exports["."]
  ↓
加载 dist/index.js
```

[src/index.ts](D:/AI_agent/cases/AgentDock/src/index.ts) 最后明确写着：

```ts
export { apply, inject } from "./dsh/host.js";
```

构建后，关系就是：

```text
dist/index.js
  ↓
导出 dist/dsh/host.js 的 apply 与 inject
  ↓
DSH/Cordis 调用 apply(ctx, config)
```

重点是：DSH 不会扫描或读懂 `src/dsh` 目录。`src` 只是开发源码；运行时执行的是 `dist` 中被包入口显式导出的 JavaScript。

## 6 package.json、cordis.patch.yml 与 dsh.tsdown.config.ts

| 文件 | 发生阶段 | 负责什么 |
|---|---|---|
| `package.json` | 安装、打包、模块解析 | 声明包名、入口、导出、文件清单和 DSH 元数据 |
| `cordis.patch.yml` | DSH 启动 | 声明加载哪个插件实例，以及默认配置 |
| `dsh.tsdown.config.ts` | `npm run build` | 将浏览器端 React/TypeScript 打包成 DSH 能加载的模块 |

### package.json 中的 dsh 字段

```json
"dsh": {
  "bundle": {
    "patch": "./cordis.patch.yml"
  },
  "client": {
    "platform": "web",
    "inject": [
      "@deepseek-ai/dsh-client-connection",
      "@deepseek-ai/dsh-client-ui-renderer",
      "@deepseek-ai/dsh-client-ui-session",
      "@deepseek-ai/dsh-client-ui-settings"
    ]
  }
}
```

它是 DSH 的插件元数据：

- `bundle.patch`：这个包附带默认 Cordis 配置补丁。
- `client.platform: web`：这个包还有浏览器端插件。
- `client.inject`：浏览器端会使用哪些 DSH 已有能力。

`files` 字段则保证 `npm pack` 生成 `.tgz` 时，`dist` 和 `cordis.patch.yml` 会被打进安装包。

### cordis.patch.yml 中的字段

```yaml
- insert:
    - id: agentdock-dsh
      name: "agentdock"
      config:
        configPath: ".agentdock/config.json"
        apiBaseUrl: "http://127.0.0.1:4177"
        apiTokenEnv: "AGENTDOCK_API_TOKEN"
        bindingStorePath: ".agentdock/dsh-session-bindings.json"
```

它近似等价于：

```ts
loadPlugin({
  id: "agentdock-dsh",
  module: "agentdock",
  config: { /* YAML 中的 config */ },
});
```

- `id`：这个插件实例的稳定身份；DSH profile 用它覆盖配置。
- `name`：要导入的 npm 包名。
- `config`：传给 `apply(ctx, rawConfig)` 的第二个参数。

### dsh.tsdown.config.ts 的作用

DSH 宿主运行在 Node.js；DSH 页面运行在浏览器。浏览器不能直接执行 Node 风格宿主插件，因此浏览器端 `src/dsh/client.ts` 必须单独打包。

```text
src/dsh/client.ts
  ↓ tsdown
dist/dsh/client.js
  ↓
DSH 浏览器模块加载器
```

配置中：

```ts
entry: { client: "src/dsh/client.ts" },
platform: "browser",
format: "cjs",
```

并通过 `banner` 和 `footer` 将输出包装为类似：

```js
window.__ModuleLoader__.load({
  id: "agentdock",
  factory: (require) => {
    // 编译后的 client.ts
    return module.exports;
  },
});
```

它只是浏览器端的构建配方；DSH 启动时不会直接读取 `dsh.tsdown.config.ts`。

## 7 AgentDock 宿主端插件启动时做什么

入口是 [src/dsh/host.ts](D:/AI_agent/cases/AgentDock/src/dsh/host.ts) 的：

```ts
export function apply(ctx, rawConfig) {
  const editor = new ConfigEditor(...);
  const gateway = new AgentDockGateway(rawConfig);

  // 注册 AgentDock LLM provider
  // 注册 DSH Connection 路由
}
```

它注册两种能力。

### 注册 LLM provider

```ts
ctx.llm.registerAdapter(
  ["agentdock"],
  new AgentDockLlmAdapter(gateway),
);
```

这使 DSH 知道：

```text
provider = agentdock
model = bound
```

`bound` 不是一个实际模型，而是“使用当前 DSH session 已绑定的 AgentDock agent”。

### 注册浏览器页面可调用的路由

```ts
connection.fetch.register({
  path: "/api/agentDock",
  methods: ["POST"],
  fetch: (request) => handleFetch(...),
});
```

它类似于 Web 服务中的：

```ts
app.post("/api/agentDock", handleFetch);
```

但这条路由不是 AgentDock 自己额外启动的 HTTP 服务，而是登记进 DSH 已有、带认证与请求校验的 Connection 通道。

## 8 浏览器端为什么需要 client.ts

两端职责不同：

| Node 宿主端 `host.ts` | 浏览器端 `client.ts` |
|---|---|
| 可读取环境变量、文件与本机配置 | 可使用 React、DOM、按钮和表单 |
| 注册 LLM provider 与 RPC 路由 | 向 DSH Settings 插入页面 |
| 可调用 AgentDock API | 不应直接取得 token 或写文件 |

`client.ts` 启动后调用：

```ts
ctx.slots.register(
  {
    name: "settings.section",
    id: "agentdock",
  },
  AgentDockSettings,
);
```

意思是：

```text
DSH 的 Settings 页面有一个名为 settings.section 的预留位置。
请将 AgentDockSettings React 组件放进去。
```

这就是 DSH Settings 中出现 AgentDock 页面的原因。

## 9 RPC 是什么

浏览器中的 `client.ts` 与 Node 中的 `host.ts` 不在同一个 JavaScript 进程中，因此浏览器不能直接 import 并调用宿主端函数。

```ts
// 浏览器中不能这样做
import { dispatch } from "./host.js";
dispatch(...);
```

需要经过请求：

```text
浏览器
  ↓ HTTP 请求
DSH Node 宿主
  ↓ 调用本地函数
返回 JSON
```

DSH 已提供标准通信服务 `connection`。浏览器端调用：

```ts
connection.rpc.call("/api", "agentDock", {
  endpoint: "backend/bind",
  payload: {
    sessionId: "dsh-1",
    agentId: "codex",
  },
});
```

可以先将它理解为：

```http
POST /api/agentDock
Content-Type: application/json

{
  "method": "agentDock",
  "rpcId": "rpc-123",
  "payload": {
    "endpoint": "backend/bind",
    "payload": {
      "sessionId": "dsh-1",
      "agentId": "codex"
    }
  }
}
```

完整路径：

```text
1. 浏览器页面中的 Bind 按钮被点击
2. client.ts 调用 connection.rpc.call(...)
3. DSH Connection 添加 rpcId、认证与请求封装
4. 请求到达 DSH Node 宿主的 /api/agentDock
5. host.ts 的 handleFetch() 验证请求
6. dispatch("backend/bind") 执行绑定逻辑
7. gateway.bind(...) 保存绑定
8. 返回成功 JSON 给浏览器
```

浏览器并不直接携带 token 调用 AgentDock API；token 保留在 DSH 宿主进程的环境变量中。

## 10 绑定会话后发生什么

用户在 Settings 中选择 AgentDock agent 与可选 Project，然后点击 Bind session。

```text
client.ts
  ↓ backend/bind RPC
host.ts dispatch()
  ↓
gateway.bind({ dshSessionId, agentId, projectId })
  ↓
保存 .agentdock/dsh-session-bindings.json
  ↓
sessionController.selectModel({ provider: "agentdock", model: "bound" })
```

绑定记录大致是：

```json
{
  "dshSessionId": "dsh-123",
  "agentId": "codex",
  "projectId": "workspace",
  "agentDockSessionId": "native-session-456",
  "updatedAt": "..."
}
```

绑定和创建底层 agent 原生会话是不同步骤：

```text
Bind session：DSH session → AgentDock agent
首次发送消息：AgentDock agent → AgentDock native session
```

切换到另一个 agent 时，插件不会复用旧 agent 的 `agentDockSessionId`，避免把不同 agent 的上下文串在一起。

## 11 一条聊天消息怎样到达 Codex

当当前 DSH 会话已被设置为 `agentdock/bound`：

```text
DSH 消息
  ↓
AgentDockLlmAdapter.stream()
  ↓
gateway.invoke()
  ↓ HTTP + SSE
AgentDock API
  ↓
RunService / Registry / ProcessRunner
  ↓
Codex 或 Claude Code CLI
```

`llm-adapter.ts` 从 DSH 的选项取得当前 `sessionId`，提取最新一条用户文本，然后调用 `gateway.invoke(dshSessionId, task)`。

`gateway.ts`：

1. 检查 DSH session 是否已绑定。
2. 没有 native session 时，调用 `POST /api/v1/sessions` 创建。
3. 调用 `POST /api/v1/agents/{agentId}/invoke`。
4. 通过 `Accept: text/event-stream` 接收 SSE 流。

AgentDock API 内部：

```text
LocalRunManager.start()
  ↓
resolveRoute() 选择 agent、engine、environment 与 permission
  ↓
RunService.execute()
  ↓
Registry 找到 CodexAdapter / Claude adapter
  ↓
ProcessRunner 启动 CLI 子进程
  ↓
EventParser 将 CLI 输出转换为 RunEvent
```

返回路径：

```text
Codex/Claude CLI 输出
  ↓
AgentDock RunEvent
  ↓ SSE
gateway.ts
  ↓
llm-adapter.ts 转为 DSH StreamChunk
  ↓
DSH UI 显示流式文本
```

## 12 三条链路不要混在一起

```text
A 启动链路：DSH 如何找到并启动插件
package.json → cordis.patch.yml → import agentdock → apply(ctx, config)

B 设置链路：浏览器如何请求宿主执行绑定
client.ts → DSH Connection RPC → host.ts → gateway.bind()

C 聊天链路：DSH 消息如何跑到 Codex
DSH LLM → llm-adapter.ts → gateway.ts → AgentDock API → Codex
```

AgentDock 看起来复杂，是因为同一个包同时参与了这三条链路；但每条单独看都是普通的模块加载、HTTP 通信和 API 调用。

## 最后总结

```text
Cordis：管理插件依赖、启动顺序与生命周期。
package.json：声明 npm 包入口和 DSH 插件元数据。
cordis.patch.yml：要求 DSH 启动时加载哪个插件实例，并传入什么配置。
host.ts：在 DSH Node 宿主中注册模型与 RPC 路由。
client.ts：在 DSH 浏览器页面中注册 Settings UI。
gateway.ts：从 DSH 宿主调用 AgentDock API。
llm-adapter.ts：把 AgentDock 流式事件翻译为 DSH 文本流。
AgentDock runtime：最终启动 Codex、Claude Code 等本地 agent。
```
