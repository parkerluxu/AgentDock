# CLI reference

Run the built CLI with:

```text
node packages/core/dist/cli.js
```

All commands accept `--config <path>` and default to `.agentdock/config.json`.

| Command | Purpose |
| --- | --- |
| `config validate [path]` | Validate JSON, schema, IDs, and references. |
| `engine list` | List Engine, Adapter, binary, enabled, and registry status. |
| `engine health <engine-id>` | Probe Runtime version and health. |
| `doctor` | Diagnose configuration, Adapter, Runtime, and Environment. |
| `environment doctor <id>` | Report one Environment's directory writability, symlinks, manifest/drift, Adapter native-home contract, Permission, and Secret References without values. |
| `environment list` | Print Environment definitions. |
| `environment rescan <id>` | Explicitly confirm an existing Environment configuration and update its manifest/hash. |
| `environment template create/list/apply` | Create, list, or apply immutable config-only templates; `apply` creates a managed Environment and requires `--confirm-high-risk`. |
| `agent list` | List callable Agents and their bindings. |
| `agent run <agent-id> [--format jsonl\|human] [--dry-run] <task>` | Recommended invocation. It defaults to `accepted → event* → result/error` JSONL and resolves the Environment from the Agent binding. |
| `project list/show <id>` | Inspect Projects. |
| `run dry-run <task>` | Resolve context without starting an Agent. |
| `run execute <task>` | Advanced explicit routing for batch, queue, and recovery tooling; it may select an Environment directly. |
| `run list/show/events/export <id>` | Query or export a Run. |
| `session create/list/show/archive` | Manage reusable Sessions. |
| `api serve` | Start the local API and Control Center. |
| `adapter install/list/enable/disable/uninstall` | Manage local Adapters. |

Typical commands:

```text
node packages/core/dist/cli.js agent run codex-reviewer --dry-run --config packages/core/examples/config.example.json --project agentdock "inspect the repository"
node packages/core/dist/cli.js agent run codex-reviewer --config packages/core/examples/config.example.json --project agentdock "summarize the repository"
node packages/core/dist/cli.js agent run codex-reviewer --format human --config packages/core/examples/config.example.json --project agentdock "summarize the repository"
node packages/core/dist/cli.js run list --config packages/core/examples/config.example.json --status succeeded --limit 20
node packages/core/dist/cli.js run export --format jsonl --config packages/core/examples/config.example.json <run-id>
```

The first `accepted` line contains the `runId`, Agent, Project, Session, and a recovery command. Each later `event` line wraps one standard Run event; the final line is `result`. Invocation failures produce an `error` JSONL line while diagnostics remain on stderr. `--format human` prints only messages, tool starts/completions, and the final Run status. High-level Agent invocation does not accept `--environment`; use `run execute` for explicit Environment routing.

`run dry-run` and `agent run --dry-run` include `routing`: selection mode, final Agent/Environment/Engine, every candidate Agent, Runtime health, and a reason for each rejection. An unroutable request still returns `executes: false` with the same candidate explanation, so scripts and Control Center can show an actionable cause.

## Run from any PowerShell directory

The current PowerShell directory does not need to be the AgentDock source tree. After building, use absolute paths for the CLI entrypoint and configuration file:

```powershell
$repo = "D:\AI_agent\cases\AgentDock"
$config = "$repo\packages\core\examples\config.example.json"
node "$repo\packages\core\dist\cli.js" agent run new-agent --config $config --project other-project hello
```

`other-project` must already exist in the configuration. Its `rootDir` points to the target working directory and its `agentIds` must include `new-agent`. Changing directories with `cd` does not override the Project `rootDir`; the CLI currently has no per-call `--cwd` option. Relative paths in the configuration still resolve from the configuration file directory.

For a global agentdock command, pack and install the core workspace from the repository root, then continue to pass an absolute --config path when working elsewhere:

```powershell
npm pack --workspace agentdock
npm install --global .\agentdock-0.1.3-dev.tgz
agentdock agent run new-agent --config "D:\AI_agent\cases\AgentDock\packages\core\examples\config.example.json" --project other-project hello
```

See [Use the CLI and SDK from any PowerShell directory](./sdk) for SDK, ESM, and Node.js module details.

Exit codes are `0` for success, `2` for input/configuration errors, `3` for failed or timed-out Runs, and `130` for Ctrl+C cancellation.
