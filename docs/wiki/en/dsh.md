# DeepSeek Harness integration

AgentDock can serve as a DeepSeek Harness (DSH) Agent backend. DSH provides the chat UI; AgentDock routes messages to a configured local Agent. Enabled Agents appear in the DSH model picker, and each DSH conversation gets its own AgentDock Session.

## Install the plugin

You need Node.js >=22.5, npm, the AgentDock source repository, and a working DSH Web profile. Real model execution also requires a separately installed and authenticated Agent CLI such as Codex or Claude Code; built-in Echo is enough to check connectivity.

From the AgentDock repository root, pack and install the plugin into the DSH web profile:

~~~powershell
npm ci
npm run build
npm pack --workspace @agentdock/dsh
npx @deepseek-ai/dsh plugin --profile web add -w .\agentdock-dsh-0.1.3-dev.tgz
npx @deepseek-ai/dsh --profile web --dump-config
~~~

Use the tarball name printed by npm pack; it changes when the package version changes. dump-config should include agentdock-dsh. The plugin tarball is self-contained and does not fetch an unpublished AgentDock core package from npm.

Start the API and DSH as separate processes. In Terminal A, start the AgentDock API with a local random token:

~~~powershell
$env:AGENTDOCK_API_TOKEN = [guid]::NewGuid().ToString('N')
$env:AGENTDOCK_API_TOKEN
node .\packages\core\dist\cli.js api serve --config .\.agentdock\config.json --port 4177
~~~

Copy the displayed token. In Terminal B, set the same value and start DSH:

~~~powershell
$env:AGENTDOCK_API_TOKEN = 'paste the token from Terminal A'
npx @deepseek-ai/dsh web
~~~

Select an AgentDock Agent in the DSH model picker and send a message. The API listens only on 127.0.0.1. The token stays in the two process environments and is not saved to the profile or business config. For a non-default config file, both the API and the plugin configPath must point to that file. Set configPath in the DSH profile's cordis.patch.yml; if overriding a plugin ID, restate configPath, apiBaseUrl, apiTokenEnv, and bindingStorePath. See the [full DSH plugin guide](https://github.com/parkerluxu/AgentDock/blob/main/docs/dsh-plugin.zh-CN.md) for profile patches, upgrades, and uninstall.

Settings → AgentDock can edit Agents, Engines, Environments, Projects, Permissions, and the current DSH conversation binding. It edits the business config selected by configPath; the API URL, token environment variable, and binding-store path are profile startup settings.

DSH stores conversation bindings under .agentdock/dsh-session-bindings.json below its working directory. AgentDock's database and Environment files use dataDir from the business config.
