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
npm run build
$env:AGENTDOCK_API_TOKEN = 'replace-with-a-long-random-token'
node .\dist\cli.js api serve --config .\.agentdock\config.json --port 4177
```

Token 仅通过环境变量读取，不会写入 DSH profile、AgentDock 配置或会话绑定文件。默认 API 地址是 `http://127.0.0.1:4177`。

## 安装插件

```powershell
npm pack
npx @deepseek-ai/dsh plugin --profile web add -w C:\path\to\agentdock-0.1.0-dev.tgz
npx @deepseek-ai/dsh web
```

插件会在 DSH 当前目录下使用 `.agentdock/dsh-session-bindings.json` 保存 DSH → AgentDock session 映射。可在 profile 的 Cordis 配置覆盖 `apiBaseUrl`、`apiTokenEnv`、`bindingStorePath` 和 `defaultAgentId`；仓库根目录 `docs/dsh-plugin.zh-CN.md` 提供完整字段说明。

## 额外能力

同一 Settings 页面也能安全编辑 AgentDock 的 Agent、Engine、Environment、Project 和 Permission 配置；保存前会做策略校验、风险提示和备份。
