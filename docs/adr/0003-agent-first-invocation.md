# ADR-0003: Agent is the default invocation unit

- Status: Accepted
- Date: 2026-09-22
- Related plan: [Local Agent environment development plan](../local-agent-environment-development-plan.zh-CN.md)

## Context

AgentDock manages both reusable native Environments and callable Agents. Choosing
an Environment directly is needed for configuration, diagnostics, recovery, and
advanced automation, but it exposes an implementation detail to ordinary
callers. It also makes it too easy to resume a native Session in an unintended
profile.

## Decision

The recommended API, SDK, CLI, and DSH flows select an **Agent**. Its binding
supplies the Engine, Environment, and Environment Permission:

| Entry point | Selection rule |
| --- | --- |
| `POST /agents/{agentId}/invoke` | Agent only; `environmentId` is rejected. |
| `AgentDockClient.agent(id).run()` | Agent only. |
| `agentdock agent run <agent-id>` | Agent only; `--environment` is rejected. |
| DSH dynamic model | Agent only. |
| `POST /runs` and `agentdock run execute` | Advanced explicit routing; `environmentId` remains supported for queues, batch jobs, and recovery tooling. |
| Environment UI/API | Configuration, diagnostics, import, backup, restore, and advanced debugging only. |

Every Session resume checks its archived state plus Agent, Engine, and
Environment identity. The public mismatch codes are
`SESSION_ARCHIVED`, `SESSION_AGENT_MISMATCH`, `SESSION_ENGINE_MISMATCH`, and
`SESSION_ENVIRONMENT_MISMATCH`.

`Environment Permission` is a launch constraint and audit policy. It is not an
OS, container, or VM security sandbox.

## Compatibility

The v1 configuration reader continues to synthesize deterministic Agents for
pre-Agent configurations and continues to understand legacy Project
`environmentIds`. Those forms are compatibility inputs, not recommended new
configuration. A later configuration-major release will provide a local,
previewable migration and recoverable configuration backup before removing
them.

## Consequences

The common invocation path has one stable user-facing identifier and an
auditable Environment binding. Low-level routing remains available without
breaking existing batch or recovery integrations. Callers must treat a Session
as scoped to its Agent profile rather than as a generic Engine conversation.
