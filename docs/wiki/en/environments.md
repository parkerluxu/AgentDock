# Environment management

An Environment separates an Agent's native configuration from AgentDock control metadata. It can contain config, skills, plugins, commands, state, and cache directories.

## Managed vs external

| Mode | Behavior | Use case |
| --- | --- | --- |
| `managed` | Creates `.agentdock/environments/<id>/config`, `state`, and `cache`. | Reproducible and isolated project environments. |
| `external` | Points `homeDir` or `configDir` at an existing home such as `~/.claude`. | Reuse an existing Agent setup. |

AgentDock records a manifest with a configuration hash. If the native directory changes outside AgentDock, the API returns `ENVIRONMENT_RESCAN_REQUIRED` before execution.

```text
POST /api/v1/environments/<environment-id>/rescan
GET  /api/v1/environments/<environment-id>/backups
POST /api/v1/environments/<environment-id>/backups
POST /api/v1/environments/<environment-id>/restore
```

CLI `run execute` and `session create` scan before starting. A configuration directory is not an OS sandbox; combine Environment settings with Permission and the Runtime's own sandbox/approval options.
