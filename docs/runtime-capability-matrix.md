# Runtime 能力矩阵

最后审阅：2026-09-23。本表的 Codex CLI 与 Claude Code 行来自 Adapter 合约和自动化契约测试。已在 Windows 上记录 `--version` 探测；尚未记录独立 home 的只读执行或 session 冒烟。因此 native-home 与 session 语义均为 `declared`，不能视为目标机器上的兼容性保证。每次 Runtime/Adapter 更新按[兼容矩阵更新流程](./adapter-compatibility-process.zh-CN.md)执行。

| Runtime | 声明支持范围 | execute / stream / cancel / healthcheck | create / resume session | 原生 home | 已验证版本、平台、日期 | 状态与已知限制 |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `>=2.1.0` | `execute`、`stream_events`、`cancel`、`healthcheck` | `create_session`、`resume_session` | `CLAUDE_CONFIG_DIR`；config、cache、session 可变 | `2.1.201` — Windows，2026-09-23；仅 `--version` | `declared`。Adapter 会使用 `--print --output-format stream-json --verbose`，创建使用 `--session-id <id>`，恢复使用 `--resume <id>`。 |
| Codex CLI | `>=0.147.0` | `execute`、`stream_events`、`cancel`、`healthcheck` | 不创建原生 session；声明 `resume_session` | `CODEX_HOME`；config、cache、session 可变 | `0.147.0` — Windows，2026-09-23；仅 `--version` | `declared`。Adapter 使用 `codex exec --json`，恢复使用 `codex exec resume <thread-id>`；可按设置传递 `--skip-git-repo-check`。 |
| Echo | `*` | `execute`、`stream_events`、`cancel`、`healthcheck` | 不支持 | 无 | 自动化测试 | fake/test Adapter，不代表原生 Runtime。 |

`environment doctor <id>` 和 `GET /api/v1/agent-health` 都不会在 Control Center 刷新时启动 Runtime 或读取 secret 值。要显式探测二进制版本，运行 `engine health <engine-id>`；它会执行 Runtime 的 `--version`。Environment Permission 是启动约束与审计策略，不是 OS、容器或 VM sandbox。

## 升级为 verified 的记录要求

在每个操作系统和 Runtime 版本上，完成并记录受控、只读、非交互冒烟：

1. Runtime `--version`、Adapter 版本、操作系统、Node 版本和日期；
2. 启动时使用的 home/config/state/cache 环境变量；
3. 一次独立 home 的只读执行，以及可恢复 session 或明确的不支持说明；
4. Run 后写入目录类别，及 template/backup 未复制 token、登录状态、session 的检查结果；
5. 对失败的 Runtime 版本记录可操作诊断和回滚范围。

完成后才能将对应 Adapter 的 `nativeHome.verification` 改为 `verified`，并把版本、平台和日期写入本表；未知或超出声明范围的行为必须保持警告状态。
