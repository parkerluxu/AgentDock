# Configuration

Configuration is strict version `1` JSON. The default path is `.agentdock/config.json`; every CLI command accepts `--config <path>`.

## Top-level fields

| Field | Purpose |
| --- | --- |
| `version` | Must be `1`. |
| `dataDir` | Parent of SQLite, token, Adapter registry, and control metadata. |
| `engines` | Executable Runtime, Adapter, capabilities, and enabled state. |
| `environments` | Native Agent home/config/state/cache directories. |
| `environmentPermissions` | Filesystem, network, environment-variable, and Secret policy. |
| `agents` | Engine + Environment + Permission bindings. |
| `projects` | Working directory and allowed Agents. |
| `storage` | `retentionDays` and `saveOutput`. |
| `logging` / `redaction` | Log level and additional redaction keys. |

See [`examples/config.example.json`](https://github.com/parkerluxu/AgentDock/blob/main/examples/config.example.json) for a complete Claude Code and Codex example.

## Paths and validation

Relative paths resolve from the configuration file directory. Managed Environments stay under `.agentdock/environments/<id>/`; external Environments require `homeDir` or `configDir`. The default database is `.agentdock/data/agentdock.db`.

```text
npm run config:validate -- .agentdock/config.json
node dist/cli.js doctor --config .agentdock/config.json
```

Validation checks schema, unique IDs, references, Project defaults, and Environment inheritance cycles. The Control Center additionally previews diffs and high-risk changes before an atomic save.
