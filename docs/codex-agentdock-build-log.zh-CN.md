# 使用 Codex 实现一个 AgentDock：从一个想法到可运行控制面的共同开发记录

> 这不是一篇把过程修饰成“从一开始就很顺利”的项目宣传稿。它记录的是一次真实的结对开发：先把问题讲清楚，再不断让代码、命令行输出和失败日志推翻我们过早的假设。
>
> 记录范围：项目立项至 Claude Code / Codex 的首轮真实联调通过。后续会随着 AgentDock 的 API、路由、Adapter SDK、团队试点和远程能力继续追加文章。

## 起点：不是再造一个 Agent，而是给 Agent Runtime 一个控制面

这个项目起于一个很具体的感受：Codex、Claude Code、OpenCode 等代码 Agent 都很强，但它们各自有二进制、认证、工作目录、权限、会话和输出格式。个人开发者在不同项目之间切换时，常常靠记忆和零散脚本维持秩序；团队则更难回答“这次到底用了什么 Runtime、什么权限、在哪个目录执行、出了问题如何追溯”。

最初的提问不是“能不能做一个聊天 UI”，而是：能否做一个统一入口，注册不同 Agent 工具的 Runtime 配置，在不同需求之间隔离环境，并管理 Session、状态和生命周期？这决定了 AgentDock 的定位：

```text
AgentDock = 多个 Agent Runtime 的本地优先控制面 / 调度器
```

它不重写 Claude Code 或 Codex 的推理过程，不做模型 API 网关，也不试图在第一个版本承担分布式工作流平台的职责。它负责的是把“调用一个 Agent 工具”变成一次有边界、可观察、可恢复、可解释的运行。

## 先把语言说清楚：核心概念不是数据库字段清单

在开发早期，我们花了不少时间讨论 `Runtime`、`Profile`、`Project`、`Policy`、`Session`、`Run`、`RunEvent` 和 `SecretReference` 到底分别代表什么。这段讨论非常重要，因为一开始最容易把 TypeScript 里的 interface 误解为“数据库里已经存在的表字段”。

实际上，它们先是领域对象——也就是系统用来描述现实问题的稳定名词。数据库、JSON 配置、CLI 输出和 HTTP API 都围绕这些名词实现，但不应该反过来决定概念本身。

| 概念 | 在 AgentDock 中的含义 |
| --- | --- |
| Runtime | 一个可启动的 Agent 工具实例，例如本机的 Claude Code 或 Codex CLI。它包含 binary、启动参数、版本、能力和启用状态。 |
| Adapter | Runtime 的“翻译层”。它把不同 CLI 的参数、输出、会话和错误转换为 AgentDock 的统一契约。 |
| Profile | 一套可复用的调用偏好：选择哪个 Runtime、应用哪个 Policy、带哪些 Runtime 专属 settings。 |
| Project | 一个工作单元，把代码目录、可用 Profile 和默认 Profile 关联起来。 |
| Policy | 对工作目录、环境变量、网络意图和写入意图的约束。当前是配置和执行前边界，不是假装已经完成 OS/容器级沙箱。 |
| Session | AgentDock 管理的连续上下文标识；必要时映射到 Runtime 原生 session ID。 |
| Run | 一次具体执行。它绑定任务、Profile、Project、Session，并固化本次 Runtime/Policy/执行上下文快照。 |
| RunEvent | Run 生命周期中的有序事件，如排队、运行、消息、工具调用、工具结果、错误和结束状态。 |
| SecretReference | 对密钥位置的引用，例如环境变量名；不是把密钥值写进配置。 |

这套边界后来让很多实现选择变得简单：配置可以换格式，SQLite 可以换 PostgreSQL，CLI 可以加 HTTP API，但一次 `Run` 的状态和证据链不应变得模糊。

## 技术取舍：先做本地控制面，而不是先做 UI 或云端

讨论中出现过 Next.js、TypeScript、SQLite、PostgreSQL 等选项。最终当前实现采用 Node.js + TypeScript + SQLite，而不是先引入 Web 框架或远程数据库。

- **TypeScript / Node.js**：这个系统的核心是编排 CLI、管理子进程、状态机、配置、事件和本地 API，而不是长时间占用 GPU 或做高吞吐数据计算。TypeScript 的类型约束很适合把 Adapter 契约、配置 schema 与状态转换固定下来。
- **SQLite**：首个目标是单机个人开发者的本地优先体验。SQLite 免服务、可迁移、便于导出和调试；Run/Event 这种追加写历史也很适配。PostgreSQL 不是被否定，而是留给以后确实需要多用户、远程 Worker、集中审计时再引入。
- **暂不做 UI**：统一 Runtime 调度还没验证前，先做 UI 只会把错误包装得更漂亮。CLI 与本地 API 能更快暴露真实问题，也更适合后续接入 IDE、脚本和 CI。

