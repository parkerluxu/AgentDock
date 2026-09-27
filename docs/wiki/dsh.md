# DeepSeek Harness（DSH）集成

AgentDock 提供一个可选的 **DeepSeek Harness（DSH）Web 插件**。DSH 是聊天宿主；AgentDock 插件把已启用的 AgentDock Agent 暴露到 DSH 模型选择器，并将当前会话消息路由到本机 Agent。它不是一个叫 ASH 的独立程序，也不会替你安装 Codex / Claude Code。

![AgentDock DSH 插件安装与运行流程图](/images/dsh/setup-flow.svg)

图中是按当前实现制作的操作示意图，不是用户机器的运行截图。需要逐命令 PowerShell 指南、profile 配置样例和故障排查时，参阅[完整 DSH 插件指南](https://github.com/parkerluxu/AgentDock/blob/main/docs/dsh-plugin.zh-CN.md)。

## 先认识组件

| 组件 | 职责 |
| --- | --- |
| AgentDock Core | 本机 API、Agent 路由和 Runtime 执行；配置文件的 `dataDir` 控制其数据库/Environment 数据。 |
| DSH Web | 聊天 UI、模型选择和 transcript。 |
| `@agentdock/dsh` | DSH adapter、AgentDock 模型列表、Settings → AgentDock 页面和会话绑定桥接。 |
| Agent Runtime | Echo / Codex CLI / Claude Code CLI 等真正执行任务的引擎。插件不负责安装或登录它们。 |

Echo 已随 AgentDock 提供，第一次可以只用 Echo 确认插件安装、Token 和 API 连通性；Echo 原样回显，不会生成模型答案。

## 最短安装路径

需要 Node.js `>=22.5`、npm 和 AgentDock 仓库。仓库根目录运行：

```powershell
npm ci
npm run build
npm pack --workspace @agentdock/dsh
npx @deepseek-ai/dsh plugin --profile web add -w .\agentdock-dsh-0.1.3-dev.tgz
npx @deepseek-ai/dsh --profile web --dump-config
```

把 `.tgz` 名称换成 `npm pack` 实际输出的文件名。`--profile web` 只选择 DSH 的 web profile；`--dump-config` 可在启动 UI 前确认配置中出现插件 `agentdock-dsh`，首次使用时也可能初始化缺失的 profile 文件。插件包从本仓库本地生成，不要求先发布 AgentDock core 包到 npm。DSH CLI 的 profile 与 plugin 命令语义见[官方 CLI 行为参考](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)。

## 配置 API 地址、Token 环境变量和配置文件

AgentDock API 与 DSH 是两个独立进程，须分别启动。以 Echo 示例为例，先在仓库根目录启动 API：

```powershell
$env:AGENTDOCK_API_TOKEN = [guid]::NewGuid().ToString('N')
Write-Host "请复制此临时 Token 到 DSH 的另一个终端：$env:AGENTDOCK_API_TOKEN"
node .\packages\core\dist\cli.js api serve --config .\packages\core\examples\config.quickstart.json --port 4177
```

保持该终端运行。编辑 DSH profile 的 `cordis.patch.yml`（默认在 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`；如果设置 `DSH_HOME`，则使用对应目录），新增以下完整插件条目：

```yaml
- id: agentdock-dsh
  name: '@agentdock/dsh'
  config:
    configPath: 'packages/core/examples/config.quickstart.json'
    apiBaseUrl: 'http://127.0.0.1:4177'
    apiTokenEnv: 'AGENTDOCK_API_TOKEN'
    bindingStorePath: '.agentdock/dsh-session-bindings.json'
```

字段含义：`configPath` 是 AgentDock JSON，按启动 DSH 的工作目录解析；`apiBaseUrl` 是本地 API 根地址，插件再补 `/api/v1`；`apiTokenEnv` 是 Token 的环境变量名，不是 Token 本身；`bindingStorePath` 保存会话绑定元数据，不是聊天记录。相同插件 ID 的 patch `config` 会整体覆盖默认配置；另外 `$DSH_HOME/cordis.patch.yml` 的机器级覆盖层优先级高于 profile 层。完整字段说明见[安装指南](https://github.com/parkerluxu/AgentDock/blob/main/docs/dsh-plugin.zh-CN.md#4-指定-agentdock-配置文件)。

在第二个从仓库根目录打开的 PowerShell 窗口中设置同一个 Token，再启动 DSH：

```powershell
$env:AGENTDOCK_API_TOKEN = '替换为 API 终端里显示的 Token'
npx @deepseek-ai/dsh web
```

Token 仅应留在这两个本机进程的环境变量中；不要写进 `cordis.patch.yml`、业务配置、Git 或公开截图。AgentDock API 只监听 `127.0.0.1`。

## 发送第一条消息

在 DSH 启动日志给出的本地 Web 地址打开页面。在模型选择器中选 `echo-agent`，发送一条短消息；Echo 原样返回即表示 DSH → 插件 → API → AgentDock 路由已连通。随后可把 `configPath` 与 API `--config` 一起改成你的真实配置，并选择对应的 Agent。

![DSH 会话路由到 AgentDock Agent 的示意图](/images/dsh/session-route.svg)

每个 DSH 会话各自映射到一个 AgentDock Session。DSH 负责聊天 UI / transcript，AgentDock 负责本机 Agent 调用；选择另一个 Agent 会改变该 DSH 会话的路由，不会混用不同 Agent 的原生上下文。

## Settings → AgentDock 页面

该设置页编辑 `configPath` 指向的 AgentDock 配置。**API URL、Token 环境变量名和绑定文件路径属于 DSH profile 配置，不属于 AgentDock 业务 JSON。**

![AgentDock DSH 设置页的结构标注示意图](/images/dsh/settings-annotated.svg)

1. `Config` 展示当前实际配置文件路径；路径不对时先修正 `configPath` / DSH 启动目录。
2. `Current DSH session` 可为当前聊天选择 Agent 和可选 Project，再手动 Bind/Update binding。通常模型选择器发送第一条消息会自动绑定，这里用于查看或修正当前绑定。
3. 数量卡片和标签页分别对应 Agents、Engines、Environments、Projects、Permissions。Agent 必须引用有效 Engine、Environment 和 Permission；只有启用的 Agent 会列入模型选项。
4. JSON 编辑器编辑当前分类的完整数组；新建对象时需要把模板 ID 与引用替换成真实值。
5. 先 Preview 检查校验、差异和高风险提示，再 Save。保存会产生备份；若提示需重启 API，运行时配置要重启后才会生效。下方 Backups 可恢复近期备份。

## 文件、会话和安全边界

- DSH transcript 仍由 DSH 保存；`.agentdock/dsh-session-bindings.json` 只保存 DSH 会话与 AgentDock Session 的映射。
- AgentDock SQLite、Run 和 Environment 文件由 AgentDock 配置的 `dataDir` 决定；不等同于 DSH profile 目录。
- Token 只从 `AGENTDOCK_API_TOKEN` 读取，避免保存在配置或 profile 里。
- loopback 监听让 API 仅供本机进程访问，但 AgentDock 的 Permission 是应用策略，不是 OS / 容器沙箱。

## 升级、移除和常见故障

相同版本号重新打包时，为避免旧前端 bundle 被复用，先从目标 profile 删除再添加：

```powershell
npx @deepseek-ai/dsh plugin --profile web remove -w @agentdock/dsh
npm pack --workspace @agentdock/dsh
npx @deepseek-ai/dsh plugin --profile web add -w .\agentdock-dsh-0.1.3-dev.tgz
```

完整卸载命令、配置路径细节和故障表见[完整 DSH 插件指南](https://github.com/parkerluxu/AgentDock/blob/main/docs/dsh-plugin.zh-CN.md)。排查顺序通常是：确认 API 仍运行 → 比对两个终端的 Token → 确认 DSH/API 指向同一配置 → 确认 Agent 已启用 → 若刚更新同版本包则重装并重启 DSH。
