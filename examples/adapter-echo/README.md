# Example Adapter

This directory is a deterministic third-party Adapter example for local SDK and integration testing. It does not start an external process or access the network.

The runtime and Adapter name are both `example-echo`. Install it into a temporary or project-local AgentDock data directory, then enable it explicitly:

```text
node dist/cli.js adapter install examples/adapter-echo --config .agentdock/config.json
node dist/cli.js adapter enable example-echo --config .agentdock/config.json
```

The package declares no permissions. It is a contract and lifecycle example, not a security sandbox.
