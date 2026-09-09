# 故障排查

## Node.js 版本或 `node:sqlite` 错误

```text
node --version
```

必须为 `22.5` 或更高。升级后重新执行 `npm ci` 和 `npm run build`。

## 配置校验失败

```text
npm run config:validate -- <config-path>
```

检查：

- ID 是否是小写字母开头的标识符。
- Agent 引用的 Engine、Environment、Permission 是否存在。
- Project 的 `defaultAgentId` 是否属于 `agentIds`。
- external Environment 是否设置 `homeDir` 或 `configDir`。
- Environment `extends` 是否引用存在的父项且没有环。

## Adapter 未注册或 Runtime 不健康

```text
node dist/cli.js engine list --config <config-path>
node dist/cli.js engine health <engine-id> --config <config-path>
node dist/cli.js doctor --config <config-path>
```

确认 `engines[].adapter` 拼写正确，第三方 Adapter 已安装且启用，并确认 `engines[].binary` 在 PATH 中可执行。

## Codex 拒绝非 Git 目录

在对应 Environment 的 `settings` 中设置：

```json
{ "skipGitRepoCheck": true }
```

或者把 Project `rootDir` 指向可信 Git 工作区。

## `ENVIRONMENT_RESCAN_REQUIRED`

说明原生配置目录在上次扫描后发生了变化。确认变更可信后调用：

```text
POST /api/v1/environments/<environment-id>/rescan
```

CLI 的 `run execute` 和 `session create` 会在启动前自动扫描；API 只有在缺少 manifest 时自动创建，检测到漂移会拒绝执行。

## API 无法连接或 token 无效

确认服务仍在运行、地址是 `127.0.0.1`、端口与启动 JSON 一致，并在每个请求中携带：

```http
Authorization: Bearer <token>
```

自动 token 从启动输出给出的 `api-token` 文件读取；如果使用 `--api-token` 或 `AGENTDOCK_API_TOKEN`，客户端必须使用同一个值。

## 端口被占用

换一个端口，或让系统分配：

```text
node dist/cli.js api serve --config .agentdock/config.json --port 0
```

实际端口会出现在启动 JSON 的 `port` 字段。

## Wiki 页面或搜索没有更新

确认修改的是 `docs/wiki/` 下的源 Markdown，然后重新构建：

```text
npm run wiki:build
npm run wiki:preview
```

不要直接修改 `docs/wiki/.vitepress/dist/`；它是可再生成的构建产物。
