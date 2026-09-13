# CLI 参考

使用构建后的 CLI：

```text
node dist/cli.js
```

所有命令都支持 `--config <path>`，默认配置路径为 `.agentdock/config.json`。

| 命令 | 用途 |
| --- | --- |
| `config validate [path]` | 校验 JSON、Schema、ID 和对象引用。 |
| `engine list` | 查看 Engine、Adapter、二进制程序、启用状态和注册状态。 |
| `engine health <engine-id>` | 检查 Runtime 版本和健康状态。 |
| `doctor` | 诊断配置、Adapter、Runtime 和 Environment。 |
| `environment list` | 查看 Environment 定义。 |
| `agent list` | 查看可调用的 Agent 及其绑定。 |
| `agent run <agent-id> <task>` | 以指定 Agent 执行任务并输出 JSONL 事件。 |
| `project list/show <id>` | 查看 Project。 |
| `run dry-run <task>` | 解析执行上下文，但不启动 Agent。 |
| `run execute <task>` | 执行任务并输出 JSONL 事件。 |
| `run list/show/events/export <id>` | 查询或导出 Run。 |
| `session create/list/show/archive` | 管理可复用的 Session。 |
| `api serve` | 启动本地 API 和 Control Center。 |
| `adapter install/list/enable/disable/uninstall` | 管理本地 Adapter。 |

常用命令：

```text
node dist/cli.js run dry-run --config examples/config.example.json --project agentdock "检查当前仓库"
node dist/cli.js agent run codex-reviewer --config examples/config.example.json --project agentdock "总结当前仓库"
node dist/cli.js run list --config examples/config.example.json --status succeeded --limit 20
node dist/cli.js run export --format jsonl --config examples/config.example.json <run-id>
```

## 从任意 PowerShell 目录运行

PowerShell 当前目录不需要是 AgentDock 源码目录。构建完成后，可以用 CLI 入口和配置文件的绝对路径：

```powershell
$repo = "D:\AI_agent\cases\AgentDock"
$config = "$repo\examples\config.example.json"
node "$repo\dist\cli.js" agent run new-agent --config $config --project other-project hello
```

这里的 `other-project` 必须是配置中已存在的 Project，并且它的 `rootDir` 指向目标工作目录、`agentIds` 包含 `new-agent`。`cd` 到目标目录不会覆盖 Project 的 `rootDir`；CLI 当前也没有单次调用级别的 `--cwd` 参数。配置文件中的相对路径仍以配置文件所在目录为基准。

如果希望在任意目录直接输入 `agentdock`，可以在源码目录执行一次 `npm link`，之后仍建议传入绝对 `--config`：

```powershell
Push-Location "D:\AI_agent\cases\AgentDock"
npm link
Pop-Location
agentdock agent run new-agent --config "D:\AI_agent\cases\AgentDock\examples\config.example.json" --project other-project hello
```

SDK 的任意目录调用、ESM 和 Node.js 模块说明见[任意目录调用 CLI 与 SDK](./sdk)。

退出码：`0` 表示成功，`2` 表示输入或配置错误，`3` 表示 Run 失败或超时，`130` 表示通过 Ctrl+C 取消。
