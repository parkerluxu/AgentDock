# Control Center UI guide

The Control Center is AgentDock's local web interface. It is for status, audit history, and configuration editing; start or cancel Runs with the CLI or API.

## Connect and switch language

Start the API and open `http://127.0.0.1:4177/`. On the first visit, enter the token printed by `agentdock api serve` or read from `api-token`. The token stays in this browser's local storage and is not put in the URL.

Use the `中 / EN` control in the top-right corner to switch the interface language. The selection is remembered. “Sign out” clears the browser token.

## Overview and Run details

The Overview shows API connection status, total/active/succeeded Run counts, Sessions, recent Runs, and filters for status and Project. Select a Run to inspect its ID, Engine, Environment, Project, Session, execution snapshot, working directory, allowed environment keys, configuration hash, and ordered event timeline.

Read the snapshot first to confirm where the Run executed and which boundary it used; then inspect messages, tool calls, results, and errors.

## Configuration center

The Configuration center edits Agent Engines, Agent Environments, Projects, Environment Permissions, and Agents. A safe order is Engine → Environment → Permission → Agent → Project. Project forms list selectable Agents, so IDs do not need to be typed manually.

Each entity supports Form and Advanced JSON modes. Use Form for common fields and JSON for Runtime-specific `settings`. Add/remove changes are local until saved. Secret fields edit provider/key references only; plaintext secrets are never displayed.

## Preview, save, and restore

1. Edit a form or JSON object.
2. Click “Preview changes”.
3. Review validation, diff, dry-run, and Permission issues.
4. Confirm high-risk changes such as writes, network, shell/command, or Secret Reference changes.
5. Save. Safe changes are hot-reloaded; restart the API only when the response says it is required.

Revision/hash checks prevent overwriting a newer configuration. Backups can be restored from the Backups area; restoring is hot-reloaded when safe.

## UI limits

| Capability | UI |
| --- | --- |
| View Engine, Environment, Project, Session, and Run history | Supported |
| Inspect Run snapshots and event timelines | Supported |
| Preview, save, backup, and restore configuration | Supported |
| Start or cancel a Run | Use CLI/API |
| Read plaintext Secrets | Not supported |
| Expose the API remotely | Not supported or recommended |
