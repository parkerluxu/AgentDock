# Runtime 能力矩阵（阶段 0 / 当前验证）

该矩阵从实现前核对表更新为当前验证记录。`version-dependent` 表示能力存在版本或运行条件差异，不能理解为所有环境无条件支持。最近一次人工联调：2026-08-22。

| 能力 | Claude Code | Codex CLI | AgentDock 统一语义 |
| --- | --- | --- | --- |
| 健康检查/版本探测 | `supported`（`claude --version`，2.1.201） | `supported`（`codex --version`，0.147.0） | 返回 runtime 版本、Adapter 版本和诊断建议。 |
| 一次性非交互执行 | `supported`（`claude -p/--print`） | `supported`（`codex exec`） | 输入任务文本，输出统一 Run 事件和终态。 |
| 流式输出 | `supported`（`--output-format=stream-json`） | `version-dependent`（`codex exec --json` 输出 JSONL） | 映射为 `message`/`tool_call`/`tool_result`/`status` 事件。 |
| 取消执行 | `supported`（由 Adapter 管理子进程生命周期） | `supported`（由 Adapter 管理子进程生命周期） | 先发优雅终止，超时后强制终止并记录原因。 |
| 创建原生 session | `supported`（首次 Run 使用 `--session-id <uuid>`，成功后才标记可恢复） | `unsupported`（当前实现不伪造 Codex 原生 session） | 返回可选的 runtime session 引用；不支持时保留 AgentDock 逻辑 Session。 |
| 恢复原生 session | `supported`（`--resume`/`--continue`） | `supported`（`codex exec resume` 命令存在） | 不支持时返回 `unsupported`，保留 AgentDock 元数据。 |
| 权限/沙箱状态 | `supported`（`--permission-mode`、`--allowed-tools`、`--disallowed-tools`） | `supported`（`--sandbox`、`--ask-for-approval`） | Adapter 声明需求，Policy 负责最终允许/拒绝。 |
| 原始输出导出 | `supported`（`json`/`stream-json` 输出） | `supported`（`--output-last-message`，JSONL stdout） | 仅保存索引或脱敏输出，按 Policy 决定。 |

当前验证结论：Claude Code 首次调用必须在 `--print --output-format stream-json` 时追加 `--verbose`；Codex 在非 Git 可信目录需要 Profile 显式设置 `skipGitRepoCheck: true`。后续 Runtime 升级时应重新运行健康检查和只读冒烟任务，并更新本表。
