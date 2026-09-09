# Workflows

## Initialize a project

1. Copy the [sample configuration](https://github.com/parkerluxu/AgentDock/blob/main/examples/config.example.json) or create `.agentdock/config.json`.
2. Declare Engines and confirm their binaries are available.
3. Create a managed Environment or point an external Environment at an existing Agent home.
4. Start with a read-only, network-denied Permission.
5. Bind Engine, Environment, and Permission into an Agent.
6. Add the Agent to a Project and choose `defaultAgentId`.
7. Run validation, `doctor`, and Engine health checks.

## Preview, execute, audit

```text
node dist/cli.js run dry-run --config .agentdock/config.json --project my-project "review the current changes"
node dist/cli.js run execute --config .agentdock/config.json --project my-project "review the current changes"
node dist/cli.js run show --config .agentdock/config.json <run-id>
node dist/cli.js run events --config .agentdock/config.json <run-id>
node dist/cli.js run export --format jsonl --config .agentdock/config.json <run-id>
```

## Sessions

```text
node dist/cli.js session create --config .agentdock/config.json --agent claude-reviewer
node dist/cli.js run execute --config .agentdock/config.json --session <session-id> "continue the investigation"
```

## API integration

Start the API, submit `POST /api/v1/runs` with a Bearer token, save the returned Run ID, and read `/events` as JSON or SSE. Store the last sequence and reconnect with `after=<sequence>`.
