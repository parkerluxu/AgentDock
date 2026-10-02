# 本地 Agent 环境管理详细开发计划

> 版本：v0.1（执行计划）<br>
> 日期：2026-09-22<br>
> 输入：[本地 Agent 环境管理方向（提案）](./local-agent-environment-direction.zh-CN.md)<br>
> 目标版本：`v0.2.0-local-agent`（版本号以发布策略为准）

## 1. 目标、边界与完成定义

本计划的目标不是再抽象一套 Runtime 平台，而是把已有的本地执行能力收敛为清晰的 **Agent → Environment → Project → Session → Run** 使用体验：用户选择 Agent，系统确定其原生 Environment；每次执行均可解释、可恢复，并且不会因为复制或切换环境而泄漏登录状态、token 或历史会话。

本版本只面向单个可信操作者或可信节点。`Environment Permission`、原生 Runtime 选项、目录和网络策略属于启动约束及审计依据，**不是** OS、容器或 VM 安全沙箱。本计划不包含公网监听、租户/RBAC、计费、跨机器调度、容器隔离或重做 Codex / Claude Code 的原生会话格式。

版本完成时必须同时满足以下结果：

1. 用户可在同一机器中维护多个 Codex / Claude Code 原生环境，并能安全地创建、导入、只复制配置、备份、恢复、诊断与归档它们。
2. 用户、CLI、SDK、DSH 和 HTTP 交互入口默认都以 Agent 为选择对象；Environment 只在配置、诊断和显式高级路由中出现。
3. 一次 SDK/CLI/HTTP 调用持续返回统一事件和最终结果；调用方不需要自己完成 Run 创建、SSE 重连和 sequence 去重，但仍能取得 `runId` 用于审计和取消。
4. Session 恢复严格校验 Agent 与 Environment 身份；Run 保存当时的 Agent、Engine、Environment manifest/hash、Project、Permission 和执行目录快照。
5. `agentdock dsh start` 能复用或启动回环 API，并只向其启动的 DSH 子进程注入 API token；token 不出现在终端输出、配置、DSH profile、任务记录或日志中。

## 2. 当前基线与实施策略

代码库已经具备本计划的多数基础构件，后续工作应以“收口和验收”为主，不应另起平行模型。

| 能力 | 当前基础 | 计划中的缺口 / 收口动作 |
| --- | --- | --- |
| 领域模型 | `Agent`、`AgentEngine`、`AgentEnvironment`、`EnvironmentPermission`、Project、Session、Run 和 Run snapshot 已存在。 | 固化“Agent 是默认调用单位”的公开语义；将旧的 Environment-first 入口明确为高级兼容路径。 |
| 会话归属 | `RunService` 已校验 Engine、Agent、Environment 与 active 状态。 | 将错误码、API/CLI 文案和跨入口回归固化为公开契约。 |
| Environment 生命周期 | 已有 managed/external 目录、manifest/hash、rescan、config-only copy/import、备份/恢复与忽略认证缓存的规则。 | 将“外部修改后必须显式 rescan”做成严格门禁；补齐模板、诊断、真实 Runtime 验收和恢复演练。 |
| 一次 Agent 调用 | `POST /agents/:agentId/invoke`、Node SDK 的 SSE 自动重连/去重，以及 `agent run` CLI 别名已存在。 | 统一 CLI 的 `accepted`、JSONL/人类可读输出和错误语义；用契约测试锁定三条调用面。 |
| 可视化控制面 | Control Center 与 DSH 配置页已能显示和编辑 Agent、Environment、Project、Permission。 | 将 Agent 健康、环境漂移、Project 绑定和最近 Session/Run 汇总为一个可解释的 Agent 主视图。 |
| DSH 集成 | DSH 已可把 Agent 暴露为模型，并经 `/invoke` 创建或恢复 AgentDock Session。 | 当前仍要求用户手动启动 API、设置 `AGENTDOCK_API_TOKEN`。需要完成受管启动器。 |

已有未提交的 DSH 打包、模型选择和文档改动属于当前工作树内容；实施本计划时必须在其基础上增量开发，不能覆盖或重置它们。

