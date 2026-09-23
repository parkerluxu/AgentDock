# AgentDock 的 DeepSeek Harness 插件

此插件把 AgentDock 接成 DSH 的 Agent 后端。DSH 继续提供聊天界面、消息记录和会话选择；AgentDock 负责把消息路由到已配置的本机 Agent。它不是单纯的配置编辑器。

DSH 模型选择器会列出启用的 AgentDock Agent。选择一个 Agent 并发送消息后，插件会为当前 DSH 会话创建独立的 AgentDock Session；之后的消息沿用该上下文。多个 DSH 会话不会共享底层对话。

## 先理解需要安装的东西

- AgentDock core：运行本机 API、管理 Agent 配置和执行任务。
- DSH 程序：提供聊天 UI。本指南通过 npx @deepseek-ai/dsh 调用。
- AgentDock DSH 插件：连接 DSH 和 AgentDock API 的适配器；从本仓库打包成一个本地 .tgz。
- Agent Runtime：例如 Codex CLI 或 Claude Code CLI。真实模型执行时需要另外安装；仅验证集成时可用内置 Echo。

## 前置条件

- Node.js >=22.5、npm，以及已检出的 AgentDock 仓库。
- DSH Web profile 能通过 npx @deepseek-ai/dsh 启动。
- AgentDock 配置中至少有一个启用 Agent。
- 真实执行需要先安装并登录对应的 Codex / Claude Code CLI；Echo 演示不需要模型服务。

若尚无默认配置，可从示例复制一份。下面只会在目标配置不存在时复制，不会覆盖已有文件：

~~~powershell
if (-not (Test-Path .\.agentdock\config.json)) {
  New-Item -ItemType Directory -Force .\.agentdock | Out-Null
  Copy-Item .\packages\core\examples\config.example.json .\.agentdock\config.json
}
~~~

## 打包并安装插件

在仓库根目录运行：

~~~powershell
npm ci
npm run build
npm pack --workspace @agentdock/dsh
npx @deepseek-ai/dsh plugin --profile web add -w .\agentdock-dsh-0.1.3-dev.tgz
npx @deepseek-ai/dsh --profile web --dump-config
~~~

npm run build 会构建 core 和 DSH。npm pack 输出当前版本的插件 .tgz；如果 package 版本变了，以 npm 打印的实际文件名为准。--dump-config 输出中应包含 agentdock-dsh。这个单一插件包已包含运行所需的 AgentDock 控制面代码，不会从 npm registry 下载未发布的 core 包。

如果你的配置不是仓库根目录的 .agentdock/config.json，先记下它的路径，稍后需要在 DSH profile 配置中填写 configPath。

## 启动 API 和 DSH

API 和 DSH 是两个独立进程。先在终端 A 中启动 AgentDock API，并创建一个只放在当前终端环境里的随机 token：

~~~powershell
$env:AGENTDOCK_API_TOKEN = [guid]::NewGuid().ToString('N')
$env:AGENTDOCK_API_TOKEN
node .\packages\core\dist\cli.js api serve --config .\.agentdock\config.json --port 4177
~~~

复制终端 A 显示的 token。在仓库根目录打开终端 B，设置同一个 token 后启动 DSH：

~~~powershell
$env:AGENTDOCK_API_TOKEN = '粘贴终端 A 的 token'
npx @deepseek-ai/dsh web
~~~

打开 DSH 页面，在模型选择器中选一个 AgentDock Agent 并发送消息。Token 通过进程环境变量提供，不会写入 DSH profile、AgentDock 配置或会话绑定文件。AgentDock API 只监听 127.0.0.1，不会对局域网或公网开放。

若先用 Echo 入门配置验证插件连通性，API 命令和 DSH 的 configPath 都要指向 packages/core/examples/config.quickstart.json。Echo 只会原样返回输入，不会生成模型回答。

## 非默认配置路径

插件默认读取工作目录下的 .agentdock/config.json。如果你的配置放在其他位置，需要编辑当前 DSH profile 的 cordis.patch.yml。以 Web profile 为例，通常位于 C:/Users/<用户名>/.dsh/profiles/web/cordis.patch.yml。匹配到插件 ID 后，DSH 会用 patch 中的 config 完整替换原配置，因此不要遗漏下面字段：

~~~yaml
- id: agentdock-dsh
  name: '@agentdock/dsh'
  config:
    configPath: 'D:/path/to/AgentDock/.agentdock/config.json'
    apiBaseUrl: 'http://127.0.0.1:4177'
    apiTokenEnv: 'AGENTDOCK_API_TOKEN'
    bindingStorePath: '.agentdock/dsh-session-bindings.json'
    # 可选：兼容尚未手工绑定的旧会话
    defaultAgentId: 'codex-reviewer'
~~~

API 启动时也必须使用同一份 configPath。Settings → AgentDock 编辑的是 configPath 指向的 AgentDock 业务配置；apiBaseUrl、apiTokenEnv、bindingStorePath 和 defaultAgentId 属于插件启动参数。

DSH 会在启动目录下创建 .agentdock/dsh-session-bindings.json 保存 DSH 会话与 AgentDock Session 的映射。AgentDock 配置、数据库和 Environment 数据的位置则由配置文件中的 dataDir 决定。

## 在 DSH 中管理 Agent

模型选择器负责选择一个启用的 Agent；发送第一条消息时，插件会自动建立当前 DSH 会话到该 Agent 的绑定。Settings → AgentDock 页面可管理 Agent、Engine、Environment、Project 和 Permission，也可查看并调整当前会话绑定。保存业务配置前会进行校验、差异预览和备份。页面编辑的是 configPath 指向的 AgentDock 配置；连接地址和 Token 环境变量等插件启动参数仍需放在 DSH profile 的 cordis.patch.yml。

## 本地升级

以相同版本号重新打包时，先移除当前 profile 中的旧插件，再添加新 tarball；否则 DSH 可能继续使用已展开的旧前端 bundle：

~~~powershell
npx @deepseek-ai/dsh plugin --profile web remove -w @agentdock/dsh
npx @deepseek-ai/dsh plugin --profile web add -w .\agentdock-dsh-0.1.3-dev.tgz
~~~

如果 --dump-config 显示重复的 agentdock-dsh 条目，且确认存在旧开发版 core tarball 安装记录，再移除旧条目 agentdock 并重新添加当前 DSH tarball。不要在没有重复条目时移除其他插件。

## 卸载

~~~powershell
npx @deepseek-ai/dsh plugin --profile web remove -w @agentdock/dsh
~~~

卸载插件不会删除 AgentDock 配置、SQLite 历史、本机 Agent 原生会话或 DSH 绑定文件。确认不再需要后，可单独备份并清理这些本地数据。
