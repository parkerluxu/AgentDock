# Control Center UI 使用指南

Control Center 是 AgentDock 自带的本地网页界面。它只负责查看状态、审计历史和编辑配置；启动或取消 Run 仍应使用 CLI 或 API。

## 1. 启动并登录

在仓库根目录执行：

```text
npm run build
node packages/core/dist/cli.js api serve --config packages/core/examples/config.example.json --port 4177
```

浏览器打开 `http://127.0.0.1:4177/`。首次进入会看到 token 输入框，把 API 启动 JSON 中的 token（或 `api-token` 文件内容）粘贴进去即可。token 只保存在当前浏览器的 local storage，不会写入 Wiki 或 URL。

右上角的 `中 / EN` 可以切换界面语言；手动选择会被记住，下次打开仍使用上次语言。点击“退出”会清除浏览器中的 token。

## 2. 概览页：先看系统是否健康

登录后默认进入“概览”：

- 顶部状态显示 API 是否已连接，可用“刷新”重新读取数据。
- 统计卡片显示 Run 总数、进行中的 Run、成功数和 Session 数。
- “最近 Runs”表格列出 Run、状态、Engine、Project 和创建时间。
- 状态筛选可以只看 `queued`、`running`、`succeeded`、`failed`、`cancelled` 或 `timed_out`。
- Project 筛选可以缩小到某个项目。

点击一行 Run 后，右侧/下方会显示：

1. Run 的 ID、状态、Engine、Environment、Project、Session。
2. 执行快照，包括工作目录、允许的环境变量和 Environment 配置 hash。
3. 按 sequence 排序的事件时间线：状态、消息、工具调用、工具结果和错误。

建议先从快照确认“它在哪里运行、用了哪个权限”，再阅读消息和工具事件。

## 3. 配置中心：推荐按顺序操作

点击侧边栏“配置中心”，页面会显示五类实体：

1. **Agent Engines**：可执行文件、Adapter、能力、版本和启用状态。
2. **Agent Environments**：home/config/state/cache 目录、目录模式和启动参数。
3. **Projects**：项目根目录、允许使用的 Agent 和默认 Agent。
4. **Environment Permissions**：文件根、是否写入、环境变量白名单、Secret Reference 和网络策略。
5. **Agents**：把 Engine、Environment 和 Permission 绑定成真正可调用的 Agent。

实际配置时推荐顺序为：Engine → Environment → Permission → Agent → Project。Project 页面会列出可勾选的 Agent，不需要手写 ID；默认 Agent 必须是已勾选项。

## 4. 表单模式与高级 JSON

每类实体都有“表单”和“高级 JSON”两种模式：

- 表单适合日常修改，常用字段会被拆成易读控件。
- 高级 JSON 只编辑当前选中的对象，适合设置 Runtime 特有的 `settings` 或批量调整字段。
- “新增”创建一个带默认值的新对象；“删除”只修改候选配置，尚未写盘。
- “恢复原值”丢弃当前未保存修改。

Environment Permission 的 Secret 区域只编辑 provider/key reference，界面不会读取或回显明文 Secret。

## 5. 预览、保存和恢复

不要直接点击保存，推荐每次遵循：

1. 修改表单或 JSON。
2. 点击“预览变更”。
3. 阅读校验结果、字段差异、dry-run 和 Permission 问题。
4. 如果出现写入、网络、shell/command 或 Secret Reference 变化，勾选高风险确认。
5. 点击“保存配置”。
6. 安全配置会自动热加载；如果响应返回 `restartRequired: true`，再重启 API 服务。

页面会使用 revision/hash 检测并发修改；如果另一个进程先保存，当前保存会被拒绝，需要重新加载后再编辑。配置保存会产生备份，可在“备份”区域恢复；恢复也会在安全时自动热加载。数据目录变化等不能安全切换的情况会返回重启原因。

## 6. UI 能做什么、不能做什么

| 操作 | UI 支持 |
| --- | --- |
| 查看 Engine、Environment、Project、Session、Run | 支持 |
| 查看 Run snapshot 和事件时间线 | 支持 |
| 编辑和预览配置 | 支持 |
| 备份/恢复配置 | 支持 |
| 启动 Run | 不支持，请用 CLI/API |
| 取消 Run | 不支持，请用 CLI/API |
| 读取 Secret 明文 | 不支持 |
| 把 API 暴露到远程主机 | 不支持，也不建议 |

遇到“配置已保存但运行结果没变化”，先检查保存响应中的 `restartRequired` 和 `restartReasons`；遇到 Environment 漂移，则先按[Environment 管理](./environments)重新扫描。