### 2.1 执行原则

- 先补契约和测试，再改公共 API、CLI 输出或配置 schema。`POST /runs` 继续保留给队列、批处理和恢复；不把它从存量调用方中移除。
- 每项可变目录操作先写入 staging 目录、校验 manifest/hash，再原子切换；失败时保留原目录和历史 Run。
- Secret 只允许以 `secretRefs` 存在于配置中。所有 copy/import/template/backup 测试都必须放入 token、OAuth、session 和 cache 诱饵文件并断言目标不存在这些内容。
- DSH 启动器以“最小本机进程编排器”实现，不能通过写入调用者的 PowerShell/CMD 环境来传递 token。
- 对 Codex、Claude Code 的差异只能收敛在 Adapter/诊断层；不能把某个 Runtime 的私有配置格式提升为 AgentDock 的通用 schema。

## 3. 里程碑、排期与关键路径

以下按 **2 名核心开发者 + 0.3 名 QA/文档支持**估算，合计约 7 周。若由单人负责，保持依赖顺序并按 1.5–2 倍换算；不能通过跳过凭证、恢复或跨平台测试来缩短关键路径。

| 迭代 | 周期 | 里程碑 | 可交付结果 | 依赖 |
| --- | --- | --- | --- | --- |
| I0 | 第 1 周 | M0：语义与安全边界冻结 | Agent-first 契约、兼容策略、会话/复制安全回归 | 无 |
| I1 | 第 2 周 | M1：调用面收口 | CLI、SDK、HTTP 的事件与错误契约一致；Control Center Agent 概览 | M0 |
| I2 | 第 3 周 | M2a：DSH 启动器骨架 | API 探测、受管 API、子进程环境注入和所有权记录 | M1 |
| I3 | 第 4 周 | M2b：DSH 可靠性验收 | 并发启动、复用、失败清理、Windows 进程行为和文档 | M2a |
| I4 | 第 5 周 | M3：Environment 生命周期闭环 | 模板、严格漂移门禁、配置克隆、恢复演练 | M0 |
| I5 | 第 6 周 | M4：诊断与多 Agent 路由 | Runtime 兼容矩阵、Agent 健康、Project 路由解释 | M1、M3 |
| I6 | 第 7 周 | M5：发布候选 | 跨平台/真实 Runtime 验收、迁移文档、发布门禁 | M2b、M3、M4 |

关键路径是 **M0 → M1 → M2a/M2b** 与 **M0 → M3 → M4**，二者在 M5 汇合。DSH 启动器中发现 DSH CLI 不支持可靠子进程启动时，不应阻塞 Environment 交付；启动器需保留一个适配层，并把该问题降级为 DSH 集成的已知限制。

## 4. M0：收敛语义、安全边界与兼容策略

### 4.1 冻结公开选择规则

写入 ADR，并同步 README、快速开始、API/SDK、Control Center 与 DSH 文案，固定下列规则：

| 场景 | 默认选择对象 | 是否可传 `environmentId` |
| --- | --- | --- |
| `POST /agents/:agentId/invoke`、SDK `client.agent(id).run()`、`agentdock agent run`、DSH 模型 | Agent | 否；Environment 从 Agent binding 得到。 |
| Project | Project 的 `agentIds` 与 `defaultAgentId` | 仅在配置/诊断中显示其间接关系。 |
| `POST /runs`、`run execute`、dry-run | 高级显式路由 | 是；文档标为低层控制面，不作为新用户路径。 |
| Environment API/UI | Environment | 仅用于创建、导入、诊断、备份、恢复和高级调试。 |

为旧配置提供一个发布周期的兼容层：保留 `configuredAgents()` 的合成 Agent 和旧 `Project.environmentIds` 解析，但每次使用都输出可机器读取的弃用诊断。下一个破坏性配置版本才移除 legacy placement；该版本必须提供纯本地迁移命令、迁移预览和可恢复的配置备份。

### 4.2 统一安全术语与诊断

