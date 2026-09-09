# Data, permissions, and security boundaries

AgentDock is designed for local control and auditability, not for turning arbitrary Agents into strongly isolated sandboxes.

- The API is loopback-only and requires a Bearer token.
- Start with `network: "deny"`, `filesystem.write: false`, narrow filesystem roots, and a small environment-variable allowlist.
- Store Secret References, never plaintext secret values, in configuration.
- Logs, API responses, events, and exports redact common sensitive keys and configured additional keys.
- `storage.saveOutput: false` reduces persisted content but does not change execution permissions.
- `storage.retentionDays` removes old terminal Runs; queued and running Runs are retained.
- Do not expose the API through port forwarding or a reverse proxy to other hosts.

Configuration saves use revision/hash conflict detection, atomic replacement, backups, and an audit log that records paths and risk summaries rather than values.
