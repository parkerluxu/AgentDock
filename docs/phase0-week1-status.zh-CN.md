# AgentDock 开发状态

> 更新时间：2026-08-26
>
> 范围：阶段 0 已完成；阶段 1 已完成第 1 至第 4 周的核心闭环；阶段 2 功能开发和确定性集成回归已完成，Beta 故障验收仍在进行。

## 当前可用能力

- 内置两个 Runtime Adapter：Claude Code 与 Codex。
- Runtime 注册清单、版本/健康检查，以及 `agentdock doctor` 诊断。
- 通过配置定义 Runtime、Profile、Project、Policy 与环境变量类型的 Secret Reference。
- Profile 继承、Project 默认 Profile、工作目录解析、环境变量白名单与 dry-run。
- 真实执行 Claude Code/Codex，并以 JSONL 输出标准化 `RunEvent`。
- SQLite 持久化 `Session`、`Run`、不可变执行快照和按序追加的 `RunEvent`。
- Session 创建、查询、归档；Claude Code 的 UUID 会先以待创建状态保存，首次成功 Run 通过 `--session-id` 创建后才标记为可恢复；Codex 明确标记为 AgentDock 逻辑 Session，避免伪造原生 ID。
- Run 查询、事件查询、JSON/JSONL 导出，以及基于 owner PID 的崩溃恢复。
- 数据默认保存在 `.agentdock/data/agentdock.db`；`dataDir` 是相对配置文件的目录。旧开发版本把 `dataDir` 当数据库文件创建的数据仍会自动读取，避免丢失既有历史。
- 本地 HTTP API v1：仅回环地址监听，支持 Bearer token、Run 提交/查询/取消、请求体/超时/并发边界、带 `after` 游标的 SSE 事件回放/订阅、SQLite 幂等和确定性可解释路由。
- 本地 Adapter 生命周期：包 manifest 校验、本地复制安装、列出、启用、禁用、卸载、显式权限授权和入口路径边界。
- 数据策略：终态 Run 保留期限、输出保存开关、结构化日志级别和默认/额外字段脱敏。
- 阶段 2 集成回归：内置 Echo、脚本化 Claude/Codex、本地示例 Adapter、SSE 重连、幂等并发、24 Run 突发、并发取消、Adapter 崩溃、损坏 SQLite 诊断、数据库重开恢复和 ProcessRunner 取消/退出码。

## 已验证项

```text
npm run typecheck    PASS
npm test             PASS（当前：22 文件、80 测试）
npm run build        PASS
```

本机已确认以下 Runtime 可被诊断：

```text
Claude Code 2.1.201
Codex CLI 0.147.0
```

自动测试不会启动真实模型调用，以避免常规回归消耗模型额度。真实调用保留给用户显式执行的 `agentdock run execute`。

## 阶段 1 尚余工作

- 完成第 5 周的 CLI 文档闭环：快速开始、完整配置参考、故障排查和端到端示例。
- 明确 Session 删除/恢复的产品语义；当前仅支持归档，归档后不可再执行。
- 增加可选择运行的真实 Runtime 冒烟测试（默认关闭）。
- 强化 Policy：当前提供配置/环境变量边界，尚未提供 OS、容器级的文件、网络和命令沙箱。
- 进行多平台、并发、长任务和故障注入的稳定性验证，再准备 `v0.1.0-mvp`。

## 下一开发阶段

阶段 2 功能开发、集成回归、SQLite/重启恢复自动化、迁移文档和兼容流程已完成。Beta 发布前仍需按开发计划执行真实磁盘已满、多平台信号差异、长任务跨进程重启和正式版本发布门禁。

详细范围及验收门槛见[开发计划](development-plan.zh-CN.md)。
