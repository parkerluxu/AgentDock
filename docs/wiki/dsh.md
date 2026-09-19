# DeepSeek Harness 集成

AgentDock 可以作为 DeepSeek Harness（DSH）的 agent 后端使用。DSH 继续提供聊天 UI、消息记录和会话切换；AgentDock 负责将每个会话路由到已配置的 Codex、Claude Code 或其他本机 agent。

## 会话绑定

安装插件后，打开 DSH 的 **Settings → AgentDock**。页面顶部的 **Current DSH session** 区域显示当前聊天会话；选择 AgentDock agent（可选 Project）并点击 **Bind session**。

绑定会将该 DSH 会话的下一次模型调用切换到 `agentdock/bound`。之后的用户消息流程是：

```text
DSH 会话 → AgentDock DSH adapter → 本机 AgentDock API → 已绑定 agent → Codex / Claude Code / …
```

每个 DSH session 都有独立的 AgentDock binding 和 AgentDock native session，因此不同 DSH 会话可使用不同 agent，且不会共享底层上下文。变更绑定目标会创建新的后端 session；解绑后，请在 DSH 中选择其他模型再发送消息。

## 启动条件

先构建 AgentDock，启动本机 API，并在 DSH 的启动环境中提供同一个 token：

```powershell
npm run build --workspace agentdock
$env:AGENTDOCK_API_TOKEN = 'replace-with-a-long-random-token'
node .\packages\core\dist\cli.js api serve --config .\.agentdock\config.json --port 4177
```

Token 仅通过环境变量读取，不会写入 DSH profile、AgentDock 配置或会话绑定文件。默认 API 地址是 `http://127.0.0.1:4177`。

## 安装插件

```powershell
npm run build --workspace @agentdock/dsh
npm pack --workspace @agentdock/dsh
npx @deepseek-ai/dsh plugin --profile web add -w C:\path\to\agentdock-dsh-0.1.3-dev.tgz
npx @deepseek-ai/dsh web
```

`@agentdock/dsh` 依赖独立发布的 `agentdock` 核心包。发布或安装 DSH 适配器前，须先提供兼容版本的核心包。

插件会在 DSH 当前目录下使用 `.agentdock/dsh-session-bindings.json` 保存 DSH → AgentDock session 映射。`apiBaseUrl`、`apiTokenEnv`、`bindingStorePath` 和 `defaultAgentId` 是插件启动参数，必须在 profile 的 `cordis.patch.yml` 修改，而不是 DSH GUI。该文件按 id 替换整个 config，因此覆盖时必须重述所有字段。Settings → AgentDock 编辑的是 `configPath` 指向的 AgentDock 业务配置。

## 额外能力

同一 Settings 页面也能安全编辑 AgentDock 的 Agent、Engine、Environment、Project 和 Permission 配置；保存前会做策略校验、风险提示和备份。
