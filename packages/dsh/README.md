# AgentDock DSH integration

`@agentdock/dsh` connects AgentDock to the Web profile of DeepSeek Harness (DSH). It adds an AgentDock provider/model list and a Settings → AgentDock page. DSH remains responsible for the chat UI and transcript; AgentDock routes turns to local Agents and their configured Runtime.

The plugin is optional. It does not install AgentDock Core, Codex CLI, Claude Code, or model credentials into DSH. The local plugin tarball includes the AgentDock control-plane code needed by the DSH adapter, so Core does not need to be published to npm first.

## Local install from the AgentDock repository

Requirements: Node.js `>=22.5`, npm, and the AgentDock repository. From the repository root:

```powershell
npm ci
npm run build
npm pack --workspace @agentdock/dsh
npx @deepseek-ai/dsh plugin --profile web add -w .\agentdock-dsh-0.1.3-dev.tgz
```

Use the tarball filename actually printed by `npm pack`. `--profile web` installs into the DSH web profile, not every profile. Verify the composed profile config before starting it:

```powershell
npx @deepseek-ai/dsh --profile web --dump-config
```

The output should include `agentdock-dsh`. The first dump may also initialize missing profile files. If rebuilding the same package version, remove the existing plugin before adding the new tarball so the DSH profile does not keep a stale client bundle. See the [official DSH CLI reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md) for profile layers and plugin commands.

## Configure and run

AgentDock API and DSH are separate local processes. The plugin connects to the API at `http://127.0.0.1:4177` by default and reads its bearer token from `AGENTDOCK_API_TOKEN`. A DSH profile `cordis.patch.yml` entry can override the AgentDock config path and connection fields:

```yaml
- id: agentdock-dsh
  name: '@agentdock/dsh'
  config:
    configPath: 'packages/core/examples/config.quickstart.json'
    apiBaseUrl: 'http://127.0.0.1:4177'
    apiTokenEnv: 'AGENTDOCK_API_TOKEN'
    bindingStorePath: '.agentdock/dsh-session-bindings.json'
```

Start the API with the same config file and a local token. In a second terminal, set the same token and run `npx @deepseek-ai/dsh web` from the AgentDock repository root. The relative `configPath` is resolved from DSH's working directory. Do not put the token value in YAML or commit it.

The built-in Echo Agent is sufficient for a first connectivity check. Real Codex or Claude Code execution requires that Runtime to be installed, configured, and authenticated independently.

See the [complete installation and quick-start guide](https://github.com/parkerluxu/AgentDock/blob/main/docs/dsh-plugin.zh-CN.md) for PowerShell commands, field meanings, annotated UI illustrations, upgrade/uninstall steps, and troubleshooting.
