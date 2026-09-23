# Adapter development and installation

An Adapter is the stable boundary between a Runtime and AgentDock. It must expose a manifest, `healthCheck()`, `execute(request)`, and `cancel(runId)` when cancellation is supported.

Events use one Run ID, strictly increasing sequence numbers, and end with a terminal status. Never put credentials or unredacted secrets in event payloads, stdout, or errors.

The built-in Echo Adapter is registered by core and needs no adapter install; use it for a no-model quick start. packages/core/examples/adapter-echo is a separate local example package that demonstrates a third-party Adapter manifest and entrypoint.

## Local lifecycle

```text
adapter install → disabled by default → adapter enable --grant ... → Registry loads it
                                  └→ adapter disable → adapter uninstall
```

```text
node packages/core/dist/cli.js adapter install ./my-adapter --config .agentdock/config.json
node packages/core/dist/cli.js adapter enable my-adapter --grant filesystem.read --config .agentdock/config.json
```

The package contains `agentdock-adapter.json` and a relative `entry`. Installation copies it near the data directory into `adapters/<name>`; registry data is stored in `adapters/registry.json`.

Start with the [Echo Adapter example](https://github.com/parkerluxu/AgentDock/tree/main/packages/core/examples/adapter-echo) and use `assertAdapterContract` before CLI/API integration tests. Manifest permissions are declarations and explicit grants, not OS-level isolation.
