# 通俗案例：先用 Echo 看懂一条任务

假设小王第一次打开 AgentDock，想弄清“我装好以后，该怎么判断它正常工作？”他不需要先安装模型 CLI，也不需要先理解整个代码库。下面用内置 Echo 跑通从配置到历史记录的完整路径。

## 先理解几个角色

- Engine：执行方式。Echo 是内置演示 Engine；真实使用时可换成 Codex 或 Claude Code。
- Agent：一个可供选择的工作身份，绑定 Engine、Environment 和 Permission。
- Environment：Agent 自己的配置、状态与缓存目录。
- Project：任务的工作目录，以及允许使用哪些 Agent。
- Permission：AgentDock 应用层的文件、网络和环境变量规则。
- Run：一次任务记录，包含开始时配置快照、事件和最终状态。

## 第一步：安装依赖并构建 core

从仓库根目录运行：

~~~powershell
npm ci
npm run build --workspace agentdock
node .\packages\core\dist\cli.js config validate .\packages\core\examples\config.quickstart.json
~~~

入门配置使用独立的 quickstart-data，不会覆盖默认 .agentdock/config.json，也不需要安装单独的 Echo 包。

## 第二步：先预览路线

~~~powershell
node .\packages\core\dist\cli.js run dry-run --config .\packages\core\examples\config.quickstart.json --agent echo-agent --project agentdock-demo "查看这个项目"
~~~

小王会看到 AgentDock 选择的 Agent、Engine、Environment、Project 工作目录和权限。dry-run 只做解析，不启动 Agent，也不写入 Run。

## 第三步：执行一次安全的本地 Run

~~~powershell
node .\packages\core\dist\cli.js run execute --config .\packages\core\examples\config.quickstart.json --agent echo-agent --project agentdock-demo "你好，AgentDock"
node .\packages\core\dist\cli.js run list --config .\packages\core\examples\config.quickstart.json
~~~

Echo 会把输入作为消息返回，不会理解项目内容，也不会调用模型。第一次执行会创建 .agentdock/quickstart-data/ 下的 SQLite 历史和 managed Environment。保存输出中的 Run ID 后，可以继续用 run show、run events 查看该次执行。

## 第四步：在网页里查看

另开终端运行：

~~~powershell
node .\packages\core\dist\cli.js api serve --config .\packages\core\examples\config.quickstart.json --port 4177
~~~

打开 http://127.0.0.1:4177/ 并按启动信息取得本地 API Token。概览页选择 Project agentdock-demo，再打开刚才的 Run 查看快照和事件时间线。

## 真正分析项目测试失败

Echo 只适合确认安装、路由、Run 和历史保存链路。要让 Agent 阅读或修改真实仓库，需要另行安装、登录 Codex CLI 或 Claude Code CLI，在 AgentDock 配置里启用对应 Engine/Agent，并为 Project 设置正确 rootDir。开始真实执行前先 doctor、engine health 和 dry-run；真实调用可能消耗模型额度。详见[安装与快速上手](./getting-started)和[配置模型](./configuration)。

## 这个案例的关键收获

1. Engine 是执行方式，Agent 把 Engine、Environment 和 Permission 组合起来。
2. Project 的 rootDir 决定 Agent 工作目录；AgentDock 不靠启动终端所在目录猜测。
3. 先 dry-run 检查路由和权限，再决定是否运行真实 Agent。
4. Run 和 SQLite 历史便于复盘；入门演示数据与默认数据隔离。
