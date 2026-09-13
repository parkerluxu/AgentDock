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

## Use AgentDock from any PowerShell directory

The PowerShell current directory is only where the command starts; it does not automatically become the Agent working directory. The CLI working directory comes from the Project `rootDir`. The Agent's `homeDir` / `configDir` belongs to its Environment and stores native configuration, state, and cache; it is a different path.

For example, add a Project that points `new-agent` at another workspace:

```json
{
  "id": "other-project",
  "rootDir": "D:/work/other-project",
  "agentIds": ["new-agent"],
  "defaultAgentId": "new-agent"
}
```

When running outside the source tree, use absolute paths for both the CLI entrypoint and the configuration file:

```powershell
$repo = "D:\AI_agent\cases\AgentDock"
$config = "$repo\examples\config.example.json"
node "$repo\dist\cli.js" agent run new-agent --config $config --project other-project hello
```

The CLI currently has no per-call `--cwd` option, and the SDK has no `workingDirectory` option. Change the working directory by routing through a Project with the desired `rootDir`. See [Use the CLI and SDK from any PowerShell directory](./sdk) for more examples.

```text
npm run config:validate -- .agentdock/config.json
node dist/cli.js doctor --config .agentdock/config.json
```

Validation checks schema, unique IDs, references, Project defaults, and Environment inheritance cycles. The Control Center additionally previews diffs and high-risk changes before an atomic save.