项目已经输出了需求分析和分阶段开发计划：阶段 0 验证 Adapter 与领域边界；阶段 1 建成本地 CLI 闭环；阶段 2 增加 API、路由和 SDK；团队治理和远程 Worker 则必须由真实需求触发，而不是提前堆砌。

## 开发不是从“大而全”开始的：按阶段切小切片

我们把第一阶段拆成几个可验证的切片，而不是直接写一个“万能执行器”。

### 阶段 0：规格与双 Adapter 骨架

先建立 TypeScript 工程、测试、配置 schema、领域类型、Run 状态机和 Adapter 契约。初期明确只适配 Claude Code 和 Codex——这是一次很主动的收缩。比起同时挂上很多 Runtime，先把两个行为差异很大的 CLI 跑通，更能检验抽象是否诚实。

这一阶段还记录了 Runtime 能力矩阵：是否支持 execute、流式事件、取消、创建/恢复 Session、健康检查，以及每个能力的版本依赖。它让“不支持”成为一种明确结果，而不是悄悄返回一个看似可用的空值。

### 阶段 1：本地调用闭环

随后逐步完成了：

1. `ProcessRunner`：统一启动子进程、收集 stdout/stderr、处理退出码、超时、AbortSignal 和 Windows `.cmd` shim。
2. `ClaudeCodeAdapter` 与 `CodexAdapter`：映射各自的非交互参数、流式 JSON 输出、权限/沙箱参数与会话参数。
3. 配置与策略解析：Zod 校验、Profile 继承、Project 默认 Profile、工作目录解析、环境变量白名单与环境变量 Secret Reference。
4. `run dry-run`：在调用模型前把最终 Runtime、Policy、目录和环境键名展示出来。
5. SQLite Run Store：保存 `sessions`、`runs`、`run_events`，启用 WAL 和外键，记录不可变快照与事件序号。
6. Run / Session 服务：创建、查询、归档、导出、退出码记录和 owner PID 崩溃恢复。
7. CLI：`runtime`、`profile`、`project`、`session`、`run`、`doctor` 等命令组。

此时一个关键设计得到落实：每一次状态变化与事件先写入存储，再由 CLI/API 观察。这样即使终端断开，也不至于只剩一段不可解释的屏幕输出。

### 阶段 2 的第一个切片：本地 API

在 CLI 闭环可用后，才开始暴露 HTTP API。当前 API 只允许监听 `127.0.0.1` 或 `::1`，支持：

- 创建 Run，并立即返回 `queued` 状态；
- 查询 Runtime、Session、Run 与历史事件；
- 请求取消由当前 API 进程管理的 Run；
- 用 SSE 订阅事件，并通过 `after=<sequence>` 断线续接；
- 使用 Bearer token、SQLite 持久化幂等键、请求体/超时/并发限制，并通过有界队列处理 SSE 背压。

这里仍然有一个有意保留的边界：没有远程监听、TLS、远程身份管理或 OS/容器级沙箱。回环监听和本地 token 是同机进程边界，不应被描述成完整的远程安全方案。

## 最有价值的部分：真实测试如何把隐藏假设拉到台面上

测试不是最后的“验收仪式”，而是项目设计的一部分。自动测试覆盖了状态机、配置、Policy、Secret、Adapter 参数、ProcessRunner、SQLite、Run/Session 与 API；而真正调用 Claude/Codex 的手工冒烟测试则只在明确执行时进行，避免日常回归消耗模型额度。

下面几次失败尤其值得保留，因为它们让项目从“看起来合理”变成“对真实 CLI 负责”。

### 1. `dataDir` 到底是目录，还是数据库文件？

第一次持久化后发现，配置写的是 `dataDir`，代码却把它直接作为 SQLite 文件路径。于是示例中的 `../.agentdock/data` 被创建成了名为 `data` 的数据库文件，而不是目录中的数据库。

这个问题没有靠删除旧文件粗暴解决。最终约定为：新版本使用 `<dataDir>/agentdock.db`；若旧路径已经存在且是普通文件，则继续把它作为旧式数据库读取。这个修复很小，但体现了控制面软件的一个朴素原则：历史 Run/Session 是用户的证据，不该因为重命名而消失。

### 2. Claude 的“新建 Session”不是“恢复 Session”

第一次运行 Claude Code 时，终端返回：

```text
No conversation found with session ID: ...
```

原因并不在 Claude 本身，而在我们的抽象过度简化了 Session。Adapter 为 Claude 分配了一个 UUID，却在第一次运行时把它当作已存在会话传给 `--resume`。Claude 当然找不到这段从未创建过的对话。

修复后，我们在 Adapter 契约中加入了 `sessionMode`：

