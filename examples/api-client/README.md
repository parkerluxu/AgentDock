# Local API Client Example

This zero-dependency Node.js client creates a Run and consumes its complete SSE stream. It uses Node 22's built-in `fetch` and does not contain a token in source code.

Start the local API in one terminal. For a deterministic run, configure and install [`../adapter-echo`](../adapter-echo/README.md) as the `example-echo` Runtime first; the standard config can instead use a locally installed Claude Code or Codex Runtime.

```text
node dist/cli.js api serve --config examples/config.example.json --port 4177
```

Read the generated `api-token` file path from the startup JSON, then run:

```text
set AGENTDOCK_API_TOKEN=<token>
set AGENTDOCK_PROJECT_ID=agentdock
node examples/api-client/client.mjs "inspect the current repository"
```

PowerShell uses `$env:AGENTDOCK_API_TOKEN` and `$env:AGENTDOCK_PROJECT_ID` for the two environment variables. The client prints one JSON line for the Run followed by JSON event lines. It sends an `Idempotency-Key`, starts SSE at `after=-1`, and can be adapted to persist the last event id before reconnecting.
