# 架构、组件与项目目录

先用日常语言理解 AgentDock：它把“要调用哪个 Agent”“Agent 用什么本机配置”“它在哪个项目里工作”“能读写什么”拆成独立配置，再由 CLI、API 或 DSH 插件提交任务。

## 配置对象分别是什么

| 对象 | 可以把它理解为 | 主要负责什么 |
| --- | --- | --- |
| Engine | 一种可执行 Agent Runtime | codex、claude-code 或内置 echo；描述 Adapter、命令和能力。 |
| Agent | 一个可供用户选中的工作身份 | 把 Engine、Environment 和 Permission 绑在一起，例如 codex-reviewer。 |
| Environment | Agent 自己的“家目录” | 隔离原生配置、状态和缓存；可由 AgentDock 管理，也可引用现有目录。它不是代码仓库工作目录。 |
| Project | Agent 要处理的项目位置 | rootDir 是实际工作目录；还规定允许使用哪些 Agent 和默认 Agent。 |
| Environment Permission | AgentDock 应用层策略 | 列出文件根目录、是否允许写入、环境变量和网络策略；不是 OS/容器沙箱。 |
| Session | 可复用的原生对话上下文 | 关联 Agent Engine 的原生会话 ID；不同 Session 用来隔离对话。 |
| Run | 一次任务执行记录 | 保存状态、事件和开始时冻结的配置快照，方便查看执行过程与历史。 |

对象关系可以简化为：

~~~text
Project ──限制可用 Agent / 提供默认项──> Agent
                                           ├──绑定──> Engine
                                           ├──绑定──> Environment
                                           └──绑定──> Permission

CLI / API / DSH ──选择 Project + Agent──> Run（冻结本次执行快照与事件）
                                              └──可引用/复用──> Session
~~~

## 一次任务经过哪些部分

~~~text
终端 CLI / Control Center / HTTP API / DSH 插件
                    │
          配置校验与路由（Agent / Project）
                    │
        Permission + Environment 就绪检查
                    │
      RunService / SessionService + 快照
                    │
       Runtime Registry → Adapter → Agent CLI
                    │
        Run / Session / 事件写入 SQLite
~~~

CLI 适合人手或 Shell 使用；本地 API 面向同机脚本、IDE、Control Center 和 DSH 插件。RunService 负责执行状态和事件，Adapter 把统一请求转换成各 Agent CLI 能理解的调用。历史 Run 不会因为后来修改当前配置而改变。

## 项目目录地图

~~~text
AgentDock/
├── package.json                 npm workspaces 和仓库级脚本
├── packages/
│   ├── core/
│   │   ├── src/                 AgentDock 核心 TypeScript 源码
│   │   ├── examples/            配置、Echo 和 API 客户端示例
│   │   └── dist/                core 构建产物；CLI 入口 cli.js
│   └── dsh/
│       ├── src/                 DeepSeek Harness 插件源码
│       └── dist/                插件打包产物
├── docs/                        设计、开发、配置、API 与发布文档
│   └── wiki/                    VitePress 中英文页面与网站配置
└── .agentdock/                  本机配置与运行数据，不是源代码
~~~

core 代码按职责分布如下：

| 目录 / 文件 | 作用 |
| --- | --- |
| packages/core/src/cli.ts | CLI 入口：解析命令并调用对应服务。 |
| packages/core/src/config/ | 配置 Schema、加载、校验、对象模型与安全编辑。 |
| packages/core/src/runtime/ | Agent Adapter、路由、Run、Session、健康检查和运行时诊断。 |
| packages/core/src/environment/ | managed/external Environment 目录、manifest、备份、漂移检查和恢复。 |
| packages/core/src/policy/ | 把 Agent、Project、Environment 和 Permission 解析成执行上下文。 |
| packages/core/src/api/ | 只监听本机回环接口的 HTTP API、认证、限流和配置路由。 |
| packages/core/src/web/ | 内置 Control Center 页面与浏览器端配置管理 UI。 |
| packages/core/src/storage/ | SQLite Run、事件、Session 和幂等键持久化。 |
| packages/core/src/secrets/ | 按 secret reference 从允许的来源解析敏感值。 |
| packages/dsh/src/ | DSH 插件后端、模型列表/调用适配器、API 客户端和 UI 扩展。 |
| .agentdock/ | 默认配置、Run 数据库、Token、Environment 控制文件和备份等本机数据。 |

运行 npm run build --workspace agentdock 会编译 core；npm run build 会同时构建 core 与 DSH。通常编辑 src/ 下源码，不直接修改 dist/。

## Run 状态与事件

Run 状态为 queued、running、succeeded、failed、cancelled 或 timed_out。事件在每个 Run 中使用严格递增的 sequence，记录状态、消息、工具调用/结果或错误。创建 Run 时会冻结 Agent、Engine、Environment、Permission、Project、工作目录和 Environment manifest/hash 等上下文。

如果你是第一次运行项目，请从[安装与快速上手](./getting-started)开始；想编辑对象则看[配置模型](./configuration)。
