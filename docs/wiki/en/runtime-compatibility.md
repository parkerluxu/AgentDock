# Runtime compatibility matrix

This matrix records Adapter-declared native-home contracts. `declared` means the code path and CLI syntax have been documented but have not yet completed a controlled real-runtime smoke test on the target version. It is not a verified-compatibility claim. Default automated tests use only fake or Echo Adapters and never invoke real models.

| Runtime | Adapter support range | Native home variable | Session syntax | Mutable directories | Status |
| --- | --- | --- | --- | --- | --- |
| Codex CLI | `>=0.147.0` | `CODEX_HOME` | `codex exec resume <thread-id>` | config, cache, session | `declared` |
| Claude Code | `>=2.1.0` | `CLAUDE_CONFIG_DIR` | `--session-id <id>`, `--resume <id>` | config, cache, session | `declared` |
| Echo | `*` | none | unsupported | none | fake/test Adapter |

AgentDock always supplies `AGENTDOCK_CONFIG_DIR`, `AGENTDOCK_STATE_DIR`, and `AGENTDOCK_CACHE_DIR` to Adapter children; the matrix lists only native Runtime variables that select a home. `environment doctor <id>` displays the active contract, detected Runtime version, and support range without exposing Secret values.

## Requirements for `verified`

For each operating system and Runtime version, record a controlled low-cost test with:

- the `--version` output and Adapter version;
- the home/config/state/cache variables used by a read-only, non-interactive Run;
- create/resume Session syntax;
- directory categories actually changed after the Run; and
- Environment template/backup checks confirming that tokens, login state, and native sessions were not copied.

Then update this table and the Adapter manifest's `nativeHome.verification`. Unknown, unsupported, or undeclared behavior must remain a diagnostic warning rather than a guess.
