# AgentDock 下一 Session 开发交接

> 更新时间：2026-09-01
>
> 用途：新建 Codex Session 后，直接从这里恢复上下文，不需要重新阅读全部对话。

## 项目定位

AgentDock 是一个本地维护多个 Agent 配置环境的平台。用户在自己的机器上维护多套 Claude Code、Codex 或其他 CLI Agent 环境，并按 Project/Workspace 选择后执行。

产品分级：

- **Agent Engine**：实际 Agent 引擎与 Adapter，负责二进制、版本、能力和健康检查；对应旧 Runtime + Adapter。
- **Agent Environment**：配置层主对象，包含 Engine 引用、原生 `configDir`、`stateDir`、`cacheDir`、启动参数、权限和 Secret Reference；对应旧 Profile + Policy 的组合。
- **Project / Workspace**：工作目录、可用 Environment 列表和默认 Environment。
- **Session / Run**：执行元数据与历史，不属于配置层；Run 保存执行时不可变 snapshot。

Agent 原生配置目录是 Environment 的事实来源。AgentDock 管理引用、目录生命周期、hash/rescan、备份恢复和执行前校验，不复制所有 Agent 配置字段。配置目录不是 OS/容器级沙箱；登录缓存、历史 session、cache 和明文 secret 不作为可共享配置。

## 当前完成度

- 阶段 0：规格冻结完成。
- 阶段 1：第 1-4 周核心闭环完成；第 5 周文档/发布验收部分完成；第 6 周稳定性与发布尚未完成。
- 阶段 2：功能开发、可靠性、数据策略、API/CLI/Adapter 集成回归、SQLite/重启恢复自动化、迁移文档和兼容流程完成；Beta 仍缺真实磁盘已满、多平台信号和长任务跨进程重启人工验收，以及正式版本发布门禁。
- 阶段 3：Agent Engine/Environment 模型、原生配置目录维护、Project 绑定、目录 hash/rescan、Environment CRUD/复制/导入/备份恢复和 Environment 级 Run snapshot 已完成；Web 使用唯一的“配置中心”入口，内部切换 Engine、Environment、Project 和 Permission。
- 内置 Adapter：Claude Code、Codex。
- 存储：Node `node:sqlite`，默认 `.agentdock/data/agentdock.db`，兼容旧式 `dataDir` 数据库文件。
- 测试：22 个测试文件、80 项测试；typecheck、test、build 均通过。

## 最近修复过的真实问题

1. Claude 首次 Session 必须使用 `--session-id`，后续才使用 `--resume`。
2. Claude 的 `stream-json` + `--print` 必须加入 `--verbose`。
3. Codex 非 Git 可信目录需要 Profile 显式设置 `skipGitRepoCheck: true`。
4. `dataDir` 语义是目录，新数据库路径是 `<dataDir>/agentdock.db`。

## 下一步优先级

当前直接进入阶段 3 的本地 Environment 主线，不直接跳到团队治理或远程 Worker：

1. **Environment 领域模型**：新增 AgentEngine、AgentEnvironment、EnvironmentPermission；新配置模型是唯一真相，旧 `runtimes/profiles/policies` 配置不再兼容。
2. **原生配置目录**：实现 managed/external 目录、config/state/cache 区分、目录校验、manifest、hash/rescan 和外部修改提示。
3. **API/Web 迁移**：以“配置中心”为唯一配置入口，内部管理 Engine、Environment、Project/Workspace 和 Permission，支持 Environment CRUD、复制、导入、备份恢复和 Project 绑定。
4. **执行接入**：执行前校验目录/权限/Secret Reference，Run snapshot 固化 Engine、Environment hash、Policy 和 Project。
5. **阶段门禁收尾**：补充现有数据迁移、真实目录操作和历史 Run 不变性测试；配置保存或恢复后的安全热加载已实现，数据目录切换仍需重启 API 服务。

## 重要边界

- 不要在常规自动测试中执行真实 Claude/Codex 任务，避免模型额度消耗；真实联调必须由用户显式执行。
- 当前 Policy 不是 OS/容器级强制沙箱，不要把配置白名单描述成完整安全隔离。
- API 默认只监听 `127.0.0.1` 或 `::1`，在认证和 TLS 设计完成前不要开放远程监听。
- 不删除 `.agentdock` 下现有 SQLite、历史 Run 和 Agent 原生目录；配置格式替换不等于删除运行数据。
- 当前工作区是 Git 仓库，存在前序未提交修改；继续开发时保留这些修改，不执行回滚或清理操作。

## 常用验证命令

```powershell
npm run typecheck
npm test
npm run build
node dist/cli.js config validate examples/config.example.json
node dist/cli.js doctor --config examples/config.example.json
node dist/cli.js run dry-run --config examples/config.example.json --profile codex-readonly "hello"
```

真实调用仅在用户明确要求时执行：

```powershell
node dist/cli.js run execute --config examples/config.example.json --profile claude-code-readonly "只读检查，不要修改任何文件。"
```

## 关键文件

- `src/runtime/adapters.ts`：Claude/Codex 参数和事件适配。
- `src/runtime/local-adapters.ts`：本地 Adapter 包存储、权限授权、启停卸载和入口加载。
- `src/runtime/run-service.ts`：Run/Session 生命周期、快照、状态和事件持久化。
- `src/storage/sqlite-run-store.ts`：SQLite schema、迁移、查询和恢复。
- `src/api/server.ts`：本地 API、Bearer 认证、请求限制、SSE、取消和幂等。
- `src/runtime/router.ts`：Profile 候选、Runtime 健康、能力/Policy 要求和路由解释。
- `src/cli.ts`：CLI 入口。
- `docs/development-plan.zh-CN.md`：阶段计划和状态表。
- `docs/api-reference.zh-CN.md`：API 端点与安全边界。
- `docs/configuration-reference.zh-CN.md`：存储、日志、输出保存和脱敏配置。
- `docs/migration-guide.zh-CN.md`：CLI/API/SDK 升级说明。
- `docs/adapter-compatibility-process.zh-CN.md`：兼容矩阵更新和发布门禁。

新 Session 的第一条开发消息建议直接写：

> 请读取 `docs/next-session-handoff.zh-CN.md`、`docs/development-plan.zh-CN.md` 和 `docs/requirements-analysis.zh-CN.md`，先核对当前工作区和未提交改动，然后继续实现阶段 3 的 Agent Environment 模型。优先新增 Engine/Environment 类型和配置兼容迁移，再实现原生 configDir/stateDir/cacheDir、目录 hash/rescan、Project 绑定、Environment CRUD 和 Run snapshot。保留现有 API、Web UI、测试和安全边界，不删除 `.agentdock` 数据；常规测试不要执行真实 Claude/Codex 任务。
