# Plain-language case study: review one repository

Imagine Alex wants an Agent to answer “Why are this project's tests failing?” Alex does not need to understand every AgentDock term up front.

## Four simple roles

- **Engine** is the motor: Claude Code or Codex.
- **Environment** is the desk where the Agent keeps its own settings.
- **Permission** is the access badge: which files, network, and environment variables are allowed.
- **Project** is the room: which repository and Agents belong to the task.

A Run is an operation record. Before starting, AgentDock takes a snapshot of the motor, desk, badge, and repository location; afterwards it stores the steps and outcome.

## Step 1: prepare

```text
npm ci
npm run build
npm run config:validate -- examples/config.example.json
node dist/cli.js doctor --config examples/config.example.json
```

If Alex has no real Runtime, the deterministic Echo Adapter can be installed for a no-model demo.

## Step 2: preview the route

```text
node dist/cli.js run dry-run --config examples/config.example.json --project agentdock "find why the tests fail"
```

This is like checking a map before leaving: AgentDock reports the selected Agent, Environment, working directory, network policy, and write policy. It does not start a model.

## Step 3: execute

```text
node dist/cli.js run execute --config examples/config.example.json --environment claude-code-home "find why the tests fail"
```

The terminal prints JSONL events. Alex only needs to keep the Run ID, like a tracking number.

## Step 4: inspect in the UI

In another terminal:

```text
node dist/cli.js api serve --config examples/config.example.json --port 4177
```

Open `http://127.0.0.1:4177/`, enter the token, filter the Overview by the `agentdock` Project, and select the new Run. Read the snapshot first, then the event timeline. If Alex changes a Permission, the UI previews and saves it, then the API must be restarted; old Run snapshots remain unchanged.

## Step 5: automate later

CI can submit `POST /api/v1/runs` and consume `GET /api/v1/runs/<run-id>/events?stream=sse`. Save the last event sequence and reconnect with `after=<sequence>` if needed.

The practical lesson is simple: preview first, keep the Project boundary explicit, use the UI for understanding, and use CLI/API for execution and automation.
