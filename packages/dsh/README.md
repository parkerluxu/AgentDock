# AgentDock DSH integration

`@agentdock/dsh` adds AgentDock as a DeepSeek Harness provider and Settings extension. Each enabled AgentDock Agent is exposed as a selectable DSH model; choosing one automatically binds the DSH conversation on its first turn. Its local package embeds the required AgentDock control-plane code, so it does not fetch an unpublished core package from npm.

For a local install, pack and install the single adapter artifact:

```powershell
npm pack --workspace @agentdock/dsh
npx @deepseek-ai/dsh plugin --profile web add -w .\agentdock-dsh-<version>.tgz
```

When replacing a local tarball without changing its version, remove the installed plugin before adding it again so DSH reloads the client bundle.
