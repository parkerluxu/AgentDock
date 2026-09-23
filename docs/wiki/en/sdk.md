# Use the CLI and SDK from any PowerShell directory

This page explains how to keep using the AgentDock CLI, Node.js SDK, and local HTTP API when the current PowerShell directory is outside the AgentDock source tree.

## Distinguish the relevant paths

| Path | Meaning | Controlled by |
| --- | --- | --- |
| PowerShell current directory | Where the command starts; it does not automatically become the Agent working directory. | The current Shell |
| CLI entrypoint | The built packages/core/dist/cli.js. | An absolute path, local npm install, or PATH |
| Configuration file path | The base for relative config paths, `dataDir`, and Environment directories. | `--config` |
| Project `rootDir` | The working directory where the Agent actually executes. | The Project configuration |
| Environment home | The Agent config/state/cache and native home directories; it is not the project working directory. | The Agent's Environment binding |

Changing the PowerShell directory with `cd D:/work/other-project` does not override a configured Project. To use another path, create or update a Project whose `rootDir` points to it.

## Configure another working directory

Add a Project that allows the target Agent:

```json
{
  "id": "other-project",
  "rootDir": "D:/work/other-project",
  "agentIds": ["new-agent"],
  "defaultAgentId": "new-agent"
}
```

On Windows, the same path may be written as `D:\\work\\other-project`. Absolute paths do not depend on the configuration file location; relative paths resolve from the directory containing the configuration file.

Preview the resolved context without starting an Agent:

```powershell
node "D:\AI_agent\cases\AgentDock\packages\core\dist\cli.js" run dry-run `
  --config "D:\AI_agent\cases\AgentDock\packages\core\examples\config.example.json" `
  --agent new-agent --project other-project hello
```

## Run the CLI from any directory

After building once, call the CLI with an absolute entrypoint and absolute configuration path from any PowerShell directory:

```powershell
$repo = "D:\AI_agent\cases\AgentDock"
$config = "$repo\packages\core\examples\config.example.json"
node "$repo\packages\core\dist\cli.js" agent run new-agent --config $config --project other-project hello
```

For a global command, pack and install the core workspace from the repository root:

```powershell
npm pack --workspace agentdock
npm install --global .\agentdock-0.1.3-dev.tgz
agentdock agent run new-agent `
  --config "D:\AI_agent\cases\AgentDock\packages\core\examples\config.example.json" `
  --project other-project hello
```

When running outside the source tree, do not rely on the default `.agentdock/config.json` unless that file exists in the current directory. Pass `--config` explicitly in most integrations. See the [CLI reference](./cli) for the complete command list.

## Use the Node.js SDK from any directory

The SDK source is TypeScript. The build produces ESM JavaScript and `.d.ts` type declarations. It runs in Node.js, uses Node 22.5+'s built-in `fetch`, and does not need an additional HTTP client library.

ESM is JavaScript's module format based on `import` / `export`; Node.js SDK means that the code is executed by a Node.js process. It is not a Python package or a browser SDK. Python, Go, and other languages can call the [local HTTP API](./api) directly.

When running an inline SDK program from another PowerShell directory, import the built entrypoint by absolute path:

```powershell
$repo = "D:\AI_agent\cases\AgentDock"
$env:AGENTDOCK_SDK_ENTRY = "$repo\packages\core\dist\index.js"
$env:AGENTDOCK_API_BASE = "http://127.0.0.1:4177/api/v1"
$env:AGENTDOCK_API_TOKEN = "replace-with-your-local-api-token"

node --input-type=module -e 'const {pathToFileURL}=await import("node:url"); const {AgentDockClient}=await import(pathToFileURL(process.env.AGENTDOCK_SDK_ENTRY).href); const client=new AgentDockClient({baseUrl:process.env.AGENTDOCK_API_BASE,token:process.env.AGENTDOCK_API_TOKEN}); const result=await client.agent("new-agent").run({projectId:"other-project",task:"hello"}); console.log(JSON.stringify({runId:result.runId,status:result.run.status},null,2));'
```

The SDK `projectId` must match a Project in the configuration. The SDK currently has no per-call `cwd` or `workingDirectory` option. Add a Project and point its `rootDir` at the target directory when the working directory needs to change.

`baseUrl` is the API service address and is independent of the PowerShell directory and the Project `rootDir`. Provide the token through an environment variable or another local secret mechanism; never commit it to configuration or source code.

When an automation needs to explain Agent selection before execution, use the read-only `previewRouting` call instead of creating a Run:

```js
const preview = await client.previewRouting({
  task: "Review the current repository's test failures",
  projectId: "agentdock",
  network: "deny",
});
console.log(preview.routing.candidates, preview.error);
```

This always returns `executes: false` and never creates a Run. When no route is available or an Environment is not ready, inspect `preview.error` and each candidate's `reasons`, resolve the issue, then call `client.agent(agentId).run(...)` or create a Run.

## Preflight checklist

1. Run `npm run build` once from the AgentDock source tree.
2. Make sure the loopback API is running, or let the CLI call the local Runtime directly.
3. Pass the correct absolute `--config` path.
4. Confirm that the Project `rootDir` is the target directory and its `agentIds` includes the selected Agent.
5. Run `run dry-run` first and inspect `workingDirectory`, Agent, Environment, and Permission.
