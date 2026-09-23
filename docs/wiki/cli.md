# CLI 参考

使用构建后的 CLI：

```text
node packages/core/dist/cli.js
```

所有命令都支持 `--config <path>`，默认配置路径为 `.agentdock/config.json`。

| 命令 | 用途 |
| --- | --- |
| `config validate [path]` | 校验 JSON、Schema、ID 和对象引用。 |
| `engine list` | 查看 Engine、Adapter、二进制程序、启用状态和注册状态。 |
| `engine health <engine-id>` | 检查 Runtime 版本和健康状态。 |
| `doctor` | 诊断配置、Adapter、Runtime 和 Environment。 |
| `environment doctor <id>` | 输出一个 Environment 的目录可写性、符号链接、manifest/漂移、Adapter native-home 合约、Permission 和 Secret Reference（不显示值）。 |
| `environment list` | 查看 Environment 定义。 |
| `environment rescan <id>` | 显式确认现有 Environment 配置并更新 manifest/hash。 |
| `environment template create/list/apply` | 创建、列出或应用不可变 config-only 模板；`apply` 会新建 managed Environment，且必须带 `--confirm-high-risk`。 |
| `agent list` | 查看可调用的 Agent 及其绑定。 |
| `agent run <agent-id> [--format jsonl\|human] [--dry-run] <task>` | 推荐调用入口。默认输出 `accepted → event* → result/error` JSONL；Environment 由 Agent binding 解析。 |
| `project list/show <id>` | 查看 Project。 |
| `run dry-run <task>` | 解析执行上下文，但不启动 Agent。 |
| `run execute <task>` | 高级显式路由入口；可指定 Environment，适用于批处理、队列和恢复工具。 |
| `run list/show/events/export <id>` | 查询或导出 Run。 |
| `session create/list/show/archive` | 管理可复用的 Session。 |
| `api serve` | 启动本地 API 和 Control Center。 |
| `adapter install/list/enable/disable/uninstall` | 管理本地 Adapter。 |

常用命令：

```text
node packages/core/dist/cli.js agent run codex-reviewer --dry-run --config packages/core/examples/config.example.json --project agentdock "检查当前仓库"
node packages/core/dist/cli.js agent run codex-reviewer --config packages/core/examples/config.example.json --project agentdock "总结当前仓库"
node packages/core/dist/cli.js agent run codex-reviewer --format human --config packages/core/examples/config.example.json --project agentdock "总结当前仓库"
node packages/core/dist/cli.js run list --config packages/core/examples/config.example.json --status succeeded --limit 20
node packages/core/dist/cli.js run export --format jsonl --config packages/core/examples/config.example.json <run-id>
```

`agent run` 的第一行 `accepted` 包含 `runId`、Agent、Project、Session 和恢复命令；每个后续 `event` 行包裹一个标准 Run event，最后一行是 `result`。调用错误输出 `error` JSONL，诊断仍写入 stderr。`--format human` 只输出消息、工具开始/结束和最终 Run 状态。高层 Agent 调用不接受 `--environment`；需要显式指定时使用 `run execute`。

`run dry-run` 和 `agent run --dry-run` 会输出 `routing`：选择模式、最终 Agent/Environment/Engine、所有候选 Agent、运行时健康状态以及每个被拒绝候选的理由。无法路由时仍会输出 `executes: false` 和相同的候选说明，便于脚本和 Control Center 显示可操作原因。

## 从任意 PowerShell 目录运行

PowerShell 当前目录不需要是 AgentDock 源码目录。构建完成后，可以用 CLI 入口和配置文件的绝对路径：

```powershell
$repo = "D:\AI_agent\cases\AgentDock"
$config = "$repo\packages\core\examples\config.example.json"
node "$repo\packages\core\dist\cli.js" agent run new-agent --config $config --project other-project hello
```

这里的 `other-project` 必须是配置中已存在的 Project，并且它的 `rootDir` 指向目标工作目录、`agentIds` 包含 `new-agent`。`cd` 到目标目录不会覆盖 Project 的 `rootDir`；CLI 当前也没有单次调用级别的 `--cwd` 参数。配置文件中的相对路径仍以配置文件所在目录为基准。

如果希望在任意目录直接输入 agentdock，可从源码根目录打包并全局安装 core workspace，之后仍建议传入绝对 --config：

```powershell
npm pack --workspace agentdock
npm install --global .\agentdock-0.1.3-dev.tgz
agentdock agent run new-agent --config "D:\AI_agent\cases\AgentDock\packages\core\examples\config.example.json" --project other-project hello
```

SDK 的任意目录调用、ESM 和 Node.js 模块说明见[任意目录调用 CLI 与 SDK](./sdk)。

退出码：`0` 表示成功，`2` 表示输入或配置错误，`3` 表示 Run 失败或超时，`130` 表示通过 Ctrl+C 取消。
