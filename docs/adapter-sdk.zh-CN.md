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
- Registry 已支持本地注册和创建 Adapter；远程下载、自动安装和权限升级尚未实现。
- `requiredPermissions` 是声明和诊断输入，不等价于操作系统或容器级隔离。
- `agentDockApi`、事件结构和 manifest 字段属于兼容边界，破坏性变更需要升级 API 版本或提供迁移说明。
