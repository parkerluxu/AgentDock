# DeepSeek Harness integration

AgentDock can run as a DeepSeek Harness (DSH) agent backend. DSH retains its chat UI, message history, and session picker, while AgentDock routes each conversation to a configured local Codex, Claude Code, or other agent.

## Bind a conversation

After installing the plugin, open **Settings → AgentDock** in DSH. The **Current DSH session** panel identifies the active conversation. Choose an AgentDock agent, optionally choose a Project, then select **Bind session**.

Binding switches that conversation's next model call to `agentdock/bound`:

```text
DSH session → AgentDock DSH adapter → local AgentDock API → bound agent → Codex / Claude Code / …
```

Every DSH session has its own AgentDock binding and native AgentDock session. Conversations can therefore use different agents without sharing backend context. Changing the binding creates a new backend session. After unbinding, select another model in DSH before sending the next message.

## Prerequisites

Build AgentDock, start its loopback API, and give the DSH process the same token:

```powershell
npm run build --workspace agentdock
$env:AGENTDOCK_API_TOKEN = 'replace-with-a-long-random-token'
node .\packages\core\dist\cli.js api serve --config .\.agentdock\config.json --port 4177
```

The token is read only from the environment; it is never saved in a DSH profile, AgentDock configuration, or binding store. The default API URL is `http://127.0.0.1:4177`.

## Install the plugin

```powershell
npm run build --workspace @agentdock/dsh
npm pack --workspace @agentdock/dsh
npx @deepseek-ai/dsh plugin --profile web add -w C:\path\to\agentdock-dsh-0.1.3-dev.tgz
npx @deepseek-ai/dsh web
```

`@agentdock/dsh` depends on the separately published `agentdock` core package. Publish or otherwise make a compatible core version available before installing the DSH adapter.

The plugin stores DSH → AgentDock mappings in `.agentdock/dsh-session-bindings.json` below DSH's current directory. `apiBaseUrl`, `apiTokenEnv`, `bindingStorePath`, and `defaultAgentId` are boot settings: change them in the profile's `cordis.patch.yml`, not the DSH GUI. That patch replaces the complete config for a matching id, so restate every field. Settings → AgentDock edits the AgentDock business configuration selected by `configPath`.

## Configuration UI

The same Settings page also safely manages AgentDock Agents, Engines, Environments, Projects, and Permissions, with validation, risk confirmation, and backups before writes.
