# 配置参考（v1）

配置文件是 JSON，默认路径为 `.agentdock/config.json`。相对路径以配置文件所在目录为基准；未配置 `dataDir` 时使用当前工作目录下的 `.agentdock/data`。配置版本当前为 `1`，未知字段会被拒绝。

## 数据、日志和脱敏

```json
{
  "version": 1,
  "dataDir": "../.agentdock/data",
  "storage": {
    "retentionDays": 30,
    "saveOutput": true
  },
  "logging": {
    "level": "warn"
  },
  "redaction": {
    "additionalKeys": ["customerSecret"]
  }
}
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `dataDir` | `.agentdock/data` | SQLite 数据库、API token 文件和本地 Adapter 注册目录的父目录。已有旧版直接数据库文件会继续读取。 |
| `storage.retentionDays` | 不自动删除 | 服务/CLI 打开 SQLite 时删除已结束且超过期限的 Run、事件和失去关联的幂等记录。`queued`/`running` 永不因保留策略删除。 |
| `storage.saveOutput` | `true` | 为 `false` 时不保存消息、工具参数/结果、stdout、stderr 和常见 output 字段；状态、序号、时间和错误码仍保留。 |
| `logging.level` | `warn` | 可选 `debug`、`info`、`warn`、`error`。日志为单行 JSON，写入 stderr。 |
| `redaction.additionalKeys` | `[]` | 与默认敏感键合并，大小写和标点不影响匹配。适用于 Run、事件、API JSON/SSE 和结构化日志。 |

默认脱敏键包括 `token`、`password`、`secret`、`authorization`、`credential` 和 `apiKey`。Secret Provider 解析出的实际 secret 也会在 Run 执行期间按值遮蔽。脱敏不能替代权限策略；`saveOutput: false` 是减少落盘内容的策略，不是 OS 级沙箱。

## Runtime、Profile、Project 和 Policy

`runtimes` 声明可执行 Runtime 的 id、Adapter、二进制、参数、版本和能力。`profiles` 将 Runtime 与 Policy 绑定；`projects.profileIds` 限定项目可用 Profile，`defaultProfileId` 让 API 路由可确定地选择默认 Profile。

Policy 当前强制目录根、是否允许写入、环境变量白名单和网络策略。环境变量中的 secret 只保存 reference，例如：

```json
{
  "policies": [
    {
      "id": "readonly-local",
      "filesystem": { "roots": ["."], "write": false },
      "environment": {
        "allow": ["PATH"],
        "secretRefs": {
          "SERVICE_TOKEN": { "provider": "env", "key": "SERVICE_TOKEN" }
        }
      },
      "network": "deny"
    }
  ]
}
```

当前目录和环境变量白名单由 AgentDock 解析并传给 Adapter，但不等价于容器或 OS 强制隔离。需要网络、写入、shell 或新增 secret 的本地 Adapter 必须在 manifest 声明权限，并在启用时显式授予。

## 校验和升级

修改配置后先执行：

```text
npm run config:validate -- .agentdock/config.json
node dist/cli.js doctor --config .agentdock/config.json
```

建议先备份 `.agentdock/data/agentdock.db` 和 `adapters/registry.json`。AgentDock 会迁移 SQLite schema，但不会自动改变历史 Run 快照，也不会删除旧数据库文件。配置 schema 的破坏性变更必须提升 `version` 并提供迁移说明；v1 增加可选字段时保持默认行为不变。
