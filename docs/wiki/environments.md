# Environment 管理

Environment 把 Agent 的原生配置与 AgentDock 的控制元数据分开。配置目录中可以包含 Agent 的 config、skills、plugins、commands 等文件；AgentDock 只维护目录引用、manifest、hash、备份和恢复。

## managed 与 external

| 模式 | 行为 | 适用场景 |
| --- | --- | --- |
| `managed` | 默认创建 `.agentdock/environments/<id>/` 下的 `config`、`state`、`cache` 目录，并限制目录留在控制根目录内。 | 测试、隔离配置、可复制的项目环境。 |
| `external` | `homeDir` 或 `configDir` 指向现有目录，例如 `~/.claude`；不删除外部配置。 | 复用用户已有的 Agent home。 |

managed 示例：

```json
{
  "id": "claude-managed",
  "directoryMode": "managed",
  "settings": { "permissionMode": "plan", "outputFormat": "stream-json" }
}
```

external 示例：

```json
{
  "id": "claude-home",
  "homeDir": "~/.claude",
  "directoryMode": "external",
  "launchArgs": []
}
```

## manifest、hash 与漂移

首次使用时 AgentDock 会创建 Environment 目录并写入 manifest。manifest 记录目录路径、配置 hash 和扫描时间。运行前如果发现配置目录在 AgentDock 外部被修改，API 会返回 `ENVIRONMENT_RESCAN_REQUIRED`，防止用未确认的配置执行任务。

Agent 运行过程中产生的 session、缓存和 runtime 状态属于正常运行产物：运行结束后 AgentDock 会自动重新扫描并更新 manifest，下一次请求不需要手动 rescan。当前配置目录已经在运行前发生漂移时，仍需先确认变更可信，再手动 rescan；`managed` 和 `external` 都遵循这条规则。

通过 API 重新扫描：

```text
POST /api/v1/environments/<environment-id>/rescan
```

CLI 的 `run execute`、`session create` 和 API 都要求 Environment 已经 ready；只有全新的 managed 目录会自动初始化。已有目录缺少 manifest 或发生漂移时，必须先执行 `environment rescan <id>`。Run 结束后，API 会自动同步运行期间产生的目录变化。

## 导入、复制、备份和恢复

API 提供：

```text
POST /api/v1/environments/import
POST /api/v1/environments/<id>/copy
GET  /api/v1/environments/<id>/backups
POST /api/v1/environments/<id>/backups
POST /api/v1/environments/<id>/restore
```

复制和导入都只允许目标使用 managed 目录；若要引用现有原生 home，应直接创建 external Environment。copy、import、backup、restore 使用同一份 config-only 规则：skills、plugins、commands 和普通配置可以保留；`.env`、token/OAuth/credentials、session/history、SQLite/WAL、cache、log、state 和符号链接都会排除。每次操作会在 AgentDock 控制目录（默认 `.agentdock`）写入 `environment-audit.jsonl`，只记录 hash、排除类别/数量和结果，不记录文件路径或内容。删除 Environment 配置不会删除原生目录，删除前请确认是否需要手动清理。

## 本地模板

模板是控制目录中 `.agentdock/environment-templates/<template-id>/` 下不可覆盖的 config-only archive，不引入新的全局配置实体。它保存来源 Environment、Engine/版本提示、创建时间、config hash、排除类别计数和过滤后的 `config/`；绝不保存 token、认证缓存、session、state 或 cache。

```text
agentdock environment template create review-base source-environment --config <path>
agentdock environment template list --config <path>
agentdock environment template apply review-base review-derived --confirm-high-risk --config <path>
```

`apply` 从模板来源继承非敏感的 Environment 绑定，创建新的 managed Environment，并从 archive 复制配置。它会在写入前验证 archive hash 和排除规则；应用后的 `stateDir`、`cacheDir` 和原生登录状态为空，需在新 Environment 中重新登录。Control Center 或其他本地客户端可使用 `POST /api/v1/environment-templates/<template-id>/apply` 并提交新的 managed Environment 定义。

## 恢复手册

先停止或等待目标 Environment 的 Run 结束，随后运行 `agentdock environment doctor <id>`。如果报告 `drifted`，先审阅原生目录中的变更；确认可信后运行 `agentdock environment rescan <id>`，不要用自动 rescan 掩盖未知修改。

Environment 备份位于 AgentDock 控制目录的 `environment-backups/` 下，可在 Control Center 的 Environment 备份区操作，或调用：

```text
GET  /api/v1/environments/<id>/backups
POST /api/v1/environments/<id>/backups
POST /api/v1/environments/<id>/restore
```

restore 请求体必须提供 `backupId`；恢复 external Environment 时还必须明确设置 `confirmExternal: true`。恢复会先用 staging 和 hash 校验，成功后原子替换 config；已有目标 config 会先备份。历史 Run snapshot、事件和输出不会被改变，只有当前 Environment manifest 更新。

模板、copy、import、backup 和 restore 都不保留 token、OAuth/登录缓存、native session、state 或 cache。若恢复或从模板派生后丢失登录状态，应在新的 managed Environment 中重新完成 Runtime 登录；不要从旧 home 手工复制认证文件。若恢复失败，保留当前目录和历史备份，读取 API 错误码与 `environment-audit.jsonl` 的类别/数量摘要后再处理。

## 注意事项

- external Environment 至少提供 `homeDir` 或 `configDir`。
- 配置目录、state、cache 和 Secret 应分开管理。
- 配置目录不等价于 OS/容器沙箱；请同时设置 Permission 和 Runtime 自身的 sandbox/approval 参数。
- Environment 备份只覆盖配置内容，不把运行中的 SQLite 或 API token 当作配置备份。

## Environment doctor

`agentdock environment doctor <id>` 输出结构化 JSON，用于在执行前检查目录可写性、config 中的符号链接、manifest/hash 漂移、Runtime 版本、Adapter 的 native-home 合约、Permission 和 Secret Reference 是否可解析。Secret 只显示引用名和健康状态，绝不显示值；`isSecuritySandbox: false` 明确说明 Permission 是启动约束和审计策略，不是 OS/容器隔离。

内置 Codex 与 Claude Code Adapter 会声明它们使用的 home 环境变量和 session 参数。当前仓库中的合约标记为 `declared`，需要在目标机器上完成低成本只读冒烟后才可升级为 `verified`；默认测试不会调用真实模型或消耗额度。详见[运行时兼容矩阵](./runtime-compatibility)。