- 将 UI、CLI help、README、wiki、安全文档及 API 描述统一为“启动约束与审计策略”或 `Environment Permission`，删除将 Permission 称为 sandbox/强隔离的表达。
- `doctor` 新增结构化边界说明：它可报告目录、Environment allowlist、network、secret reference 和 Adapter 声明的权限，但必须显示 `isSecuritySandbox: false`。
- 为会话错配提供稳定错误码：`SESSION_ENGINE_MISMATCH`、`SESSION_AGENT_MISMATCH`、`SESSION_ENVIRONMENT_MISMATCH`、`SESSION_ARCHIVED`。HTTP 返回一致的机器码和可操作消息；CLI 保持非零退出码并输出 JSON 错误模式。

### 4.3 复制与登录状态保护

以 Engine 可扩展的敏感路径规则替代零散特例：通用规则覆盖 `.env`、token/OAuth/credential/auth 文件、session/history、SQLite/WAL、cache/log；Codex、Claude Code 可追加已验证的原生路径。复制、导入、模板和备份采用相同规则，但备份仅限 Environment 的 config 层。

每次操作生成不含文件内容的审计摘要：源/目标 Environment、源 hash、目标 hash、跳过文件类别、操作者、时间和结果。不得记录被跳过的 secret 文件完整路径（只记录类别和计数）。

### 4.4 M0 验收

- 任意 Agent 调用都能在 Run/Session/事件中回答 Agent、Engine、Environment、Project 和 Permission 是什么。
- 同一 Engine 下的不同 Agent、同 Agent 在不同 Environment、归档 Session 和错误 Engine 都被拒绝恢复，并返回对应稳定错误码。
- 带有 `auth.json`、`credentials.json`、`.env`、`token.json`、SQLite、原生 session 和 cache 诱饵文件的复制/导入/备份，不会在目标出现 secret 或历史 state；普通 config、skills、plugins 和 commands 可以复制。
- 文档中没有把该能力承诺为容器/OS/VM 安全隔离。

## 5. M1：将调用体验收口为“调用 Agent”

### 5.1 CLI

将 `agentdock agent run <agent-id> [--project id] [--session id] <task>` 提升为推荐命令，并保留 `run execute` 作为高级别名。实现统一事件信封：

```text
accepted  →  event*  →  result | error
```

- 默认 `--format jsonl`，第一行 `accepted` 含 `runId`、Agent、Project、Session 和恢复地址；后续逐行输出事件，最后输出终态摘要。
- `--format human` 只渲染消息、工具开始/结束、Run ID 和最终状态；stderr 只放诊断。脚本模式不输出颜色或未结构化进度。
- `Ctrl+C` 请求取消并等待终态；仍沿用取消时 `130`、运行失败/超时 `3`、调用/配置错误 `2` 的退出码。必须在接收 `accepted` 后再处理断开或取消，避免用户拿不到审计 ID。
- `agent run --dry-run` 显示解析出的 Agent binding、manifest hash、权限摘要和 Project，不读取或回显 secret 值。

### 5.2 SDK 与 HTTP

保留现有 `AgentDockClient`，补充并冻结下列契约测试：

- `/agents/:id/invoke` 首先发 `accepted`；重复 Idempotency-Key 返回同一 `runId`，且不会重复启动 Runtime。
- SDK 在 `accepted` 后断线时以 `after=lastSequence` 恢复；去重、回调异常、取消、终态丢失、HTTP 4xx/5xx 的行为确定且有上限重试。
- `/invoke` 拒绝请求体的 `environmentId`；`POST /runs` 继续支持显式 Environment，避免破坏批处理。
- 所有入口都使用同一个 `RunService`、状态机、redaction 和 Environment 后置 reconcile 逻辑。

### 5.3 Control Center

新增 Agent 主视图（不在此版本从 Web 启动 Run）：

- 每个 Agent 显示 Engine 版本/健康、Environment manifest/hash/最后扫描/漂移状态、Permission 摘要、允许的 Project、默认 Project 指示和最近 Session/Run。
- 发生漂移、Engine unhealthy、Project 无 binding、Session 不可恢复时展示原因和下一步操作，而不是静默回退到另一 Environment。
- 所有详情链接到不可变 Run snapshot；配置页中的 Environment 仍只展示目录与 secret reference 名称。

