# 从源码构建与本地部署

本页区分两个独立产物：AgentDock TypeScript 运行产物，以及由多篇 Markdown 组成的 Wiki 静态网站。

## 构建 AgentDock

```text
npm ci
npm run typecheck
npm test
npm run build
npm run config:validate -- examples/config.example.json
node packages/core/dist/cli.js doctor --config packages/core/examples/config.example.json
```

根目录 `npm run build` 会按顺序构建两个 workspace：`packages/core` 中的 `agentdock` 核心包，以及 `packages/dsh` 中的 `@agentdock/dsh` 适配器包。核心包的源码根目录为 `packages/core/src/`，输出目录为 `packages/core/dist/`；其 `bin.agentdock` 指向 `packages/core/dist/cli.js`。DSH 的 Cordis、React 和浏览器 bundle 仅存在于独立的 `@agentdock/dsh` 包中。

开发时可以只运行：

```text
npm run typecheck
npm test -- --run
```

## 启动本地 API

构建完成后，在一个终端启动 loopback API：

```text
node packages/core/dist/cli.js api serve --config packages/core/examples/config.example.json --port 4177
```

浏览器打开 `http://127.0.0.1:4177/` 进入 Control Center。启动 JSON 会打印 API 地址；未显式提供 token 时，还会打印自动生成的 `api-token` 文件路径。也可以使用：

```text
node packages/core/dist/cli.js api serve --config packages/core/examples/config.example.json --port 4177 --api-token "replace-with-a-long-local-token"
```

PowerShell 环境变量方式：

```powershell
$env:AGENTDOCK_API_TOKEN = "replace-with-a-long-local-token"
node packages/core/dist/cli.js api serve --config packages/core/examples/config.example.json --port 4177
```

服务只监听 `127.0.0.1`（库调用也支持 `::1`），不会监听局域网或公网。端口设为 `0` 时由操作系统选择空闲端口，实际端口会出现在启动 JSON 中：

```text
node packages/core/dist/cli.js api serve --config packages/core/examples/config.example.json --port 0
```

按 `Ctrl+C` 停止服务；服务会停止接收请求、取消本进程管理的 Run 并关闭 SQLite。

## 构建 Wiki 网站

Wiki 源文件位于 `docs/wiki/`，通过 VitePress 生成。每个主题是独立 Markdown 页面，导航和侧边栏配置在 `docs/wiki/.vitepress/config.ts`：

```text
npm run wiki:dev       # 开发服务器，支持热更新
npm run wiki:build     # 静态输出到 docs/wiki/.vitepress/dist/
npm run wiki:preview   # 预览已构建的静态站点
```

`wiki:build` 生成的目录可复制到任意静态文件服务器。它不依赖 AgentDock API，也不需要数据库；发布 AgentDock 时建议同时运行 TypeScript 构建和 Wiki 构建。

## 运行目录与数据目录

核心包运行时至少需要 `packages/core/dist/`、`packages/core/schemas/`、配置文件和生产依赖（当前运行依赖为 `zod`）。`dataDir` 相对配置文件解析，默认数据库为 `.agentdock/data/agentdock.db`；API token、Adapter registry 和 Environment 控制元数据也存放在 `.agentdock/` 附近。`.agentdock/` 已被 `.gitignore` 忽略。

如果把构建结果复制到另一台本机环境，请一并复制配置和需要的 Agent 原生 Environment，并在目标环境重新运行 `config validate`、`doctor` 和 Runtime health 检查。
