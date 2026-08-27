# Adapter API v1 兼容矩阵更新流程

兼容矩阵是发布门槛，不是运行时猜测。Runtime 或 Adapter 版本变化时，按以下流程更新 `docs/runtime-capability-matrix.md` 和 Adapter manifest 的 `runtime.versionRange`。

## 每次更新必须执行

1. 记录 Runtime 版本、Adapter 版本、操作系统、Node 版本和测试日期。
2. 执行 `npm run typecheck`、`npm test` 和 `npm run build`。
3. 用 `assertAdapterContract` 执行健康检查、执行、终态事件和取消检查。
4. 对 Claude Code/Codex 运行一次明确只读的人工冒烟任务；自动测试不得启动真实模型。
5. 验证能力矩阵中的 `execute`、`stream_events`、`cancel`、session 创建/恢复和权限/沙箱参数，不能支持的能力标成 `unsupported` 或 `version-dependent`。
6. 检查 API 集成测试：Run 提交、事件游标重连、异常终态、幂等重放和并发限制。
7. 更新矩阵的结论、已知限制和回滚版本，并在发布说明中引用具体证据。

## 兼容状态含义

| 状态 | 含义 | 发布要求 |
| --- | --- | --- |
| `supported` | 当前声明版本和测试环境中可重复通过。 | 可写入 manifest 的稳定范围。 |
| `version-dependent` | 能力存在，但依赖 Runtime 版本、平台或 Profile 设置。 | 必须写清条件和失败诊断。 |
| `unsupported` | 当前 Adapter 不提供该能力。 | 不得在路由中声明或伪造。 |
| `unknown` | 尚未验证。 | 不得作为已兼容版本发布。 |

## 回滚和破坏性变化

若健康检查、契约测试或人工冒烟失败，先撤回 `runtime.versionRange` 的新增范围，保留旧范围并记录失败原因。若事件 schema、manifest 字段、能力语义或取消/Session 语义发生破坏性变化，不能仅修改矩阵；必须提升 `agentDockApi` 版本并提供迁移指南。

当前基线：AgentDock Adapter API `v1`，内置 Adapter 版本 `0.1.0`；阶段 2 的自动化回归使用 Echo、脚本化 CLI Runner、示例本地 Adapter 和故障 Adapter，不消耗真实模型额度。