### 5.4 M1 验收

- 同一模拟任务经 CLI、SDK、直接 SSE 产生相同顺序的 `accepted`、Run events 和终态，且 `runId` 指向同一结构化审计记录。
- SDK 的网络中断与 SSE 重连测试不会重复消费事件或重复执行任务。
- 新用户只需 Agent ID、Project（可选）和 task 即可执行；所有 Environment 选择都由 Agent binding 解释。

## 6. M2：DSH 一键启动与 token 传递

### 6.1 命令和职责

新增：

```text
agentdock dsh start --config <path> [--port <number>] [--profile <name>] [--dsh-command <path>]
```

`dsh start` 是启动器，不是 DSH 插件配置编辑器。它的状态机为：

```text
resolve config → probe loopback API → reuse | start owned API
               → load managed token → spawn DSH child → await child
               → stop only owned API → remove ownership record
```

实现拆为三个可替换组件，避免把 DSH CLI 细节渗入核心 Runtime：

1. `LoopbackApiSupervisor`：解析配置/数据目录、探测本机健康 API、启动 `agentdock api serve`、等待就绪并维护 PID/启动时间/config hash 的无敏感 ownership record。
2. `ManagedTokenReader`：只读取 API 控制的 `api-token` 文件；不打印、持久化、序列化或放入错误对象。若已运行 API 使用了无法从受管位置读取的自定义 token，安全地失败并提示用户用受管 API 重启，而不是索取或猜测 token。
3. `DshProcessLauncher`：以显式 command/profile 启动 DSH，在 **子进程副本** 中设置 `AGENTDOCK_API_TOKEN`；调用者 shell、DSH profile、AgentDock 业务配置和绑定文件均不得被修改。

### 6.2 API 复用与失败处理

- 只接受 `127.0.0.1` / `::1` API；端口冲突或非回环地址均拒绝。
- 探测成功且 token 验证通过：标记 `reused`，DSH 退出时绝不停止该 API。
- 未运行：创建 API 子进程，读取其就绪信号并带指数退避检查健康状态；写入无 token 的 ownership record。启动失败应转发经脱敏的 API 诊断、清理半成品进程和记录。
- 启动器拥有 API 时，DSH 退出、SIGINT/SIGTERM、初始化失败和启动器异常均触发有界优雅关闭；仅在已验证 PID、启动时间和 ownership record 一致时才强制结束该 API。
- 使用单实例锁防止两个 `dsh start` 同时创建 API。锁中含 PID、时间和 config 路径，不含 token；检测陈旧锁时先验证进程是否存在。
- Windows 使用 `windowsHide: true`；终止只针对已验证 PID。Linux/macOS 验证进程组与信号处理。不得通过宽泛名称匹配或 shell 拼接终止进程。

### 6.3 DSH 兼容性决策

在 I2 的前两天完成 spike，固定并测试一个受支持的 DSH 启动命令和 profile 参数。若 DSH 不提供稳定的 CLI 入口，`--dsh-command` 成为必填显式参数，默认值只在探测到支持版本时使用。DSH 插件继续只读取环境变量，不新增 token 配置字段。

### 6.4 M2 验收

- API 未运行时，一条命令启动 API 和 DSH；已运行时复用 API；DSH 退出后只停止启动器自己创建的 API。
- 用伪 DSH 子进程断言 token 仅存在于其进程环境；捕获 stdout、stderr、配置、ownership record、绑定文件和审计日志均不包含 token。
- 验证 API 启动超时、端口占用、错误 token、DSH 不存在、DSH 非零退出、双重并发启动、启动器崩溃后重试和 Ctrl+C。
- DSH 通过动态 Agent 模型选择创建 Session；换 Agent 时不得复用原 Agent 的 native session。

## 7. M3：完善 Environment 生命周期

### 7.1 严格漂移协议

当前运行前不能静默将外部变更写入新的 manifest。调整为三态：`ready`、`drifted`、`invalid`。

