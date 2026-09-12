# 通俗案例：小王审查一次仓库

假设小王想让 Agent “帮我看看这个项目的测试为什么失败”，但他不熟悉 AgentDock。下面把一次完整操作翻译成生活化的步骤。

## 先理解四个角色

- **Engine**：像“发动机”，例如 Claude Code 或 Codex。
- **Environment**：像“工作桌”，放 Agent 自己的配置、插件和状态。
- **Permission**：像“门禁卡”，规定能看哪些目录、能不能写文件、能不能联网。
- **Project**：像“任务房间”，规定要在哪个仓库工作、允许哪些 Agent 进入。

一次 Run 就像一张“操作记录单”：开始前把发动机、工作桌、门禁卡和仓库位置拍照存档，结束后还能查看每一步事件。

## 第一步：准备项目

小王先安装依赖并构建：

```text
npm ci
npm run build
npm run config:validate -- examples/config.example.json
node dist/cli.js doctor --config examples/config.example.json
```

如果机器没有 Claude Code/Codex，他可以安装 Echo Adapter 做无模型演示：

```text
node dist/cli.js adapter install examples/adapter-echo --config examples/config.example.json
node dist/cli.js adapter enable example-echo --config examples/config.example.json
```

## 第二步：先问“它会怎么做”

小王不急着执行，先 dry-run：

```text
node dist/cli.js run dry-run --config examples/config.example.json --project agentdock "找出测试失败的原因"
```

这一步像出发前看导航：AgentDock 会告诉他将使用哪个 Agent、哪个 Environment、哪个工作目录，以及网络和写入是否允许。dry-run 不会启动真实 Agent，也不会消耗模型配额。

## 第三步：执行任务

确认路线没问题后：

```text
node dist/cli.js run execute --config examples/config.example.json --environment claude-code-home "找出测试失败的原因"
```

终端会连续打印 JSONL 事件。小王不需要读懂每个字段，只要记住最后的 Run ID；它就像快递单号。

## 第四步：在网页里查看

另开终端启动 Control Center：

```text
node dist/cli.js api serve --config examples/config.example.json --port 4177
```

打开 `http://127.0.0.1:4177/`，输入启动输出的 token：

1. 在概览页按 Project 筛选 `agentdock`。
2. 点击刚才的 Run。
3. 先看“执行快照”，确认工作目录和 Permission。
4. 再看事件时间线，了解 Agent 何时开始、调用了什么工具、最后为何成功或失败。

如果小王发现配置不合适，例如想禁止写入文件，他进入“配置中心”，修改 Permission，点击“预览变更”并保存。安全变更会立即热加载，下一次 Run 会使用新规则，旧 Run 的快照不会被改写；如果响应提示需要重启，再重启 API。

## 第五步：把结果交给脚本

如果小王想让 CI 读取结果，可以使用 API：

```text
POST /api/v1/runs
GET  /api/v1/runs/<run-id>/events?stream=sse
```

客户端保存最后的事件 sequence，断线后使用 `after=<sequence>` 继续读取，不会因为网络短暂中断而丢失事件。完整客户端见 [`examples/api-client`](https://github.com/parkerluxu/AgentDock/tree/main/examples/api-client)。

## 这个案例的关键收获

1. 先 dry-run，再 execute，避免“还没看清权限就开跑”。
2. 用 Project 和 Agent 固定工作范围，不靠每次手写路径。
3. 用 UI 看快照和事件，用 CLI/API 做执行和自动化。
4. 修改配置后要预览、保存；安全变更会热加载，历史 Run 仍保持原样。
