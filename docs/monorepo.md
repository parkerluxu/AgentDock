# AgentDock monorepo

The repository contains independently publishable packages that share one Git
history and one local dependency graph.

```text
packages/core  -> agentdock
packages/dsh   -> @agentdock/dsh
```

`agentdock` owns the CLI, local API, runtime, storage, configuration model,
and SDK. It deliberately has no dependency on DSH, Cordis, or React.

`@agentdock/dsh` owns the DeepSeek Harness adapter: its Cordis host plugin,
browser Settings extension, RPC bridge, and DSH session binding store. It
depends on a compatible published `agentdock` version, but core must never
import this adapter.

## Development commands

Run these from the repository root:

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

Run one package only when iterating locally:

```powershell
npm run build --workspace agentdock
npm run test --workspace agentdock

npm run build --workspace @agentdock/dsh
npm run test --workspace @agentdock/dsh
```

The core example configuration is located at
`packages/core/examples/config.example.json`.

## Publishing order

Publish the core package before an adapter release:

```text
1. Publish agentdock
2. Set @agentdock/dsh's agentdock dependency to that compatible version
3. Publish @agentdock/dsh
```

For DSH, package and install only the adapter artifact:

```powershell
npm pack --workspace @agentdock/dsh
npx @deepseek-ai/dsh plugin --profile web add -w .\agentdock-dsh-<version>.tgz
```

The DSH environment resolves the matching `agentdock` core package as a normal
npm dependency. Core users who do not install `@agentdock/dsh` do not receive
DSH, Cordis, or React dependencies.