- `ready`：当前 config hash 等于已确认 manifest，可执行。
- `drifted`：外部 config 内容与 manifest 不同，执行返回 `ENVIRONMENT_RESCAN_REQUIRED`，并给出摘要差异、最后扫描时间及 rescan 操作；不改写历史 manifest。
- `invalid`：目录丢失、越界、不可读、manifest 损坏或配置超过安全扫描限制，拒绝执行。

只有显式 rescan、受管 Environment 初次创建，或 AgentDock 已知的 Run 结束后 reconcile 可以更新 manifest。reconcile 必须仅在该 Run 持有 Environment 运行锁、且预运行 manifest 与 Run snapshot 一致时执行，避免把并发的外部修改误认为 Runtime 修改。

### 7.2 模板、克隆、备份和恢复

第一版模板不增加新的全局领域实体：它是 `.agentdock/environment-templates/<template-id>/` 下的不可变 config-only archive，含 source Environment、Engine/版本、创建时间、config hash、跳过类别和 `config/` 内容。这样可在不提升配置 schema 版本的前提下验证需求；模板确实被反复共享后才引入可配置的 Template 对象。

- `environment template create` 从 ready Environment 创建模板；`list` 显示来源、Engine 兼容提示、hash 和时间；`apply` 创建新的 managed Environment 并复制模板 config。
- `environment copy` / template apply 默认只复制 config；目标 `stateDir`、`cacheDir`、native session 和登录状态为空。Secret Reference 名称可由 Agent/Permission binding 继承，但绝不复制已解析值。
- backup 与 restore 均使用 staging + hash 校验 + 原子替换；external Environment 的 restore 需要显式确认。恢复历史配置后，历史 Run snapshot 不变，仅当前 Environment manifest 更新。
- 删除 Environment 默认仅删除配置引用；增加显式 `environment purge --managed-dir` 作为单独的、二次确认且仅限受管目录的危险操作，不在首个发布候选中默认暴露。

### 7.3 诊断和实际 Runtime 验证

新增/补强 `environment doctor <id>`，分开报告：目录状态、manifest/hash、符号链接边界、可写性、Engine binary/version、Adapter capabilities、Permission、Secret Reference 的“可解析/不可解析”状态（不显示值）及推荐动作。

为 Codex 与 Claude Code 编写 Adapter 级“native home 合约”：运行时实际使用的 home/config/state/cache 环境变量、支持的 session/resume 参数、会修改的目录类别和版本范围。所有结论进入运行时兼容矩阵，并在真实 Runtime 的低成本只读冒烟中验证。

### 7.4 M3 验收

- 两个以上 Environment 可由同一模板派生；config、skills、plugins 可复制，token、认证缓存、session/state/cache 不可复制。
- 外部修改 config 后执行被阻止，显式 rescan 后才恢复；Run 写入造成的受控更新可在结束后自动 reconcile。
- 备份恢复失败不会破坏当前 Environment；成功恢复不影响任何历史 Run 的 snapshot、事件和输出。
- managed 与 external 目录的越界、符号链接、不可读、过大文件/文件数、损坏 manifest 及操作中断路径均有回归测试。

## 8. M4：多 Agent Project 路由、健康与可解释性

### 8.1 Project 路由

- Project 以 `agentIds` 和 `defaultAgentId` 管理可调用对象。保存时校验 default 在 allowed 集合内，Agent binding、Engine、Environment、Permission 均存在且启用。
- API/SDK/CLI 的 dry-run 返回 `routing`：选择模式、候选 Agent、被拒绝原因（未绑定、disabled、健康异常、缺能力、Permission 冲突、Environment drifted）和最终解释。
- Agent 直调与 Project 默认冲突时拒绝，不静默替换为 Project 的另一个 Agent；空 Agent ID、多个候选且无默认值返回稳定的歧义错误。

### 8.2 健康看板与兼容矩阵

健康状态按三个来源组成：Engine（binary/version/Adapter health）、Environment（manifest/目录/drift）、Project（binding/default），并显示最后检查时间。每项检查设置短超时和结果缓存，Control Center 刷新不应启动 Runtime 任务或读取 secret 值。

