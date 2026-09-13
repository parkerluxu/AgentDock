# 从任意 PowerShell 目录调用 CLI 与 SDK

本页说明如何在 PowerShell 当前目录不属于 AgentDock 源码目录时，继续调用 AgentDock CLI、Node.js SDK 和本地 HTTP API。

## 先区分几个“路径”

| 路径 | 含义 | 谁决定 |
| --- | --- | --- |
| PowerShell 当前目录 | 命令启动时所在的位置；不会自动成为 Agent 工作目录。 | 当前 Shell |
| CLI 入口 | AgentDock 构建后的 `dist/cli.js` 所在位置。 | 绝对路径、`npm link` 或 PATH |
| 配置文件路径 | 决定配置中的相对路径、`dataDir` 和 Environment 相对目录。 | `--config` |
| Project `rootDir` | Agent 实际执行任务时的工作目录。 | 配置中的 Project |
| Environment home | Agent 的 config/state/cache 和原生配置目录，不是项目工作目录。 | Agent 绑定的 Environment |

因此，单纯在 PowerShell 中执行 `cd D:/work/other-project`，不会覆盖已配置的 Project 工作目录。要使用其他路径，应创建或修改一个 Project 的 `rootDir`。

## 配置另一个工作目录

在配置的 `projects` 中加入一个 Project，并允许它调用目标 Agent：

```json
{
  "id": "other-project",
  "rootDir": "D:/work/other-project",
  "agentIds": ["new-agent"],
  "defaultAgentId": "new-agent"
}
```

Windows 路径也可以写成 `D:\\work\\other-project`。使用绝对路径时不依赖配置文件位置；相对路径则相对配置文件所在目录解析。

先验证解析结果，不启动真实 Agent：

```powershell
node "D:\AI_agent\cases\AgentDock\dist\cli.js" run dry-run `
  --config "D:\AI_agent\cases\AgentDock\examples\config.example.json" `
  --agent new-agent --project other-project hello
```

## 从任意目录运行 CLI

构建一次后，可以从任意 PowerShell 目录使用 CLI 的绝对入口和绝对配置路径：

```powershell
$repo = "D:\AI_agent\cases\AgentDock"
$config = "$repo\examples\config.example.json"
node "$repo\dist\cli.js" agent run new-agent --config $config --project other-project hello
```

也可以在源码目录执行一次 `npm link`，之后使用全局命令名：

```powershell
Push-Location "D:\AI_agent\cases\AgentDock"
npm link
Pop-Location

agentdock agent run new-agent `
  --config "D:\AI_agent\cases\AgentDock\examples\config.example.json" `
  --project other-project hello
```

在源码目录外运行时，不能依赖默认的 `.agentdock/config.json`，除非当前目录确实存在该配置；通常应显式传入 `--config`。完整 CLI 选项见 [CLI 使用手册](./cli)。

## 从任意目录使用 Node.js SDK

AgentDock SDK 的源码是 TypeScript，构建后是 ESM JavaScript，并生成 `.d.ts` 类型声明。它运行在 Node.js 中，使用 Node 22.5+ 内置的 `fetch`，不需要额外 HTTP 客户端库。

这里的 ESM 是 JavaScript 模块格式，使用 `import` / `export`；Node.js SDK 表示代码由 Node.js 进程执行。它不是 Python 包，也不是浏览器 SDK。Python、Go 等语言可以直接调用 [本地 HTTP API](./api)。

从其他 PowerShell 目录执行内联 SDK 程序时，用构建产物的绝对路径导入：

```powershell
$repo = "D:\AI_agent\cases\AgentDock"
$env:AGENTDOCK_SDK_ENTRY = "$repo\dist\index.js"
$env:AGENTDOCK_API_BASE = "http://127.0.0.1:4177/api/v1"
$env:AGENTDOCK_API_TOKEN = "replace-with-your-local-api-token"

node --input-type=module -e 'const {pathToFileURL}=await import("node:url"); const {AgentDockClient}=await import(pathToFileURL(process.env.AGENTDOCK_SDK_ENTRY).href); const client=new AgentDockClient({baseUrl:process.env.AGENTDOCK_API_BASE,token:process.env.AGENTDOCK_API_TOKEN}); const result=await client.agent("new-agent").run({projectId:"other-project",task:"hello"}); console.log(JSON.stringify({runId:result.runId,status:result.run.status},null,2));'
```

SDK 的 `projectId` 必须对应配置中的 Project；SDK 当前没有单次调用级别的 `cwd` 或 `workingDirectory` 参数。需要换目录时，增加 Project 并把 `rootDir` 指向目标目录。

`baseUrl` 是 API 服务地址，和 PowerShell 当前目录、Project `rootDir` 彼此独立。Token 只应通过环境变量或其他本地 secret 方式提供，不要提交到配置或源码。

## 调用前检查清单

1. 已在 AgentDock 源码目录执行 `npm run build`。
2. API 服务正在回环地址运行，或 CLI 使用本地 Runtime 直接执行。
3. `--config` 是正确的绝对路径。
4. Project 的 `rootDir` 是目标工作目录，且 `agentIds` 包含要调用的 Agent。
5. 先运行 `run dry-run`，确认输出的 `workingDirectory`、Agent、Environment 和 Permission。
