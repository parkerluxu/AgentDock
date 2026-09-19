# Example Adapter

这是一个用于本地 SDK 和集成测试的确定性第三方 Adapter 示例。

This directory is a deterministic third-party Adapter example for local SDK and integration testing. It does not start an external process or access the network.

本示例不会启动外部进程，也不会访问网络；它用于演示 Adapter 契约和生命周期，而不是提供安全沙箱。

[![adapter](https://img.shields.io/badge/adapter-2563EB?style=flat-square)](../../docs/wiki/adapters.md)
[![offline](https://img.shields.io/badge/offline-0F766E?style=flat-square)](README.md)
[![integration-testing](https://img.shields.io/badge/integration--testing-7C3AED?style=flat-square)](../../docs/wiki/workflows.md)

The runtime and Adapter name are both `example-echo`. Install it into a temporary or project-local AgentDock data directory, then enable it explicitly:

```text
node dist/cli.js adapter install examples/adapter-echo --config .agentdock/config.json
node dist/cli.js adapter enable example-echo --config .agentdock/config.json
```

The package declares no permissions. It is a contract and lifecycle example, not a security sandbox.

该包不声明任何权限，是契约和生命周期示例，不是操作系统或容器级安全沙箱。