维护 `docs/runtime-capability-matrix.md`，至少记录：Codex/Claude Code 的已验证版本区间、execute/stream/cancel/create/resume/healthcheck 支持、home 环境变量映射、已知限制、最后验证平台和日期。矩阵更新必须由对应 Adapter 契约测试或一次记录在案的真实冒烟支撑。

### 8.3 M4 验收

- 一个 Project 内两个以上 Agent 可稳定切换，默认选择、明确选择、歧义和故障拒绝均可解释。
- 任意 Run snapshot 和 Agent 页面均能追溯真实 Engine 版本、Environment hash、Permission、Project 与 Session。
- Codex 和 Claude Code 各完成至少一条独立 home 的真实只读运行与会话恢复/不支持说明验证。

## 9. 测试、质量与发布门禁

### 9.1 自动化测试分层

| 层级 | 重点 | 必经场景 |
| --- | --- | --- |
| 单元 | resolver、session identity、manifest、敏感路径过滤、启动器状态机 | Agent/Environment mismatch、token 诱饵、hash/路径/锁判定。 |
| 集成 | SQLite、RunService、API SSE、SDK、Environment 文件操作 | 幂等、SSE 断线续传、漂移拒绝/rescan、恢复原子性。 |
| DSH 合约 | fake API + fake DSH 子进程 + 真实插件适配器 | 动态模型、自动绑定、换 Agent、新/复用 API、token 不泄漏。 |
| E2E | Core CLI/API/SDK + Echo Adapter；受控真实 Runtime 冒烟 | 多 Project、多 Agent、多 Environment、取消、重启与历史 snapshot。 |
| 跨平台 | Windows、Linux、macOS | 路径/符号链接、权限、取消信号、子进程清理、token 文件处理。 |

所有新增测试使用临时目录和 fake adapter，真实 Codex/Claude Code 测试只做受限、可选、低成本的冒烟，不能成为默认 `npm test` 的模型额度消耗来源。

### 9.2 安全与可靠性门禁

- `npm run typecheck`、`npm test`、`npm run build`、配置 schema 校验、文档链接检查全部通过。
- 执行 secret 扫描和依赖/许可证检查；构建产物、tarball、日志样本、快照、audit、template 和 backup 中不得出现测试 token。
- 演练 API 重启、SQLite 重新打开、SSE 断线、Environment copy/restore 中断、DSH/API 子进程异常退出和陈旧锁恢复。
- 在三平台至少各运行一次受控 E2E；若 Linux/macOS 不可获得，发布候选必须明确标为 Windows-only preview，不能声称跨平台已验证。

### 9.3 文档与迁移产物

- 更新快速开始、配置参考、API/SDK 参考、DSH 安装指南、故障排查、运行时兼容矩阵和安全边界说明。
- 发布 Agent-first 调用迁移表：旧 `run execute` / `POST /runs` 的适用场景、等价的新调用、弃用时间表和回滚方法。
- 发布 Environment 恢复手册：备份位置、template 规则、外部目录确认、drift 处理和“丢失登录状态后在新 Environment 中重新登录”的操作。
- 记录已知限制：本地可信边界、无公网 API、无 sandbox、DSH 支持的 CLI 版本范围和未验证 Runtime 版本。

## 10. 可拆分的 Issue / PR 队列

