# AgentDock 下一 Session 开发交接

> 更新时间：2026-08-26
>
> 用途：新建 Codex Session 后，直接从这里恢复上下文，不需要重新阅读全部对话。

## 项目定位

AgentDock 是一个本地优先的 Agent Runtime 控制面，用统一入口调度 Claude Code、Codex 等 CLI Agent。核心对象是 Runtime、Adapter、Profile、Project、Policy、SecretReference、Session、Run 和 RunEvent。

## 当前完成度

- 阶段 0：规格冻结完成。
- 阶段 1：第 1-4 周核心闭环完成；第 5 周文档/发布验收部分完成；第 6 周稳定性与发布尚未完成。
- 阶段 2：功能开发、可靠性、数据策略、API/CLI/Adapter 集成回归、SQLite/重启恢复自动化、迁移文档和兼容流程完成；Beta 仍缺真实磁盘已满、多平台信号和长任务跨进程重启人工验收，以及正式版本发布门禁。
- 内置 Adapter：Claude Code、Codex。
- 存储：Node `node:sqlite`，默认 `.agentdock/data/agentdock.db`，兼容旧式 `dataDir` 数据库文件。
- 测试：22 个测试文件、79 项测试；typecheck、test、build 均通过。

## 最近修复过的真实问题

1. Claude 首次 Session 必须使用 `--session-id`，后续才使用 `--resume`。
2. Claude 的 `stream-json` + `--print` 必须加入 `--verbose`。
3. Codex 非 Git 可信目录需要 Profile 显式设置 `skipGitRepoCheck: true`。
4. `dataDir` 语义是目录，新数据库路径是 `<dataDir>/agentdock.db`。

## 下一步优先级

按以下顺序继续，不要直接跳到 Web UI 或远程 Worker：

1. **Beta 故障验收**：在对应平台和真实磁盘环境执行磁盘已满、Linux/macOS 信号差异和长任务跨进程重启人工验收；损坏 SQLite 和数据库重开恢复已有自动化回归。
2. **正式发布门禁**：完成 CHANGELOG、打包、版本标记、依赖/许可证检查和 `v0.2.0-api` 发布审批。
3. **阶段 1 收尾**：快速开始、故障排查、跨平台路径/信号测试和发布包校验。

## 重要边界

- 不要在常规自动测试中执行真实 Claude/Codex 任务，避免模型额度消耗；真实联调必须由用户显式执行。
- 当前 Policy 不是 OS/容器级强制沙箱，不要把配置白名单描述成完整安全隔离。
- API 默认只监听 `127.0.0.1` 或 `::1`，在认证和 TLS 设计完成前不要开放远程监听。
- 不删除 `.agentdock` 下现有 SQLite 数据；修改数据路径时保持兼容。
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

> 请读取 `docs/next-session-handoff.zh-CN.md`、`docs/development-plan.zh-CN.md` 和相关源码，先确认当前状态，然后在可用平台完成 Beta 故障验收（真实磁盘已满、多平台信号、长任务跨进程重启）并准备 v0.2.0-api 发布门禁；常规自动测试不要执行真实模型任务。
