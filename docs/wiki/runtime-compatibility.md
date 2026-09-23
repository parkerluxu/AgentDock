# 运行时兼容矩阵

此矩阵记录 Adapter 声明的 native-home 合约。`declared` 表示已由代码路径和 CLI 参数声明，但尚未在目标 Runtime 版本上完成受控真实冒烟；它不是已验证兼容性的声明。默认自动化测试只使用 fake adapter 或 Echo Adapter，不调用真实模型。

| Runtime | Adapter 支持范围 | 原生 home 变量 | Session 参数 | 可能变更目录 | 状态 |
| --- | --- | --- | --- | --- | --- |
| Codex CLI | `>=0.147.0` | `CODEX_HOME` | `codex exec resume <thread-id>` | config、cache、session | `declared` |
| Claude Code | `>=2.1.0` | `CLAUDE_CONFIG_DIR` | `--session-id <id>`、`--resume <id>` | config、cache、session | `declared` |
| Echo | `*` | 无原生 home | 不支持 | 无 | fake/test adapter |

AgentDock 总会向 Adapter 子进程提供 `AGENTDOCK_CONFIG_DIR`、`AGENTDOCK_STATE_DIR` 和 `AGENTDOCK_CACHE_DIR`；上表仅列出各原生 Runtime 实际选择 home 的变量。`environment doctor <id>` 会显示当前 Adapter 合约、检测到的 Runtime 版本和支持范围，同时不会显示 Secret 值。

## 升级为 verified 的记录要求

在计划中的受控低成本验收中，针对每个操作系统和 Runtime 版本记录：

- `--version` 输出和实际 Adapter 版本；
- 只读、非交互 Run 使用的 home/config/state/cache 环境变量；
- 创建与恢复 Session 的命令语义；
- Run 后实际写入的目录类别；
- 不复制 token、登录状态或原生 session 的 Environment 模板/备份检查结果。

完成后更新本表和 Adapter manifest 的 `nativeHome.verification`。版本未知、超出支持范围或 contract 缺失时应保持诊断警告，不能猜测 Runtime 行为。