| ID | 工作项 | 主要位置 | 依赖 | 完成证据 |
| --- | --- | --- | --- | --- |
| LE-01 | Agent-first ADR、术语和 legacy 兼容诊断 | `docs/`、`cli.ts`、API/OpenAPI | 无 | 文档审阅 + CLI/API 契约测试。 |
| LE-02 | Session 稳定错误码与跨入口映射 | `run-service.ts`、`server.ts`、SDK | LE-01 | 四类错配回归。 |
| LE-03 | copy/import/backup 的统一敏感路径策略 | `environment/manager.ts` | 无 | token/state 诱饵测试。 |
| LE-04 | `agent run` accepted/JSONL/human renderer | `cli.ts`、CLI tests | LE-01 | 三种终态、取消、脚本解析测试。 |
| LE-05 | SDK/SSE 契约与重连故障注入 | `sdk/client.ts`、API tests | LE-02 | 无重复事件/执行证明。 |
| LE-06 | Control Center Agent 概览 | `web/`、API read models | LE-01 | UI 与 API 快照测试。 |
| LE-07 | `LoopbackApiSupervisor` 与 managed token reader | 新 `dsh-launcher/` 或 `cli` 子模块 | LE-01 | fake API 生命周期测试。 |
| LE-08 | DSH child launcher、锁和所有权清理 | 同上 | LE-07 | 并发/崩溃/无泄漏测试。 |
| LE-09 | DSH CLI/profile 兼容 spike 与适配层 | `packages/dsh/`、docs | LE-08 | 支持矩阵与一条真实手工验收。 |
| LE-10 | Environment 严格漂移状态机 | `environment/manager.ts`、runner/API | LE-03 | `drifted` 拒绝、rescan、post-run reconcile 测试。 |
| LE-11 | config-only template 生命周期 | Environment manager、API/CLI/UI | LE-10 | 模板派生与不复制 state 的 E2E。 |
| LE-12 | Environment doctor 与 Adapter native-home 合约 | `doctor.ts`、adapters、矩阵 | LE-10 | Codex/Claude 冒烟记录。 |
| LE-13 | Project Agent 路由解释与健康读模型 | resolver、API、web | LE-06、LE-12 | 默认/歧义/拒绝测试。 |
| LE-14 | 发布候选、迁移、跨平台与恢复演练 | CI、docs、release checklist | 全部 | M5 门禁清单签署。 |

每个 PR 必须包含：变更前后的公开契约说明、自动化测试或明确的不可自动化理由、secret/redaction 影响说明、迁移影响和回滚路径。涉及 schema、事件格式、CLI JSONL 或 API 的 PR 还需更新 OpenAPI/示例及兼容矩阵。

## 11. 风险与决策点

| 风险 | 影响 | 预防与止损 |
| --- | --- | --- |
| DSH CLI/profile 行为随版本变化 | 一键启动无法稳定工作 | 启动器适配层 + 版本探测；不支持时要求显式 `--dsh-command`，不影响 Core。 |
| 原生 Runtime 改变 home、认证或 session 格式 | Environment 隔离或恢复失效 | Adapter native-home 合约、版本矩阵、真实低成本冒烟、发现未知版本时降级为诊断警告。 |
| 自动 rescan 掩盖外部修改 | 审计失真或误用未经确认配置 | M3 的 `drifted` 门禁；只有显式确认或受管 Run reconcile 可更新 manifest。 |
| token 进入异常、诊断或子进程命令行 | 本地凭证泄漏 | 只经受管文件读取、只注入 child env、不序列化错误、针对所有输出做诱饵扫描。 |
| 外部目录恢复不可逆 | 用户原生配置损坏 | external restore 强确认、staging/原子替换、自动备份；purge 后置且只限 managed。 |
| 把 Permission 误解为安全边界 | 不安全使用预期 | 所有入口显示非 sandbox 边界；对不可信代码需求明确转入未来 Worker/容器设计。 |

## 12. 发布通过条件

只有在 M0–M4 验收全部通过，并完成以下事项后，才能将版本标为稳定发布：

1. 默认用户旅程可从零完成：创建或导入 Environment → 创建 Agent/Project → `agent run` 或 SDK 调用 → 查阅 Run snapshot → DSH 一键启动。
2. 复制、模板、备份和恢复已通过 secret/state 诱饵测试，且恢复演练不改变历史 Run。
3. DSH 启动器能够在“复用 API”和“自建 API”两种情形下安全退出；token 无任意落盘/输出泄漏。
4. Codex 与 Claude Code 的独立 home 冒烟结果和版本矩阵已经更新；跨平台结论与实际测试平台一致。
5. 迁移、已知限制、安全边界、故障处理与回滚文档可由未参与开发的试用者独立走通。

远程 Worker、容器/VM 隔离、团队模板治理、RBAC 或公网 API 不是本版本的尾项。只有本地多 Agent 环境被持续使用且出现重复的远程或不互信负载需求时，才另开需求验证和威胁模型评审。
