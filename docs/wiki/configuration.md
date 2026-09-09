# 配置模型

配置文件是版本为 `1` 的严格 JSON。默认路径为 `.agentdock/config.json`，也可以通过所有 CLI 命令的 `--config <path>` 指定。

## 顶层字段

| 字段 | 用途 |
| --- | --- |
| `version` | 当前必须为 `1`。 |
| `dataDir` | SQLite、token、Adapter registry 等数据的父目录；相对配置文件解析。 |
| `engines` | 可执行 Runtime 和 Adapter 声明。 |
| `environments` | Agent 原生 home/config/state/cache 目录。 |
| `environmentPermissions` | 文件、网络、环境变量和 Secret 策略。 |
| `agents` | Engine、Environment、Permission 的绑定。 |
| `projects` | 工作目录和可调用 Agent 列表。 |
| `storage` | `retentionDays`、`saveOutput`。 |
| `logging` | `debug`、`info`、`warn`、`error`。 |
| `redaction` | 额外需要脱敏的对象键。 |

## 一份可运行的结构

仓库内的 [`examples/config.example.json`](https://github.com/parkerluxu/AgentDock/blob/main/examples/config.example.json) 已包含 Claude Code 和 Codex 的完整示例。结构可以概括为：

```json
{
  "version": 1,
  "dataDir": "../.agentdock/data",
  "engines": [
    {
      "id": "claude-code",
      "adapter": "claude-code",
      "binary": "claude",
      "enabled": true,
      "capabilities": ["execute", "stream_events", "cancel", "healthcheck"]
    }
  ],
  "environments": [
    {
      "id": "claude-home",
      "homeDir": "~/.claude",
      "directoryMode": "external",
      "settings": { "permissionMode": "plan", "outputFormat": "stream-json" }
    }
  ],
  "environmentPermissions": [
    {
      "id": "readonly-local",
      "filesystem": { "roots": ["."], "write": false },
      "environment": { "allow": ["PATH", "HOME"] },
      "network": "deny"
    }
  ],
  "agents": [
    {
      "id": "claude-reviewer",
      "engineId": "claude-code",
      "environmentId": "claude-home",
      "permissionId": "readonly-local",
      "enabled": true
    }
  ],
  "projects": [
    {
      "id": "agentdock",
      "rootDir": "..",
      "agentIds": ["claude-reviewer"],
      "defaultAgentId": "claude-reviewer"
    }
  ]
}
```

## 路径与目录规则

- 配置中的相对路径以配置文件所在目录为基准。
- managed Environment 默认位于 `.agentdock/environments/<id>/`，且 config/state/cache 必须留在该根目录内。
- external Environment 至少提供 `homeDir` 或 `configDir`；AgentDock 不删除外部配置目录。
- `dataDir` 默认是 `.agentdock/data`，数据库文件为 `<dataDir>/agentdock.db`。
- 旧版本曾把 `dataDir` 当作数据库文件；如果该路径已经是文件，AgentDock 会继续读取它。

## 校验与修改

```text
npm run config:validate -- .agentdock/config.json
node dist/cli.js doctor --config .agentdock/config.json
```

校验包括 JSON/schema、ID 唯一性、引用存在性、Project 默认项归属和 Environment 继承环。Web 配置中心保存前还会做跨对象校验、dry-run、差异和高风险确认；保存使用 revision/hash 冲突检测、临时文件和原子替换，成功后需要重启 API。

完整字段、迁移注意事项和数据策略见[配置参考](https://github.com/parkerluxu/AgentDock/blob/main/docs/configuration-reference.zh-CN.md)。
