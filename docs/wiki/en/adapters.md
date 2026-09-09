# Adapter development and installation

An Adapter is the stable boundary between a Runtime and AgentDock. It must expose a manifest, `healthCheck()`, `execute(request)`, and `cancel(runId)` when cancellation is supported.

Events use one Run ID, strictly increasing sequence numbers, and end with a terminal status. Never put credentials or unredacted secrets in event payloads, stdout, or errors.

## Local lifecycle

```text
adapter install → disabled by default → adapter enable --grant ... → Registry loads it
                                  └→ adapter disable → adapter uninstall
```

```text
node dist/cli.js adapter install ./my-adapter --config .agentdock/config.json
node dist/cli.js adapter enable my-adapter --grant filesystem.read --config .agentdock/config.json
```

The package contains `agentdock-adapter.json` and a relative `entry`. Installation copies it near the data directory into `adapters/<name>`; registry data is stored in `adapters/registry.json`.

Start with the [Echo Adapter example](https://github.com/parkerluxu/AgentDock/tree/main/examples/adapter-echo) and use `assertAdapterContract` before CLI/API integration tests. Manifest permissions are declarations and explicit grants, not OS-level isolation.
