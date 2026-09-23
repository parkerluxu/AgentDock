# 发布候选门禁清单

本清单用于 AgentDock 本地 Environment 管理版本的发布候选。勾选项必须附上 CI 链接、命令输出、人工冒烟记录或明确的“不适用”理由；未记录的项不能被默认视为通过。

## 自动化门禁

- [ ] 在干净工作区执行 `npm ci`。
- [ ] 执行 `npm run typecheck`、`npm test`、`npm run build`、`npm run wiki:build` 和 `git diff --check`。
- [ ] GitHub Actions 在 Windows、Linux、macOS 完成上述无真实模型额度的回归。
- [ ] 用真实的发布配置执行 `node packages/core/dist/cli.js config validate --config <absolute-config-path>`。
- [ ] 检查测试临时目录、构建产物、DSH tarball、日志样本、snapshot、audit、template 与 backup，不含测试 token 或 secret 值。
- [ ] 复核依赖、许可证和已知安全公告；记录检查日期与例外。

CI 三平台只覆盖 fake Adapter、Echo Adapter 与本地文件系统行为，不等同于真实 Codex/Claude Code 兼容性。

## 恢复与可靠性演练

- [ ] API 重启并重新打开 SQLite 后，历史 Run、Session 与 snapshot 仍可读取。
- [ ] SSE 客户端在 `accepted` 后断开并从 `after=<sequence>` 恢复，不重复执行或重复消费事件。
- [ ] 对 managed Environment 演练 config-only copy/template、backup/restore 中断和成功恢复；确认历史 Run snapshot 不变。
- [ ] 对 external Environment 演练 restore 的 `confirmExternal: true` 二次确认；不删除或覆盖未确认的目录。
- [ ] 演练 drifted → 人工审阅 → rescan → 可执行，且未经 rescan 的 Run 被拒绝。
- [ ] 演练 DSH 复用既有 API 和启动自有 API 两种路径；确认 token 仅注入 DSH 子进程环境，退出时只清理由启动器拥有的 API。

## 真实 Runtime 与平台记录

- [ ] 在每个声明支持的平台，针对 Codex CLI 与 Claude Code 各运行一次独立 native home 的只读、非交互冒烟；记录 Runtime/Adapter/Node 版本、平台、日期和命令。
- [ ] 记录 native home/config/state/cache 变量、session 创建/恢复或不支持说明、以及 Run 后目录类别。
- [ ] 按 [Runtime 能力矩阵](./runtime-capability-matrix.md) 的要求更新 `nativeHome.verification`、支持范围和已知限制。没有记录时状态必须保持 `declared`。
- [ ] 若 Linux/macOS 验收未完成，将候选明确标记为 **Windows-only preview**；不得声称跨平台已验证。

## 迁移、回滚与对外说明

- [ ] 更新 README、API/OpenAPI、SDK、CLI、DSH、故障排查、兼容矩阵和安全边界文档。
- [ ] 由未参与开发的试用者按 [迁移指南](./migration-guide.zh-CN.md) 与 Environment 恢复手册完成一次 Agent-first 调用和恢复演练。
- [ ] 在发布说明中说明：Agent-first 入口、`POST /runs`/`run execute` 的高级兼容用途、legacy Project Environment 字段的兼容期，以及当前没有已宣布的移除日期。
- [ ] 写清回滚版本、配置备份位置、已知限制（仅回环 API、可信本机边界、无 OS/容器 sandbox、未验证 Runtime 版本、DSH 支持范围）。
- [ ] 任何 schema、API、CLI JSONL 或事件格式变更均同步提供 OpenAPI/示例、兼容说明和可恢复的回滚路径。

发布负责人只有在所有必要项都有可审计证据后，才能签署候选；真实 Runtime 或跨平台项未完成时，保留 preview 状态并在发布说明中突出显示。
