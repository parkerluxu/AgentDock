# AgentDock 需求分析与分阶段路线图

> 版本：v0.1（需求基线 + 实施状态）  
> 日期：2026-08-26
> 定位：面向开发者与工程团队的本地多 Agent 配置环境管理平台。

> 2026-09-02 决策：Agent Engine、Agent Environment、Environment Permission 是唯一配置模型。旧 `runtimes/profiles/policies` 配置不再兼容读取；`.agentdock` 中已有 SQLite、历史 Run 和 Agent 原生目录必须保留。

## 当前实施状态

本需求文档描述完整项目目标；它不意味着所有功能已经完成。当前实现以[开发计划的状态表](./development-plan.zh-CN.md#当前实施状态)为准：阶段 0 已完成，阶段 1 核心闭环已完成，阶段 2 的功能开发和确定性集成回归已完成，Beta 发布验收仍在进行；阶段 3 的 Web 控制台和旧配置编辑第一版已完成，新的 Agent Environment 模型、原生配置目录维护、Project 绑定和 Environment 级 snapshot 正在进入开发。

## 产品分级

AgentDock 的核心不是一个供多人共享的中央配置中心，而是一个本地维护多个 Agent 配置环境的平台。每个使用者可以在自己的机器上维护自己的 Engine、Environment 和 Project 绑定；后续如出现团队协作或远程执行的重复需求，再在此模型之上扩展。

| 层级 | 核心对象 | 作用 | 当前对应概念 |
| --- | --- | --- | --- |
| 1 | Agent Engine | 实际 Agent 引擎与 Adapter，负责二进制、版本、能力和健康检查 | Runtime + Adapter |
| 2 | Agent Environment | 一套可使用的 Agent 配置环境，包含原生配置目录、状态/缓存目录、启动参数、权限和 Secret Reference | Profile + Policy 的配置组合 |
| 3 | Project / Workspace | 工作目录，以及允许使用哪些 Environment 和默认 Environment | Project |
| 4 | Session / Run | 一次会话和执行记录，保存执行时 snapshot | Session + Run |

Agent 原生配置目录可以作为 Environment 的事实来源。AgentDock 管理目录的引用、生命周期、hash/rescan、备份和恢复，但不强行把每种 Agent 的全部配置字段重新建模。`stateDir`、`cacheDir`、登录缓存、历史 session 和明文 secret 必须与可共享配置区分；配置目录也不等价于 OS/容器级安全沙箱。

## 1. 背景与问题

以 Codex、OpenCode、Claude Code、Aider 为代表的 Agent 工具，在模型接入、认证方式、配置格式、工作目录、会话存储和执行权限方面存在明显差异。开发者需要在多个 CLI、配置文件及会话历史间切换；团队则缺少统一的执行记录、环境隔离和可复现机制。

现有工具通常只解决以下问题中的一部分：

- 单一厂商或单一 Agent 的调用；
- LLM API 网关或模型路由；
- 通用工作流编排；
- 容器化开发环境。

AgentDock 的切入点不是重新实现 Agent，也不是只代理模型 API，而是将不同 Agent Runtime 注册为标准化的可调用能力，并统一处理路由、隔离、会话和执行记录。

## 2. 产品目标与边界

### 2.1 产品目标

1. 让用户通过统一 CLI 和本地 API 调用不同 Agent Runtime。
2. 让每一次 Agent 执行具有明确的项目、工作目录、凭证引用、权限策略和会话归属。
3. 支持项目、任务或用户维度的环境隔离，降低配置和上下文互相污染的风险。
4. 将 runtime、会话和执行记录以可导出、可审计的方式持久化。
5. 为第三方 Runtime 提供稳定、低门槛的 Adapter SDK 与能力声明机制。

### 2.2 非目标

- 不在首版实现模型训练、向量知识库或通用 RAG 平台。
- 不替代 Claude Code、Codex 等工具内部的推理、工具调用或提示词策略。
- 不在 MVP 构建可视化工作流编排器、Agent 市场或跨云分布式调度。
- 不承诺不同 Runtime 的会话可无损互转；首期仅统一会话元数据和执行历史。
- 不将用户的 API Key、Token、完整提示词或源码默认上传到第三方服务。

## 3. 目标用户与核心场景

| 用户 | 典型诉求 | 首期价值 |
| --- | --- | --- |
| 重度个人开发者 | 为不同项目切换 Claude Code、Codex 等工具，不想手工维护多套配置 | 一条命令选择 runtime、profile 与项目环境 |
| 技术负责人 | 约束团队 Agent 的权限、版本和可追溯性 | 共享配置模板、策略检查、统一执行记录 |
| 平台/DevOps 工程师 | 将 Agent 接入本地自动化或 CI | 稳定 API/CLI、机器可读事件和非交互模式 |
| Runtime/工具作者 | 让自己的 Agent 被统一平台接入 | Adapter SDK、能力声明、测试契约 |

核心场景：

1. **按任务路由**：用户请求“修复测试”时，选择适合代码修改的 Runtime/Profile；请求“代码审查”时，选择只读权限的 Runtime/Profile。
2. **按项目隔离**：同一台机器上的两个项目使用不同工作目录、环境变量、凭证引用和会话空间。
3. **连续会话**：用户可列出、恢复、归档某个 runtime 的会话，并关联到具体项目与任务。
4. **可审计执行**：每次运行可查询输入摘要、runtime/version、策略决策、状态、耗时、资源引用和输出位置。
5. **自动化调用**：脚本/CI 以无交互方式发起任务，读取结构化状态和事件流。

## 4. 核心概念与领域模型

| 概念 | 说明 | 示例 |
| --- | --- | --- |
| Runtime | 可被 AgentDock 启动或调用的 Agent 工具实现 | `claude-code`、`codex-cli` |
| Adapter | 将 runtime 的配置、启动、事件和会话操作适配为统一契约的插件 | `@agentdock/adapter-claude-code`、`@agentdock/adapter-codex` |
| Profile | 一个可复用的 runtime 配置实例，不保存明文密钥 | `codex-review-readonly` |
| Project | 与代码目录、默认策略和可用 profile 关联的工作单元 | `billing-service` |
| Session | 一段连续任务上下文的逻辑标识，包含本地元数据及 runtime 原始引用 | `ses_...` + runtime session ID |
| Run | 一次具体执行，绑定 profile、project、session 和策略快照 | `run_...` |
| Policy | 对目录、网络、命令、工具和凭证暴露范围的约束 | `readonly-local` |
| Secret Reference | 指向操作系统凭证库、环境变量或外部 secret provider 的引用 | `keychain://openai/work` |

关系约束：一个 `Run` 必须关联一个 `Profile`；可选关联一个 `Project` 与 `Session`；执行时固化 `Policy` 快照。`Profile` 只能保存 `Secret Reference`，不得保存明文凭证。

## 5. 功能需求

### 5.1 Runtime 与 Adapter 管理

- 注册、查看、校验、启用和禁用 Runtime。
- Runtime 配置应声明：标识、版本、启动方式、二进制路径/远端端点、支持能力、配置 schema。
- Adapter 统一提供：健康检查、会话创建/恢复、任务执行、取消执行、事件映射、错误映射和版本探测。
- 支持内置 Adapter 与本地安装的第三方 Adapter；第三方 Adapter 必须经 manifest 声明权限和兼容版本。
- 初始内置适配目标：Claude Code 与 Codex CLI。OpenCode 和其他工具以 Adapter SDK 接入，不以核心代码硬编码。

### 5.2 Profile、项目与环境隔离

- Profile 支持继承全局默认值，并被 Project 覆盖或引用。
- 可配置工作目录白名单、环境变量白名单、挂载/文件访问范围、网络策略、超时和并发限制。
- 每个 Run 使用独立的临时目录、日志目录和运行上下文；清理策略可配置。
- 默认采用“最小权限”：未显式授权时不允许越过项目根目录、读取无关凭证或使用高风险工具。
- 需要支持 `dry-run`，输出解析后的 runtime、policy、工作目录和环境变量键名，不执行 Agent。

### 5.3 统一调用接口

- 提供 CLI：`runtime`、`profile`、`project`、`session`、`run` 五组命令。
- 提供仅监听回环地址的本地 HTTP API；API 采用版本化路径、JSON 请求响应和 SSE/NDJSON 事件流。
- 调用请求至少包括：任务文本、profile（或路由条件）、project、session（可选）、执行模式和幂等键（可选）。
- 支持显式选择 profile，以及基于能力、策略、可用性和优先级的简单路由。
- 输出统一的状态：`queued`、`running`、`succeeded`、`failed`、`cancelled`、`timed_out`；同时保留原始 runtime 状态和错误详情。

### 5.4 Session 与执行记录

- 列出、检索、恢复、归档和删除本地 session 元数据。
- 保存 session 到 runtime 原始 session 的映射；当 Runtime 不支持恢复时，明确标记为不可恢复而非伪造恢复能力。
- Run 记录应保存不可变的配置/策略快照、事件时间线、退出状态、输出索引和关联 artifacts。
- 默认脱敏敏感字段；提示词和工具输出是否保存应由配置与策略决定。
- 提供 JSONL/JSON 导出，方便迁移、调试与 CI 留档。

### 5.5 凭证与安全

- 凭证值通过 OS Keychain、环境变量或可插拔 Secret Provider 解析；日志、导出和 API 响应一律遮蔽。
- 本地 API 默认不对局域网暴露；若启用远程监听，必须配置认证、TLS 终止说明和显式风险提示。
- Adapter 在启动前声明所需权限，AgentDock 负责根据 Policy 拒绝或授权。
- 高风险行为（项目外写入、网络访问、执行 shell、读取新增 secret）应产生可查询的策略事件。
- 不实现绕过 Runtime 自身安全策略的能力；以更严格的一方为准。

### 5.6 可观测性与运维

- 提供结构化日志、运行事件、耗时和状态计数。
- 关键操作具备可关联的 `project_id`、`session_id`、`run_id` 与 `trace_id`。
- 提供诊断命令，检查 Adapter、二进制依赖、配置 schema、secret 引用和目录权限。
- 用户可配置数据保留期限、日志级别与本地存储路径。

## 6. 非功能需求

| 维度 | 要求 |
| --- | --- |
| 本地优先 | MVP 不依赖云端控制服务；离线时仍可使用已安装 Runtime。 |
| 可扩展性 | 核心不应依赖某一个 Agent 厂商；Adapter 契约需进行契约测试。 |
| 可移植性 | 首版至少支持 macOS/Linux；Windows 支持应纳入 Beta 验证并明确 shell/路径差异。 |
| 可靠性 | 进程异常退出后，Run 不能永久卡在 `running`；启动时执行恢复标记。 |
| 性能 | 控制面自身不应成为瓶颈；本地指令解析与任务提交目标 P95 小于 300 ms（不含 Runtime 启动）。 |
| 数据完整性 | 运行记录以追加写方式持久化；配置变更不修改历史 Run 快照；配置保存采用原子写入并支持失败回滚。 |
| 易用性 | 新用户应能在 10 分钟内完成一个内置 Runtime 的发现、注册、诊断和首次执行。 |
| 兼容性 | 明确记录 Adapter 兼容的 Runtime 版本范围，不承诺未测试版本。 |
| 配置编辑安全 | Web 看板只允许编辑 Secret Reference，不读取或保存明文 secret；写入、网络、shell 等高风险变更需要二次确认。 |
| 配置生效 | 配置保存后对安全变更自动热加载；数据目录切换等无法安全切换的情况明确返回重启提示。 |

## 7. MVP 需求优先级

| 优先级 | 范围 | 说明 |
| --- | --- | --- |
| P0 | `[x]` 本地配置、Runtime 注册、Claude Code/Codex Adapter、CLI 调用、Run 记录、基础 Session 映射 | 已形成可运行闭环；Claude 首次 Session 创建与后续恢复已验证。 |
| P0 | `[~]` Project 工作目录隔离、环境变量白名单、Secret Reference、策略预检 | 配置边界已实现；OS/容器级文件、网络、命令沙箱尚未实现。 |
| P1 | `[~]` 本地 HTTP API、事件流、简单路由、导入导出、诊断工具 | API、SSE、导出、doctor、最小 Bearer 认证、OpenAPI 和确定性路由已有；完整远程身份认证尚未实现。 |
| P1 | `[~]` Adapter SDK、manifest、契约测试、第三方 Adapter 安装 | 公共契约、manifest、Echo Adapter、契约测试和本地安装/启停/卸载已实现；远程安装和 OS 级隔离尚未实现。 |
| P2 | `[~]` 本地多 Agent 配置环境、Web 管理界面、原生配置目录维护 | Engine/Environment/Permission 模型、目录生命周期、Project 绑定、配置 hash/rescan、Environment CRUD/复制/导入/备份恢复和 Run snapshot 已实现。团队模板、CI、RBAC、远程 Engine 延后。 |
| P3 | 跨机器调度、云托管控制面、复杂工作流编排、计费/配额 | 属于独立产品线，不进入早期核心。 |

## 8. 分阶段计划

### 阶段 0：技术验证与规格冻结（2-3 周） `[x]`

**目标**：验证统一 Adapter 抽象可覆盖至少两个 Runtime，冻结 MVP 的本地数据模型和配置格式。

交付：

- `[x]` 编写 Adapter 契约草案，完成 Claude Code、Codex CLI 的能力矩阵。
- `[x]` 建立最小领域模型和本地存储原型，验证 session/run 映射。
- `[x]` 明确配置 schema、错误分类、事件格式和安全默认值。
- `[x]` 发布架构决策记录（ADR）与两个 Runtime 的冒烟测试样例。

验收：同一条“读取仓库并给出摘要”的任务可以通过两个 Adapter 发起，且均可得到统一 Run 状态与原始输出引用。

### 阶段 1：MVP - 本地统一入口（4-6 周） `[~]`

**目标**：让个人开发者稳定地注册并调用 Claude Code/Codex，按项目隔离环境并保留执行历史。

交付：

- `[x]` `agentdock` CLI 与文件化配置。
- `[x]` Runtime 发现/注册/健康检查；Claude Code 与 Codex 内置 Adapter。
- `[x]` Profile、Project、Policy（目录与环境变量白名单）和 Secret Reference。
- `[x]` 创建/恢复/归档 Session 元数据，提交、查看、取消 Run。
- `[~]` 结构化本地事件、JSON 导出、`doctor` 诊断命令已完成；完整快速开始、跨平台稳定性和发布文档仍在收尾。

验收：新用户使用文档可在 10 分钟内完成首次调用；两个项目的环境变量与工作目录互不可见；凭证不出现在配置、日志和导出文件中。

### 阶段 2：可编程调用与插件化（4-6 周） `[~]`

**目标**：支持自动化和外部 Runtime 接入，使 AgentDock 成为可嵌入的本地控制层。

交付：

- `[~]` 版本化本地 HTTP API、SSE 事件流、最小 Bearer 认证、SQLite 幂等和 OpenAPI 已完成；确定性压力、断线重连、并发幂等、异常注入、损坏 SQLite 诊断和数据库重开恢复已有回归，真实磁盘错误、多平台信号和长任务跨进程重启验收尚未完成。
- `[x]` 简单路由规则：按所需能力、网络/文件策略、健康状态和 Project/Profile 优先级匹配 Profile，并保存解释性决策。
- `[x]` Adapter SDK、manifest、契约测试和本地安装/启用/禁用/卸载机制已完成；脚手架、远程安装和 OS 级权限隔离不属于阶段 2 范围。
- `[x]` 配置校验、`dry-run`、运行恢复、数据保留/输出保存、结构化日志和配置化脱敏已实现，并有自动化测试。

验收：脚本可发起任务并消费完整事件流；示例第三方 Adapter 能通过契约测试和 API/CLI 集成回归；异常中断后的 Run 在重启后进入可解释的终态；自动化已覆盖损坏 SQLite 和数据库重开恢复，发布前仍需完成真实磁盘故障、跨平台信号和长任务人工验收。

### 阶段 3：本地多 Agent 配置环境管理（6-8 周） `[~]`

**目标**：让个人用户在本机维护多套 Agent 配置环境，并按 Project/Workspace 选择、校验和运行；原生 Agent 配置目录是事实来源，AgentDock 提供生命周期管理和执行安全边界。

交付：

- `[x]` 第一版 Web 控制台，查看 Runtime、Project、Session、Run 和事件时间线。
- `[x]` 旧模型的可编辑配置中心：编辑 Runtime、Profile、Project、Policy，提供 schema/Policy 校验、差异预览、revision/hash 冲突、原子保存、备份恢复和追加式审计。
- `[x]` Agent Engine、Agent Environment 和 Environment Permission 模型；旧配置明确拒绝。
- `[ ]` Environment 原生 `configDir`、`stateDir`、`cacheDir` 的创建、导入、复制、备份、恢复、hash/rescan 和外部修改检测。
- `[ ]` Project/Workspace 到多个 Environment 的绑定、默认 Environment 和引用校验。
- `[x]` 执行前配置完整性检查，以及包含 Engine、Environment hash、Permission 和 Project 的不可变 Run snapshot。
- `[ ]` 团队模板、CI、RBAC、远程 Runtime 和集中审计不属于本阶段主交付。

#### 可编辑 Web 看板范围（阶段 3 第一版）

- 编辑范围迁移为 Agent Engine、Agent Environment、Project/Workspace 和 Environment 权限；表单适合常用字段，高级 JSON 编辑用于完整的 Agent 原生配置表达。
- 保存前执行 schema、跨对象引用、Policy 和 `dry-run` 校验，并展示配置差异、未保存变更和恢复原值入口。
- Secret 只允许修改 reference，禁止读取、回显或保存明文 secret；开启写入、网络、shell 或新增 secret reference 等高风险变更必须二次确认。
- 通过配置 revision/hash 检测并发修改，冲突时拒绝覆盖；写入使用临时文件/原子替换，保存前保留备份，失败可回滚。
- 复用现有 Bearer token 和回环监听边界。配置 API 支持安全热加载，并继续提供 `/config`、`/config/preview`、`/config/backups` 和 `/config/restore`。
- 配置变更记录追加式审计事件，历史 Run 的不可变 snapshot 不得被编辑操作改写；外部目录变更必须能够通过 hash/rescan 发现。

验收：用户可以维护多个 Engine 和 Environment；Environment 可绑定不同 Project，引用或管理 Agent 原生配置目录，并在外部变更后给出明确提示；执行前可完成 Engine、目录、权限、Secret Reference 和配置完整性校验；备份/恢复和并发冲突可解释；Run 能追溯实际 Engine、Environment 配置 hash、Policy 和 Project，且修改 Environment 不改变历史 snapshot。

### 阶段 4：远程执行与企业能力（按需求验证后启动） `[ ]`

**目标**：将已验证的本地模型扩展到受控远程 Runtime 和组织级治理。

候选范围：远程 Worker、组织身份与 RBAC、中央审计、配额/成本统计、密钥轮换、私有 Adapter 仓库和策略分发。

启动条件：阶段 3 至少有 3 个独立团队持续使用，且远程协作/治理需求在访谈中重复出现；否则保持本地开源核心的投入优先级。

## 9. 关键决策与风险

| 风险 | 影响 | 缓解方式 |
| --- | --- | --- |
| Runtime 更新频繁且接口不稳定 | Adapter 易失效 | 能力探测、版本范围、契约测试、Adapter 独立发布。 |
| 不同工具的 session 语义不一致 | 用户误以为可完全迁移 | 明确区分 AgentDock 元数据 session 与 Runtime 原生 session。 |
| 隔离只停留在约定层 | 凭证或文件泄露 | 最小权限默认值、目录/环境白名单、策略事件；后续引入 OS/容器沙箱。 |
| 首版范围过大 | 延迟获得真实反馈 | P0 只做两个 Adapter、CLI 与本地闭环。 |
| 与 API 网关/工作流平台定位混淆 | 难以建立用户认知 | 强调“Runtime 控制面”，以代码 Agent 的执行隔离和会话治理为差异点。 |
| 维护 Adapter 成本高 | 开源维护压力大 | 提供 SDK、兼容矩阵和社区 Adapter 认证机制。 |

## 10. 成功指标

阶段 1 发布后，建议连续 6-8 周跟踪：

- 至少 20 名早期用户完成两个以上 Runtime 的注册与调用。
- 首次成功调用完成率不低于 80%。
- 活跃用户中，至少 50% 在两个以上 Project 或 Profile 间切换。
- P0 调用失败中，因 Adapter/配置问题导致的比例低于 10%。
- 至少 5 个用户持续使用 session 恢复或执行历史功能。
- 收集不少于 10 个真实 Runtime/团队工作流访谈，作为阶段 3 是否启动的依据。

## 11. 建议的开源交付方式

- 仓库分层：核心控制面、内置 Adapter、Adapter SDK、CLI、文档与示例分离。
- 核心使用宽松许可证（Apache-2.0 或 MIT）；优先选择 Apache-2.0 以包含专利授权条款。
- 从一开始发布兼容矩阵、威胁模型、数据处理说明和贡献指南。
- 每个内置 Adapter 均配备可运行的样例项目与契约测试，不以宣传页替代可验证体验。
- 在阶段 1 结束后再决定是否维护 Web UI；CLI/API 仍应是长期稳定的主接口。

## 12. 待验证问题

1. 用户更希望 AgentDock 直接管理本机 CLI，还是同时接入 SaaS/远端 API Runtime？
2. “环境隔离”对目标用户意味着配置隔离、进程隔离，还是容器/虚拟机级隔离？三者的成本差异很大。
3. 用户是否愿意用项目配置文件共享 profile，还是需要完全本地私有的配置体系？
4. Claude Code 与 Codex 的实际集成方式、授权模型和会话能力是否允许长期稳定适配？
5. 早期用户的主要使用入口是终端、IDE 插件、Web 控制台还是 CI？

这些问题应在阶段 0 通过访谈和最小原型验证，而不是预先以大型架构替代真实需求。

## 13. 开发计划

各阶段的周级任务、模块拆分、测试计划、发布门槛和 issue 组织方式见：[分阶段开发计划](./development-plan.zh-CN.md)。
