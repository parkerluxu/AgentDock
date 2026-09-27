# DeepSeek Harness (DSH) integration

AgentDock provides an optional **DeepSeek Harness (DSH) Web plugin**. DSH is the chat host. The plugin exposes enabled AgentDock Agents in its model picker and routes each turn to a local Agent. It is not a generic ASH plugin and does not install Codex or Claude Code for you.

![AgentDock DSH plugin install and runtime flow](/images/dsh/setup-flow.svg)

This is an annotated operational illustration based on the current plugin implementation, not a live screenshot. For the complete PowerShell walkthrough, profile patch, field explanations, and troubleshooting table, see the [full DSH plugin guide](https://github.com/parkerluxu/AgentDock/blob/main/docs/dsh-plugin.zh-CN.md).

## Know the components

| Component | Responsibility |
| --- | --- |
| AgentDock Core | Local API, Agent routing, and Runtime execution; its configured `dataDir` controls database and Environment data. |
| DSH Web | Chat UI, model selection, and transcript. |
| `@agentdock/dsh` | DSH adapter, AgentDock model catalog, Settings → AgentDock page, and session-binding bridge. |
| Agent Runtime | Echo / Codex CLI / Claude Code CLI, which actually executes a task. The plugin does not install or sign in to these. |

Echo ships with AgentDock and is enough to verify the plugin, token, and API connection. Echo only repeats its input; it does not generate a model answer.

## Build and install the plugin

You need Node.js `>=22.5`, npm, and the AgentDock repository. From the repository root:

```powershell
npm ci
npm run build
npm pack --workspace @agentdock/dsh
npx @deepseek-ai/dsh plugin --profile web add -w .\agentdock-dsh-0.1.3-dev.tgz
npx @deepseek-ai/dsh --profile web --dump-config
```

Use the tarball filename printed by `npm pack`. `--profile web` targets only DSH's `web` profile. `--dump-config` prints the composed config without starting the chat UI; confirm it contains the `agentdock-dsh` plugin. The local tarball is self-contained for its AgentDock control-plane code and does not require publishing AgentDock Core to npm.

By default, DSH home is `%USERPROFILE%\.dsh`; `DSH_HOME` overrides it. The web profile's dependency manifest, lockfile, `dsh.profile` bundle list, and `cordis.patch.yml` are normally under `profiles\web\`. This DSH profile directory is separate from AgentDock's config and `dataDir`. The home-level `$DSH_HOME/cordis.patch.yml` layer has higher precedence than the per-profile patch; check it if profile settings appear to be ignored.

## Configure and start the local connection

AgentDock API and DSH are two separate processes. Start the API from the repository root in Terminal A, using the built-in Echo config:

```powershell
$env:AGENTDOCK_API_TOKEN = [guid]::NewGuid().ToString('N')
Write-Host "Copy this temporary local token to Terminal B: $env:AGENTDOCK_API_TOKEN"
node .\packages\core\dist\cli.js api serve --config .\packages\core\examples\config.quickstart.json --port 4177
```

Keep Terminal A open. Add this complete entry to the web profile's `cordis.patch.yml` (preserve other plugin entries):

```yaml
- id: agentdock-dsh
  name: '@agentdock/dsh'
  config:
    configPath: 'packages/core/examples/config.quickstart.json'
    apiBaseUrl: 'http://127.0.0.1:4177'
    apiTokenEnv: 'AGENTDOCK_API_TOKEN'
    bindingStorePath: '.agentdock/dsh-session-bindings.json'
```

Field meanings: `configPath` is resolved from DSH's current working directory; `apiBaseUrl` is the local API base, to which the plugin appends `/api/v1`; `apiTokenEnv` is the environment variable **name**, not a token; and `bindingStorePath` holds session-binding metadata, not transcripts. When a patch has the same plugin ID, its `config` object replaces the default config, so keep all connection fields. Start DSH from the repository root for this relative config path.

In Terminal B, set the exact same token and start the web profile:

```powershell
$env:AGENTDOCK_API_TOKEN = 'replace with the token printed in Terminal A'
npx @deepseek-ai/dsh web
```

Open the local URL printed by DSH. Select `echo-agent` in the model picker and send a short message. An exact echo confirms that DSH, the plugin, the API, and AgentDock routing can communicate. Do not save the token in YAML, business config, Git, or public screenshots. The API listens only on `127.0.0.1`.

![DSH conversation routing to an AgentDock Agent](/images/dsh/session-route.svg)

Each DSH conversation maps to its own AgentDock Session. DSH stores the chat UI/transcript; AgentDock invokes the local Agent. Selecting another Agent changes the route and does not merge native contexts from different Agents.

## Settings → AgentDock

This page edits the AgentDock config selected by `configPath`. The API URL, token environment-variable name, and binding-store path are DSH profile settings—not fields in the AgentDock business config.

![Annotated structure of the AgentDock DSH Settings page](/images/dsh/settings-annotated.svg)

1. **Config path** shows the file actually being edited. If it is wrong, check `configPath` and DSH's startup directory.
2. **Current DSH session** lets you select an Agent and optional Project, then bind or update this conversation. Normally, choosing an Agent in the model picker and sending a turn creates the binding automatically; this section is for inspection or manual adjustment.
3. **Catalog counts/tabs** represent Agents, Engines, Environments, Projects, and Permissions. An Agent must reference valid Engine, Environment, and Permission IDs. Only enabled Agents appear in the model picker.
4. **JSON editor** edits the complete array for the selected catalog. Replace template IDs and references before saving new entries.
5. **Preview / Save / Backups**: Preview validation issues, diffs, and high-risk warnings first, then save. Saving creates a backup. If a restart is required, runtime changes do not take effect until the API restarts. Recent backups can be restored below.

For a first run, keep the existing Echo config and avoid changing permissions. For a real Agent, install and authenticate its local Runtime first, then validate its Engine, Environment, Permission, and Project references.

## Files and security boundaries

- DSH keeps the chat transcript. `.agentdock/dsh-session-bindings.json` stores only the mapping between DSH conversations and AgentDock Sessions.
- AgentDock SQLite, Runs, and Environments use `dataDir` from the selected AgentDock config; they are separate from the DSH profile.
- The token is read from `AGENTDOCK_API_TOKEN`; do not put it into a profile patch or JSON config.
- Loopback means the API is local-only; AgentDock Permissions are application-level policy, not an OS/container sandbox.

## Upgrade, remove, and troubleshoot

When rebuilding with the same package version, remove and re-add the plugin to avoid a stale expanded client bundle:

```powershell
npx @deepseek-ai/dsh plugin --profile web remove -w @agentdock/dsh
npm pack --workspace @agentdock/dsh
npx @deepseek-ai/dsh plugin --profile web add -w .\agentdock-dsh-0.1.3-dev.tgz
```

Replace the tarball name with npm's actual output. To uninstall only from the web profile:

```powershell
npx @deepseek-ai/dsh plugin --profile web remove -w @agentdock/dsh
```

Uninstalling the plugin does not delete AgentDock configs, SQLite history, Environments, DSH transcripts, or binding files. For `TOKEN_MISSING`, set the variable in the DSH terminal and restart it. For connection errors, confirm the API is running, both terminals have the same token, and API/plugin point to the same config. For full details, see the [full DSH plugin guide](https://github.com/parkerluxu/AgentDock/blob/main/docs/dsh-plugin.zh-CN.md).
