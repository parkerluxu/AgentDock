# DeepSeek Harness 集成

AgentDock 可作为 DeepSeek Harness（DSH）的 Agent 后端。DSH 提供聊天 UI；AgentDock 负责把消息路由到本机已配置的 Agent。DSH 模型选择器会列出启用的 Agent，每个 DSH 会话拥有独立的 AgentDock Session。

## 插件安装流程

准备 Node.js >=22.5、npm、AgentDock 源码仓库和可运行的 DSH Web profile。真实模型执行还需要安装并登录 Codex 或 Claude Code 等 Agent CLI；只验证插件连通性可用内置 Echo。

在 AgentDock 仓库根目录打包，并安装到 DSH 的 web profile：

~~~powershell
npm ci
npm run build
npm pack --workspace @agentdock/dsh
npx @deepseek-ai/dsh plugin --profile web add -w .\agentdock-dsh-0.1.3-dev.tgz
npx @deepseek-ai/dsh --profile web --dump-config
~~~

使用 npm pack 实际打印的 tarball 文件名；版本变化时文件名也会变化。dump-config 中应包含 agentdock-dsh。插件包自包含，不会从 npm registry 下载未发布的 AgentDock core 包。

API 和 DSH 需要分开启动。终端 A 启动 AgentDock API 并设置随机本地 Token：

~~~powershell
$env:AGENTDOCK_API_TOKEN = [guid]::NewGuid().ToString('N')
$env:AGENTDOCK_API_TOKEN
node .\packages\core\dist\cli.js api serve --config .\.agentdock\config.json --port 4177
~~~

复制显示的 Token，在终端 B 设置相同值并启动 DSH：

~~~powershell
$env:AGENTDOCK_API_TOKEN = '粘贴终端 A 的 token'
npx @deepseek-ai/dsh web
~~~

从模型选择器选一个 AgentDock Agent 后发送消息即可。API 只监听 127.0.0.1；Token 只保留在两个进程环境中，不写进 profile 或业务配置。若用不同的业务配置文件，API 和插件的 configPath 都要指向该文件，可在 DSH profile 的 cordis.patch.yml 设置；匹配同一插件 ID 时要完整保留 configPath、apiBaseUrl、apiTokenEnv 和 bindingStorePath。具体 patch、升级、卸载步骤见[完整 DSH 插件指南](https://github.com/parkerluxu/AgentDock/blob/main/docs/dsh-plugin.zh-CN.md)。

Settings → AgentDock 页面可编辑 Agent、Engine、Environment、Project 和 Permission，并调整当前 DSH 会话绑定。它编辑 configPath 指向的业务配置；连接地址、Token 环境变量和绑定文件路径属于 profile 启动参数。

DSH 会在其启动目录下创建 .agentdock/dsh-session-bindings.json；AgentDock 数据库和 Environment 文件则使用业务配置中的 dataDir。
