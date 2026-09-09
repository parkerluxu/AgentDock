# Architecture and core concepts

```text
CLI / Control Center / HTTP API
              │
        Router and Policy
              │
        RunService / SessionService
              │
       Runtime Registry + Adapter
              │
       Claude Code / Codex / local package
              │
       ProcessRunner + native Agent home
              │
             SQLite
```

- **CLI** handles validation, diagnostics, execution, Sessions, queries, exports, and API startup.
- **API** is a loopback HTTP server; `src/web/` contains the Control Center.
- **Router/Policy** selects an execution context from explicit choices, Project defaults, and capability requirements.
- **RunService** creates Runs, freezes snapshots, validates state transitions, persists events, and handles cancellation.
- **Runtime Registry** loads built-in and enabled local Adapters and validates their manifests.
- **EnvironmentDirectoryManager** manages directories, manifests, hashes, backups, and restores.
- **SqliteRunStore** persists Runs, events, Sessions, and idempotency keys.

## Object relationships

```text
Engine ──referenced by──> Agent ──binds──> Environment
                                      └──> Environment Permission
Project ──allows multiple Agents──> Agent
Run ──freezes at creation──> Agent / Engine / Environment / Permission / Project
Session ──belongs to an Engine──> Run
```

Runs move through `queued`, `running`, `succeeded`, `failed`, `cancelled`, and `timed_out`. Events use one Run ID and strictly increasing sequence numbers. Snapshots preserve the original execution context even after configuration changes.
