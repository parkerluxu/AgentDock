# 从源码构建与本地部署

AgentDock 仓库用 npm workspaces 管理两个主要包：核心 CLI/API 包 agentdock，以及可选的 DSH 插件 @agentdock/dsh。Wiki 是第三个独立产物，通过 VitePress 构建。

## 获取依赖并构建

要求 Node.js >=22.5 和 npm。在仓库根目录安装依赖：

~~~powershell
npm ci
~~~

只用 core CLI/API 时，只构建核心 workspace：

~~~powershell
npm run build --workspace agentdock
node .\packages\core\dist\cli.js config validate .\packages\core\examples\config.quickstart.json
node .\packages\core\dist\cli.js doctor --config .\packages\core\examples\config.quickstart.json
~~~

根目录的 npm run build 会先构建 core，再构建 DSH。源码在 packages/core/src/ 与 packages/dsh/src/；core 输出到 packages/core/dist/，CLI 入口为 packages/core/dist/cli.js。DSH 的 Cordis、React 和浏览器 bundle 只属于独立插件包。通常修改 src 源码，不手工修改 dist 生成文件。

## 可选：本地全局安装 CLI

如果不想每次写 Node 入口路径，可以在仓库根目录把 core workspace 打成 npm tarball 并安装到当前用户的全局 npm 目录：

~~~powershell
npm pack --workspace agentdock
npm install --global .\agentdock-0.1.3-dev.tgz
agentdock --help
~~~

以 npm pack 实际输出的文件名为准。更新源码后重新构建、打包并安装新 tarball。也可用 node .\packages\core\dist\cli.js ... 直接执行，无需全局安装。DSH 插件的单独打包和安装见[DeepSeek Harness 插件指南](./dsh)。

## 启动本地 API 与 Control Center

运行 API 前先验证所用配置：

~~~powershell
node .\packages\core\dist\cli.js config validate .\packages\core\examples\config.quickstart.json
node .\packages\core\dist\cli.js api serve --config .\packages\core\examples\config.quickstart.json --port 4177
~~~

浏览器打开 http://127.0.0.1:4177/ 进入 Control Center。服务只监听本机回环地址。启动输出会在没有显式提供 Token 时给出 api-token 文件路径；将文件内容输入 UI 认证框。使用 Ctrl+C 停止 API。

API 也可从环境变量获取稳定 Token：

~~~powershell
$env:AGENTDOCK_API_TOKEN = 'replace-with-a-long-local-token'
node .\packages\core\dist\cli.js api serve --config .\packages\core\examples\config.quickstart.json --port 4177
~~~

## 构建 Wiki 网站

Wiki 源文件和 VitePress 配置位于 docs/wiki/：

~~~text
npm run wiki:dev       # 本地开发服务器，支持热更新
npm run wiki:build     # 静态输出到 docs/wiki/.vitepress/dist/
npm run wiki:preview   # 本地预览生成的网站
~~~

Wiki 不依赖 AgentDock API 或 SQLite，可独立发布到静态文件服务器。

## 数据与路径

CLI 默认读取当前工作目录下的 .agentdock/config.json；通过 --config 可选择其他配置。配置中的相对路径以该配置文件所在目录为基准。dataDir 决定 SQLite 数据、Token 和 Environment 控制数据的位置；默认数据库为 .agentdock/data/agentdock.db。使用示例 quickstart 配置时，数据会写在独立的 .agentdock/quickstart-data/ 下。

如果要把构建结果复制到另一台机器，需要一并配置目标机上的 Agent CLI 和 Environment，并在目标机执行 config validate、doctor 和 Engine health 检查。
