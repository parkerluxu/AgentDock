# 发布就绪与恢复演练

稳定发布前，请使用仓库的[发布候选门禁清单](https://github.com/parkerluxu/AgentDock/blob/main/docs/release-checklist.zh-CN.md)。它把自动化、恢复演练、真实 Runtime 记录、跨平台结论和迁移回滚分开，避免把“测试通过”误写成“所有原生 Runtime 都已验证”。

## 自动化基线

在干净工作区执行：

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run wiki:build
git diff --check
```

CI 会在 Windows、Linux、macOS 运行无真实模型额度的回归。它覆盖 fake/Echo Adapter、路径、SQLite、SSE、Environment 文件操作和 DSH 启动器，不替代 Codex 或 Claude Code 的真实冒烟。

## 不能跳过的人工证据

1. 记录每个平台上 Codex/Claude Code 的独立 home、只读非交互 Run、Runtime/Adapter/Node 版本与日期。
2. 检查 session 恢复或不支持说明，以及 Run 后实际修改的目录类别。
3. 演练 managed backup/restore 和 external restore 的 `confirmExternal: true`；确认历史 Run snapshot 不变。
4. 未完成 Linux/macOS 验收时，把候选标为 Windows-only preview，不要宣称跨平台验证。

迁移及回滚请见[迁移指南](https://github.com/parkerluxu/AgentDock/blob/main/docs/migration-guide.zh-CN.md)，Environment 恢复步骤见[Environment 管理](./environments)。
