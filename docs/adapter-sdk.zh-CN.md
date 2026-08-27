# Adapter SDK（v0.1）

AgentDock 的 Adapter SDK 是 Runtime 与控制面之间的稳定边界。第三方 Adapter 只需要实现 `AgentAdapter`，不需要依赖 RunService、SQLite 或 HTTP API 的内部实现。

## 最小 Adapter

公共类型和工具从 `src/adapter-sdk/index.ts` 导出：

```ts
import {
  createMessageEvent,
  createStatusEvent,
  defineAdapterManifest,
  type AgentAdapter,
  type AdapterHealth,
  type AdapterTaskRequest,
} from "agentdock";

const manifest = defineAdapterManifest({
  name: "example",
  version: "0.1.0",
  entry: "./dist/example-adapter.js",
  agentDockApi: "v1",
  runtime: { id: "example", versionRange: ">=1.0.0" },
  capabilities: ["execute", "stream_events", "cancel", "healthcheck"],
  requiredPermissions: ["filesystem.read"],
});

export class ExampleAdapter implements AgentAdapter {
  public readonly manifest = manifest;

  public async healthCheck(): Promise<AdapterHealth> {
    return { healthy: true };
  }

  public async *execute(request: AdapterTaskRequest) {
    yield createStatusEvent(request.runId, 0, "running");
    yield createMessageEvent(request.runId, 1, request.task);
    yield createStatusEvent(request.runId, 2, "succeeded", { exitCode: 0 });
  }

  public async cancel(_runId: string): Promise<void> {}
}
```

每个事件必须使用同一个 `runId`，序号从 0 开始严格递增，并以终态 `status` 或 `error` 事件结束。不要把 secret、token 或未脱敏的凭证写入事件 payload。

## Manifest

manifest 当前包含以下字段：

| 字段 | 含义 |
| --- | --- |
| `name` | Adapter 标识名称。 |
| `version` | Adapter 自身的语义化版本。 |
| `entry` | 本地加载器使用的入口模块路径或内置入口标识。 |
| `agentDockApi` | 兼容的 AgentDock Adapter API 版本，目前为 `v1`。 |
| `runtime.id` | Adapter 适配的 Runtime 标识。 |
| `runtime.versionRange` | 兼容的 Runtime 版本范围，例如 `>=1.2.0 <2.0.0`。 |
| `capabilities` | Adapter 实际支持的能力。未声明的能力不能被调用方假定支持。 |
| `requiredPermissions` | Adapter 需要的文件、网络、shell 或 secret 权限。 |

`validateAdapterManifest` 会校验字段、版本范围、能力、权限和重复声明。当前 Registry 在创建 Adapter 时执行这项校验。

## 本地 Adapter 生命周期

本地安装包是一个包含 `agentdock-adapter.json`（也兼容 `manifest.json`）和入口文件的目录。`entry` 必须是包目录内的相对文件路径。入口模块应导出 `createAdapter(runtime)`；为兼容类实现，也支持默认导出、`Adapter` 或按 manifest 名称生成的 `<Name>Adapter` 类。

CLI 的生命周期命令如下：

```text
node dist/cli.js adapter install ./my-adapter --config .agentdock/config.json
node dist/cli.js adapter list --config .agentdock/config.json
node dist/cli.js adapter enable my-adapter --grant filesystem.read --config .agentdock/config.json
node dist/cli.js adapter disable my-adapter --config .agentdock/config.json
node dist/cli.js adapter uninstall my-adapter --config .agentdock/config.json
```

安装结果持久化在数据目录旁的 `adapters/registry.json`，包文件复制到 `adapters/<name>`。新安装的 Adapter 默认禁用且没有已授予权限；启用时必须为 manifest 声明的权限逐项显式授权。禁用后才能卸载，内置 Adapter 不能被本地包覆盖。权限声明和授权是 AgentDock 的生命周期边界，不等价于操作系统或容器级沙箱。

## 开发流程

1. 复制仓库内的 [`examples/adapter-echo`](../examples/adapter-echo/README.md)，保留 manifest 的 API 版本、能力和权限字段。
2. 用 `defineAdapterManifest` 构造 manifest，并只声明实际实现的能力。
3. 用 `createStatusEvent`、`createMessageEvent` 和 `createErrorEvent` 生成有序事件；正常结束必须产生终态事件。
4. 用 `assertAdapterContract` 覆盖健康检查、运行、取消和错误路径。
5. 通过 `agentdock adapter install` 安装到临时数据目录，显式启用并运行 API/CLI 集成回归。
6. Runtime 版本变化时，按[兼容矩阵更新流程](./adapter-compatibility-process.zh-CN.md)更新 manifest 范围和能力矩阵。

## 契约测试

可以用 `assertAdapterContract` 对 Adapter 执行统一检查：manifest 有效、能力声明与方法一致、健康检查成功、事件合法、执行以终态结束，并且 `cancel` 可调用。

```ts
const report = await assertAdapterContract(adapter, {
  runtime,
  task: "contract smoke task",
});
```

仓库内的 `EchoAdapter` 是不访问网络、不启动外部进程的确定性实现，适合 SDK 开发、API 集成测试和本地演示。它已注册为内置 `echo` Adapter。

## 当前边界

- SDK 目前提供 TypeScript 公共契约、manifest 校验、事件/错误工具和契约测试辅助函数。
- Registry 已支持内置 Adapter 和已启用本地包的加载；远程下载、自动安装、权限升级和 OS 级隔离尚未实现。
- `requiredPermissions` 是声明和诊断输入，不等价于操作系统或容器级隔离。
- `agentDockApi`、事件结构和 manifest 字段属于兼容边界，破坏性变更需要升级 API 版本或提供迁移说明。

SDK 使用者升级 API/manifest 时，请先阅读[API/SDK 迁移指南](./migration-guide.zh-CN.md)，并按[兼容矩阵更新流程](./adapter-compatibility-process.zh-CN.md)记录 Runtime 版本、平台、契约测试和人工冒烟结果。仓库内的 [`examples/adapter-echo`](../examples/adapter-echo/README.md) 是不启动真实 Agent 的完整本地包示例。
