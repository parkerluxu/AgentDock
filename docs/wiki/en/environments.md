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

CLI `run execute` and `session create` scan before starting, while the API reconciles runtime changes after a Run. A configuration directory is not an OS sandbox; combine Environment settings with Permission and the Runtime's own sandbox/approval options.
