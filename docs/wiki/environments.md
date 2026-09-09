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

通过 API 重新扫描：

```text
POST /api/v1/environments/<environment-id>/rescan
```

CLI 的 `run execute` 和 `session create` 会在启动前自动扫描；API 侧会先检查漂移，只有缺少 manifest 时自动创建。

## 导入、复制、备份和恢复

API 提供：

```text
POST /api/v1/environments/import
POST /api/v1/environments/<id>/copy
GET  /api/v1/environments/<id>/backups
POST /api/v1/environments/<id>/backups
POST /api/v1/environments/<id>/restore
```

复制只允许目标使用 managed 目录；导入会过滤缓存、日志、sessions、attachments、node_modules 等非配置内容。删除 Environment 配置不会删除原生目录，删除前请确认是否需要手动清理。

## 注意事项

- external Environment 至少提供 `homeDir` 或 `configDir`。
- 配置目录、state、cache 和 Secret 应分开管理。
- 配置目录不等价于 OS/容器沙箱；请同时设置 Permission 和 Runtime 自身的 sandbox/approval 参数。
- Environment 备份只覆盖配置内容，不把运行中的 SQLite 或 API token 当作配置备份。
