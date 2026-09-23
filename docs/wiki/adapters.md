# Adapter 开发与安装

Adapter 是 Runtime 与 AgentDock 控制面之间的稳定边界。Adapter 不需要依赖 RunService、SQLite 或 HTTP handler，只依赖 `agentdock` 导出的公共契约。

## 最小契约

内置 Echo Adapter 已随 core 直接注册，适合无模型快速体验，不需要执行 adapter install。packages/core/examples/adapter-echo 是另一个独立的本地示例包，用于学习第三方 Adapter 的 manifest 与入口结构。

Adapter 必须提供：

- `manifest`：声明 `agentDockApi: "v1"`、Runtime 版本范围、能力和权限。
- `healthCheck()`：返回 Runtime 是否可用。
- `execute(request)`：产生 `RunEvent` 异步迭代器。
- `cancel(runId)`：响应取消请求；不支持时不要声明 `cancel` 能力。

事件必须使用同一个 `runId`，sequence 从 0 开始严格递增，并以 `succeeded`、`failed`、`cancelled` 或 `timed_out` 终态结束。不要在事件 payload、stdout 或错误消息中写入 token、secret 或未脱敏凭证。

## Manifest 示例

```json
{
  "name": "my-adapter",
  "version": "0.1.0",
  "entry": "./dist/adapter.js",
  "agentDockApi": "v1",
  "runtime": { "id": "my-runtime", "versionRange": ">=1.0.0" },
  "capabilities": ["execute", "stream_events", "healthcheck"],
  "requiredPermissions": ["filesystem.read"]
}
```

入口模块应导出 `createAdapter(runtime)`；为兼容类实现，也支持默认导出、`Adapter` 或按 manifest 名称生成的类。入口路径必须是包目录内的相对路径。

## 本地生命周期

```text
adapter install → 默认 disabled → adapter enable --grant ... → Registry 加载
                                 └→ adapter disable → adapter uninstall
```

```text
node packages/core/dist/cli.js adapter install ./my-adapter --config .agentdock/config.json
node packages/core/dist/cli.js adapter list --config .agentdock/config.json
node packages/core/dist/cli.js adapter enable my-adapter --grant filesystem.read --config .agentdock/config.json
node packages/core/dist/cli.js adapter disable my-adapter --config .agentdock/config.json
node packages/core/dist/cli.js adapter uninstall my-adapter --config .agentdock/config.json
```

包文件复制到数据目录附近的 `adapters/<name>`，注册信息位于 `adapters/registry.json`。安装后默认禁用且没有已授予权限；启用时必须逐项授予 manifest 声明的权限，禁用后才能卸载。内置 Adapter 不能被本地包覆盖。

## 开发与契约测试

从 [`packages/core/examples/adapter-echo`](https://github.com/parkerluxu/AgentDock/tree/main/packages/core/examples/adapter-echo) 开始，使用 SDK 工具创建 manifest 和事件：

```ts
import { assertAdapterContract } from "agentdock";

await assertAdapterContract(adapter, {
  runtime,
  task: "contract smoke task",
});
```

建议先做契约测试，再用临时数据目录执行 `adapter install`、显式 `enable` 和 CLI/API 集成回归。Runtime 版本变化时同步更新[能力矩阵](https://github.com/parkerluxu/AgentDock/blob/main/docs/runtime-capability-matrix.md)。
