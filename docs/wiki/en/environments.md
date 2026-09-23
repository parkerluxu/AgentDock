# Environment management

An Environment separates an Agent's native configuration from AgentDock control metadata. It can contain config, skills, plugins, commands, state, and cache directories.

## Managed vs external

| Mode | Behavior | Use case |
| --- | --- | --- |
| `managed` | Creates `.agentdock/environments/<id>/config`, `state`, and `cache`. | Reproducible and isolated project environments. |
| `external` | Points `homeDir` or `configDir` at an existing home such as `~/.claude`. | Reuse an existing Agent setup. |

AgentDock records a manifest with a configuration hash. If the native directory has already changed before a new Run starts, the API returns `ENVIRONMENT_RESCAN_REQUIRED` until the change is explicitly rescanned. Changes produced by the Agent while a Run is active—including sessions, caches, and runtime state—are reconciled automatically when the Run finishes. This behavior applies to both `managed` and `external` Environments.

```text
POST /api/v1/environments/<environment-id>/rescan
GET  /api/v1/environments/<environment-id>/backups
POST /api/v1/environments/<environment-id>/backups
POST /api/v1/environments/<environment-id>/restore
```

CLI `run execute`, `session create`, and the API require a ready Environment. Only a brand-new managed directory is initialized automatically; an existing directory without a manifest or one that has drifted must first be confirmed with `environment rescan <id>`. The API reconciles runtime changes after a Run. A configuration directory is not an OS sandbox; combine Environment settings with Permission and the Runtime's own sandbox/approval options.

Copy and import create managed, config-only Environments. To reference an existing native home directly, create an `external` Environment instead. The same filter is used for copy, import, backup, and restore: ordinary config, skills, plugins, and commands are retained, while `.env`, token/OAuth/credential files, sessions/history, SQLite/WAL, cache, logs, state, and symlinks are excluded. Each operation appends a redacted summary to `environment-audit.jsonl` in the AgentDock control directory (`.agentdock` by default); it contains hashes and excluded category counts, never file paths or contents.

## Local templates

A template is an immutable config-only archive at `.agentdock/environment-templates/<template-id>/`; it is not a new global configuration entity. It records the source Environment, Engine/version hint, creation time, config hash, excluded-category counts, and filtered `config/`. It never stores tokens, authentication cache, sessions, state, or cache.

```text
agentdock environment template create review-base source-environment --config <path>
agentdock environment template list --config <path>
agentdock environment template apply review-base review-derived --confirm-high-risk --config <path>
```

`apply` inherits the source Environment's non-sensitive binding and creates a new managed Environment. It validates the archive hash and exclusion rules before copying. Its `stateDir`, `cacheDir`, and native login state are empty, so log in again in the derived Environment. Local API clients can instead submit a new managed Environment definition to `POST /api/v1/environment-templates/<template-id>/apply`.

## Recovery runbook

First stop or wait for Runs using the target Environment, then run `agentdock environment doctor <id>`. When it reports `drifted`, review the native-directory change and explicitly confirm it with `agentdock environment rescan <id>` only if it is trusted; do not use automatic rescan to hide an unknown change.

Environment backups live under `environment-backups/` in the AgentDock control directory. Use the Environment backup area in Control Center or call:

```text
GET  /api/v1/environments/<id>/backups
POST /api/v1/environments/<id>/backups
POST /api/v1/environments/<id>/restore
```

The restore body requires `backupId`; restoring an external Environment also requires an explicit `confirmExternal: true`. Restore validates a staging copy and its hash before atomically replacing config. An existing target config is backed up first. Historical Run snapshots, events, and output remain unchanged; only the current Environment manifest changes.

Templates, copy, import, backup, and restore never retain tokens, OAuth/login cache, native sessions, state, or cache. If login state is absent after a restore or template derivation, complete the Runtime login again in the new managed Environment; never manually copy authentication files from an old home. On failure, the current directory and historical backups remain available. Inspect the API error code and the category/count-only `environment-audit.jsonl` summary before retrying.

## Environment doctor

`agentdock environment doctor <id>` emits structured JSON for directory writability, configuration-directory symlinks, manifest/hash drift, Runtime version, the Adapter native-home contract, Permission, and Secret Reference resolvability. Secrets expose only reference names and health, never values. `isSecuritySandbox: false` explicitly states that Permission is a launch constraint and audit policy, not OS/container isolation.

Built-in Codex and Claude Code Adapters declare their home environment variables and session syntax. The contracts in this repository are `declared`, not `verified`, until a low-cost read-only smoke test has been recorded on the target machine. Default tests never invoke real models or consume usage. See the [runtime compatibility matrix](./runtime-compatibility).
