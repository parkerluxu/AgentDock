# CLI reference

Run the built CLI with:

```text
node dist/cli.js
```

All commands accept `--config <path>` and default to `.agentdock/config.json`.

| Command | Purpose |
| --- | --- |
| `config validate [path]` | Validate JSON, schema, IDs, and references. |
| `engine list` | List Engine, Adapter, binary, enabled, and registry status. |
| `engine health <engine-id>` | Probe Runtime version and health. |
| `doctor` | Diagnose configuration, Adapter, Runtime, and Environment. |
| `environment list` | Print Environment definitions. |
| `agent list` | List callable Agents and their bindings. |
| `agent run <agent-id> <task>` | Execute with the specified Agent and print JSONL events. |
| `project list/show <id>` | Inspect Projects. |
| `run dry-run <task>` | Resolve context without starting an Agent. |
| `run execute <task>` | Execute and print JSONL events. |
| `run list/show/events/export <id>` | Query or export a Run. |
| `session create/list/show/archive` | Manage reusable Sessions. |
| `api serve` | Start the local API and Control Center. |
| `adapter install/list/enable/disable/uninstall` | Manage local Adapters. |

Typical commands:

```text
node dist/cli.js run dry-run --config examples/config.example.json --project agentdock "inspect the repository"
node dist/cli.js agent run codex-reviewer --config examples/config.example.json --project agentdock "summarize the repository"
node dist/cli.js run list --config examples/config.example.json --status succeeded --limit 20
node dist/cli.js run export --format jsonl --config examples/config.example.json <run-id>
```

## Run from any PowerShell directory

The current PowerShell directory does not need to be the AgentDock source tree. After building, use absolute paths for the CLI entrypoint and configuration file:

```powershell
$repo = "D:\AI_agent\cases\AgentDock"
$config = "$repo\examples\config.example.json"
node "$repo\dist\cli.js" agent run new-agent --config $config --project other-project hello
```

`other-project` must already exist in the configuration. Its `rootDir` points to the target working directory and its `agentIds` must include `new-agent`. Changing directories with `cd` does not override the Project `rootDir`; the CLI currently has no per-call `--cwd` option. Relative paths in the configuration still resolve from the configuration file directory.

For a global `agentdock` command, run `npm link` once from the source tree, then continue to pass an absolute `--config` path when working elsewhere:

```powershell
Push-Location "D:\AI_agent\cases\AgentDock"
npm link
Pop-Location
agentdock agent run new-agent --config "D:\AI_agent\cases\AgentDock\examples\config.example.json" --project other-project hello
```

See [Use the CLI and SDK from any PowerShell directory](./sdk) for SDK, ESM, and Node.js module details.

Exit codes are `0` for success, `2` for input/configuration errors, `3` for failed or timed-out Runs, and `130` for Ctrl+C cancellation.