- 新 UUID 是 `pending`，第一次 Run 使用 `--session-id <uuid>`；
- 首次成功后，Session 才标记为 `resumable`；
- 后续调用才使用 `--resume <uuid>`。

这次修复也改变了我们对 `resumable` 字段的理解：它不是“某个 CLI 理论上支持恢复”，而是“这个具体 Session 已经具备可恢复的原生上下文”。

### 3. Codex 的可信目录检查不是随机错误

在一个没有 Git 仓库元数据的目录中执行 Codex，得到的错误是：

```text
Not inside a trusted directory and --skip-git-repo-check was not specified.
```

这不是 AgentDock 的子进程失败，而是 Codex 有意拒绝在未受信任目录启动。处理方式也不应该偷偷绕过：我们把 `skipGitRepoCheck` 设计为 Profile 的显式 setting。示例的只读 Codex Profile 开启它，Adapter 才会加上 `--skip-git-repo-check`；普通配置不会默认绕过这个检查。

这也提醒我们：AgentDock 的 Policy 与 Runtime 自身的安全机制必须叠加，而不是相互覆盖。`read-only` sandbox 和跳过 Git 检查是两件不同的事。

### 4. Claude 的流式 JSON 还有一个看似细小的前提

修正 Session 后，Claude 又给出：

```text
When using --print, --output-format=stream-json requires --verbose
```

这是一条来自真实 CLI 的参数组合规则。Adapter 原来传了 `--print --output-format stream-json`，遗漏了 `--verbose`。补齐后，参数映射测试也随之更新。它再次说明：Adapter 不是简单地拼接字符串，而是 Runtime 特定行为的可测试知识库。

## 一次真实的人机协作：提问、解释、再回到代码

这段过程不只有代码。开发中反复出现“我不理解当前项目结构”“TypeScript 领域对象是什么意思”“为什么用 TypeScript 而不是资源型语言”“Adapter 是什么”的追问。它们并没有拖慢项目，反而迫使架构从“实现者脑中的默认前提”变成可以被审查的文字。

同样，用户在 PowerShell 中看到 `@{id=...; runtimeId=...}` 被截断时，问题并不在 API 返回缺字段，而在 PowerShell 默认把嵌套对象压缩显示。改用：

```powershell
$response | ConvertTo-Json -Depth 10
```

才能看到完整 Run 快照与事件。这样的小摩擦也值得写进教学记录：一个工具是否“好用”，往往不是只有核心算法或类型设计，而是用户拿到输出时能不能理解发生了什么。

## 当前可运行的能力

截至本篇记录，AgentDock 已有：

- Claude Code 和 Codex 的内置 Adapter、健康检查与参数映射；
- Runtime / Profile / Project / Policy 配置及继承/引用校验；
- 工作目录、环境变量白名单、Secret Reference 与 dry-run；
- Session / Run / RunEvent 的 SQLite 持久化、状态机、快照、导出与崩溃恢复；
- CLI 执行、查询、归档、诊断；
- 仅回环监听的 HTTP API、Run 提交/查询/取消和可重连 SSE；
- 17 个测试文件、48 个自动化测试，以及 `typecheck`、测试、构建通过。

推荐的安全测试顺序是：先 `config validate`、`doctor`、`run dry-run`，确认目录与策略；随后用只读提示词执行一个真实 Run；最后检查 `run show`、`run events` 与 Session 列表。真实模型调用不放进常规自动测试，避免把开发回归变成无意的额度消耗。

## 还没有做完的事，也不应该被含糊带过

当前版本不是生产级隔离平台。几个边界需要明确写出来：

- Policy 目前约束配置、工作目录和传入环境，尚未提供 OS/容器级文件、网络、命令强制沙箱；
- 本地 API 尚无远程监听、TLS、远程身份管理或完整的 OS/容器级隔离；token、跨重启幂等、限流和基本配额已实现；
- 第三方 Adapter 安装/manifest、Adapter SDK 仍在后续阶段；确定性 Profile 路由已完成首个切片；
- 远程 Worker、组织身份、集中审计与 RBAC 只有在团队试点确认重复需求后才进入实现；
- Node 内置 `node:sqlite` 仍会输出 ExperimentalWarning，当前不隐瞒也不无故压制它。

## 下一篇从哪里开始

接下来的记录会围绕三个方向展开：给本地 API 增加认证与请求边界；把“选哪个 Profile/Runtime”的决策解释清楚；抽取稳定的 Adapter SDK，让第三方 Runtime 不必修改核心仓库就能接入。

如果这条路线最终走到完整项目，它不应该被描述成“一个万能 Agent 平台”。更好的结果是：它成为一个足够诚实的控制面——知道自己能调度什么、拒绝什么、保存了什么证据，以及哪些安全承诺还没有能力兑现。
