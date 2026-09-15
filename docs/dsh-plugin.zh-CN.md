# AgentDock 的 DeepSeek Harness 插件

此插件把 **AgentDock 作为 DSH 的 Agent 后端**，而不只是配置编辑器。

DSH 继续负责聊天界面、消息记录和会话选择；AgentDock 负责选择及运行真正的 Codex、Claude Code 等本地 agent。每个 DSH 会话都能独立绑定到 AgentDock 中不同的 agent／项目，绑定信息会持久化在本机，因此切换 DSH 会话时不会串上下文。

## 工作方式

```text
DSH 当前会话 ── AgentDock DSH adapter ── AgentDock API ── 已绑定 agent ── Codex / Claude Code / …
       │                    │                    │
       └── DSH session id ──┴── 持久化映射 ───────┴── AgentDock native session id
```

在 **Settings → AgentDock → Current DSH session** 选择 agent（可选 Project），点击 **Bind session**。插件会将这个 DSH 会话的模型切换为 `agentdock/bound`；从下一条消息开始，该会话的每个用户回合都会流式转发到绑定的 AgentDock agent。首次调用会自动创建一个 AgentDock session，后续回合复用它，以保持底层 agent 的原生上下文。

可随时为另一个 DSH 会话绑定不同 agent；切换绑定目标时，插件不会复用旧 agent 的后端 session。解绑后请在 DSH 中手动选择其他模型，再发送下一条消息。

## 前置条件

1. 在 AgentDock 配置中准备好至少一个启用的 agent（其 engine 可指向 Codex、Claude Code 等）。
2. 启动本机 AgentDock API，并为 DSH 进程设置同一个 Bearer token：

```powershell
$env:AGENTDOCK_API_TOKEN = 'replace-with-a-long-random-token'
node .\dist\cli.js api serve --config .\.agentdock\config.json --port 4177
```

请从同一 PowerShell 窗口启动 DSH，或在其启动环境中设置 `AGENTDOCK_API_TOKEN`。Token 只从环境变量读取，绝不会写入 DSH profile、AgentDock 配置或会话绑定文件。

## 安装

在 AgentDock 仓库中构建并打包：

```powershell
npm ci
npm run build
npm pack
```

将生成的 `.tgz` 安装到 DSH Web profile：

```powershell
npx @deepseek-ai/dsh plugin --profile web add -w C:\path\to\agentdock-0.1.0-dev.tgz
npx @deepseek-ai/dsh --profile web --dump-config
npx @deepseek-ai/dsh web
```

`--dump-config` 应包含 `agentdock-dsh`。默认 patch 会连接 `http://127.0.0.1:4177`，并在 DSH 的当前工作目录下保存：

- AgentDock 配置：`.agentdock/config.json`
- DSH → AgentDock 会话绑定：`.agentdock/dsh-session-bindings.json`

插件自身的启动配置不通过 DSH GUI 保存；请在 DSH profile 的 `cordis.patch.yml` 覆盖。DSH 会按 `id` 替换整个 `config`，所以必须完整保留下面四个字段。以 Web profile 为例，文件通常位于 `C:/Users/<用户名>/.dsh/profiles/web/cordis.patch.yml`：

```yaml
- id: agentdock-dsh
  name: 'agentdock'
  config:
    configPath: 'D:/AI_agent/configs/production.json' # AgentDock 的业务配置，GUI 会编辑它
    apiBaseUrl: 'http://127.0.0.1:4177'
    apiTokenEnv: 'AGENTDOCK_API_TOKEN'
    bindingStorePath: '.agentdock/dsh-session-bindings.json'
    # 可选：已选择 agentdock/bound、但尚未手工绑定的会话会使用它。
    defaultAgentId: 'codex'
```

## 配置管理

同一页面也提供 Agent、Engine、Environment、Project 和 Permission 的配置管理。它编辑的是上面 `configPath` 所指向的 AgentDock 业务配置，不编辑 `apiBaseUrl`、`apiTokenEnv`、`bindingStorePath` 或 `defaultAgentId` 这些插件启动参数。保存前会执行 schema、引用及权限策略校验；变更会原子写入、自动备份并记录审计。运行中的 AgentDock API 如提示需要重启，请重启后再使用新配置。

## 卸载

```powershell
npx @deepseek-ai/dsh plugin --profile web remove -w agentdock
```

卸载不会删除 AgentDock 配置、后端 native session、SQLite 数据或绑定映射文件；如不再需要，可手动删除 `.agentdock/dsh-session-bindings.json`。
