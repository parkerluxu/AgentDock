# 数据、权限与安全边界

AgentDock 的设计目标是“本地控制和可审计”，不是把任意 Agent 变成强隔离沙箱。请把 Permission、Runtime 原生安全选项和主机安全策略一起使用。

## API 边界

- API 只监听 `127.0.0.1` / `::1`。
- 每个请求需要 Bearer token；自动生成 token 保存在数据库同目录的 `api-token` 文件。
- token 不应写入任务、日志、Run 导出、源码或 Git。
- 不要通过端口转发、反向代理或防火墙规则把 API 暴露给其他主机。

## Permission

Environment Permission 当前控制：

- `filesystem.roots`：允许访问的目录根。
- `filesystem.write`：是否允许写入。
- `environment.allow`：允许传给子进程的非 secret 环境变量。
- `environment.secretRefs`：Secret Reference，而不是明文 secret。
- `network`：`deny` 或 `allow`。

默认建议从只读、无网络开始：

```json
{
  "filesystem": { "roots": ["."], "write": false },
  "environment": { "allow": ["PATH"] },
  "network": "deny"
}
```

本地 Adapter 的 `requiredPermissions` 必须在 manifest 中声明，启用时逐项授予。声明和授权是生命周期边界，不等价于 OS/容器隔离。

## Secret 与脱敏

Secret Provider 解析出的实际值只在执行期间进入子进程环境。Run、事件、API JSON/SSE、结构化日志和导出会按默认敏感键（如 `token`、`password`、`secret`、`authorization`、`credential`、`apiKey`）及 `redaction.additionalKeys` 脱敏。

`storage.saveOutput: false` 会阻止消息、工具参数/结果和 stdout/stderr 落盘，但仍保留状态、序号、时间和错误码。它减少数据暴露，不改变 Agent 权限。

## 数据保留与备份

`storage.retentionDays` 只清理超过期限的终态 Run、事件和失去关联的幂等记录；`queued` / `running` 不会因保留策略删除。SQLite 数据库、Environment 配置备份和 API token 都属于本地敏感数据，建议纳入主机备份和访问控制。

配置编辑 API 会使用 revision/hash 防止并发覆盖，原子写入临时文件并保留备份；审计日志只记录版本、差异路径和风险摘要，不记录配置值。
