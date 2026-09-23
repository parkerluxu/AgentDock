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

## Agent Engine、Agent Environment、Project 和权限

新的配置模型中，`engines` 只声明可执行程序和 Adapter；`environments` 表示一个完整的 Agent 原生 home 目录；`agents` 才是对外可调用单位，绑定一个 Engine、一个 Environment 和一个 Environment Permission；`projects.agentIds` 限定项目可调用的 Agent，`defaultAgentId` 选择默认 Agent。

一个 Environment 的 `homeDir` 可以直接指向 `~/.codex`、`~/.claude` 等现有目录，目录中的 config、skills、plugins、commands 等文件都属于该 Environment。`configDir`、`stateDir`、`cacheDir` 用于明确拆分目录职责；未指定 `homeDir` 时，managed Environment 使用 `.agentdock/environments/<id>/config` 作为完整 home。Agent 的 `processEnv` 是非 secret 的子进程环境覆盖；父进程变量仍必须先通过 Permission 的 `environment.allow` 白名单。

Agent 原生配置目录是 Environment 的事实来源。AgentDock 管理目录引用、manifest、配置 hash、rescan、备份和恢复，但不把每种 Agent 的全部配置字段复制为平台字段。配置目录、状态目录、缓存目录和 Secret 必须分开；配置目录也不等价于 OS/容器级安全沙箱。

Environment 的 copy、import、backup、restore 均是 config-only 操作；import 的目标必须为 managed Environment，已有原生 home 应创建 external Environment 直接引用。普通 config、skills、plugins、commands 可以保留，但 `.env`、token/OAuth/credentials、session/history、SQLite/WAL、cache、log、state 与符号链接一律排除。每次操作会向 AgentDock 控制目录（默认 `.agentdock`）中的 `environment-audit.jsonl` 写入不含路径、文件内容或 secret 值的 hash、排除类别/数量与结果摘要。

本版本只接受新的 `engines`、`environments`、`environmentPermissions` 配置模型。旧的 `runtimes`、`profiles`、`policies` 根字段会被严格 schema 拒绝；这是一次有意的破坏性配置替换。`.agentdock` 下的 SQLite、历史 Run 和 Agent 原生目录仍会保留，不会因配置替换被删除。

Environment 权限（内部仍由 Policy 类型执行）当前强制目录根、是否允许写入、环境变量白名单和网络策略。环境变量中的 secret 只保存 reference，例如：

```json
{
  "environmentPermissions": [
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

## Web 配置编辑边界（阶段 3 第一版）

访问 API 根路径的 Control Center 后，进入唯一的“配置中心”入口，可以在同一处切换编辑 Agent、Agent Engine、Agent Environment、Project 和 Environment Permission。建议按 Agent → Engine → Environment → Project 的顺序配置：Project 表单会直接列出 Agent 并支持勾选，不需要手写 ID；默认 Agent 只能从已勾选项中选择。常用字段提供表单；高级 JSON 只编辑当前选中的对象，保存时合并回配置。保存前调用同源配置 API 展示 schema/跨对象/权限校验、`dry-run`、风险说明和字段差异。

配置快照带有 `revision/hash`。服务保存前会重新读取磁盘配置，revision 不匹配时拒绝覆盖。写入采用同目录临时文件和原子替换，原文件保存为备份；审计事件追加写入 `config-audit.jsonl`。备份页可恢复任一可用备份，失败的审计写入会尝试回滚配置。安全配置保存或恢复后会自动热加载；`dataDir` 变化或运行时组件无法切换时会提示重启 API。

Web 看板只允许使用 `environment.secretRefs` 编辑 Secret Reference，不允许读取、回显或保存明文 secret。开启文件写入、网络、shell/command 或新增/变更 Secret Reference 等高风险配置需要二次确认。配置变更不会改写历史 Run snapshot。

## 校验和升级

修改配置后先执行：

```text
npm run config:validate -- .agentdock/config.json
node dist/cli.js doctor --config .agentdock/config.json
```

建议先备份 `.agentdock/data/agentdock.db` 和 `adapters/registry.json`。AgentDock 会迁移 SQLite schema，但不会自动改变历史 Run 快照，也不会删除旧数据库文件。配置 schema 的破坏性变更必须提升 `version` 并提供迁移说明；v1 增加可选字段时保持默认行为不变。
