# Architecture, components, and repository map

In plain language, AgentDock separates four questions: which Agent to call, which local Agent configuration it uses, which project it works in, and what it is allowed to access. The CLI, API, or DSH plugin can then submit work through the same control plane.

## What the configuration objects mean

| Object | Think of it as | Main responsibility |
| --- | --- | --- |
| Engine | An executable Agent Runtime | codex, claude-code, or built-in echo; defines the Adapter, command, and capabilities. |
| Agent | A selectable work identity | Binds one Engine, Environment, and Permission, for example codex-reviewer. |
| Environment | The Agent's own home directory | Isolates native config, state, and cache. It can be AgentDock-managed or point at an existing directory; it is not the repository working directory. |
| Project | The project the Agent works on | rootDir is the actual working directory; it also restricts available Agents and selects a default. |
| Environment Permission | AgentDock's application-level policy | Defines filesystem roots/write access, environment variables, and network policy; it is not an OS/container sandbox. |
| Session | Reusable native conversation context | Refers to the Agent Engine's native session ID; separate Sessions isolate conversations. |
| Run | One task execution record | Stores status, events, and a frozen configuration snapshot for inspection and history. |

The relationships look like this:

~~~text
Project ──restricts Agents / provides default──> Agent
                                                  ├──binds──> Engine
                                                  ├──binds──> Environment
                                                  └──binds──> Permission

CLI / API / DSH ──select Project + Agent──> Run (frozen execution snapshot and events)
                                                   └──may reference/reuse──> Session
~~~

## How one task flows through the system

~~~text
Terminal CLI / Control Center / HTTP API / DSH plugin
                       │
             Config validation and routing
                       │
      Permission + Environment readiness checks
                       │
         RunService / SessionService + snapshot
                       │
        Runtime Registry → Adapter → Agent CLI
                       │
         Runs / Sessions / events stored in SQLite
~~~

The CLI is for people and Shell scripts. The local API is for same-machine scripts, IDEs, the Control Center, and the DSH plugin. RunService owns execution state and events; an Adapter translates a common request into the selected Agent CLI invocation. Editing today's configuration does not rewrite historical Run snapshots.

## Repository map

~~~text
AgentDock/
├── package.json                 npm workspaces and repository-level scripts
├── packages/
│   ├── core/
│   │   ├── src/                 AgentDock core TypeScript source
│   │   ├── examples/            Config, Echo, and API client examples
│   │   └── dist/                Core build output; CLI entrypoint is cli.js
│   └── dsh/
│       ├── src/                 DeepSeek Harness plugin source
│       └── dist/                Plugin build output
├── docs/                        Design, development, config, API, and release docs
│   └── wiki/                    VitePress pages and site config in Chinese/English
└── .agentdock/                  Local config and runtime data, not source code
~~~

Core source folders and files:

| Path | Purpose |
| --- | --- |
| packages/core/src/cli.ts | CLI entrypoint: parses commands and calls the corresponding services. |
| packages/core/src/config/ | Config schema, loading, validation, object model, and safe editing. |
| packages/core/src/runtime/ | Agent Adapters, routing, Runs, Sessions, health checks, and diagnostics. |
| packages/core/src/environment/ | Managed/external Environment directories, manifests, backups, drift checks, and recovery. |
| packages/core/src/policy/ | Resolves Agent, Project, Environment, and Permission into an execution context. |
| packages/core/src/api/ | Loopback HTTP API, authentication, rate limits, and config routes. |
| packages/core/src/web/ | Built-in Control Center page and browser configuration UI. |
| packages/core/src/storage/ | SQLite persistence for Runs, events, Sessions, and idempotency keys. |
| packages/core/src/secrets/ | Resolves sensitive values from permitted secret references. |
| packages/dsh/src/ | DSH plugin backend, model/invocation adapters, API client, and UI extension. |
| .agentdock/ | Local config, Run database, tokens, Environment control files, and backups. |

Run npm run build --workspace agentdock to build core; npm run build builds both core and DSH. Normally edit source under src/, not generated files in dist/.

## Run states and events

Runs use queued, running, succeeded, failed, cancelled, and timed_out states. Events have a strictly increasing sequence within each Run and record status, messages, tool calls/results, or errors. Run creation freezes the Agent, Engine, Environment, Permission, Project, working directory, and Environment manifest/hash.

For a first local run, start with [Installation and quick start](./getting-started); for editing config objects, see [Configuration](./configuration).
