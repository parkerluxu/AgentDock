import { randomUUID } from "node:crypto";
import { isCapabilitySupported, type AgentAdapter } from "../adapter-contract/index.js";
import { SessionIdentityError } from "../core/errors.js";
import type { ExecutionContext, Session } from "../core/types.js";
import { SqliteRunStore } from "../storage/sqlite-run-store.js";

export interface SessionExecutionIdentity {
  agentId?: string | undefined;
  engineId: string;
  environmentId: string;
}

/**
 * Ensures a native Session is resumed only by the same Agent profile. Keep
 * this check in one place so direct RunService callers and HTTP callers emit
 * the same public error codes.
 */
export function assertSessionIdentity(session: Session, identity: SessionExecutionIdentity): void {
  if (session.status !== "active") {
    throw new SessionIdentityError("SESSION_ARCHIVED", `Session "${session.id}" is archived and cannot accept a new Run.`);
  }
  if (session.agentId && session.agentId !== identity.agentId) {
    throw new SessionIdentityError("SESSION_AGENT_MISMATCH", `Session "${session.id}" belongs to Agent "${session.agentId}", not "${identity.agentId ?? "the selected Agent"}".`);
  }
  if (session.engineId !== identity.engineId) {
    throw new SessionIdentityError("SESSION_ENGINE_MISMATCH", `Session "${session.id}" belongs to Engine "${session.engineId}", not "${identity.engineId}".`);
  }
  if (session.environmentId && session.environmentId !== identity.environmentId) {
    throw new SessionIdentityError("SESSION_ENVIRONMENT_MISMATCH", `Session "${session.id}" belongs to Environment "${session.environmentId}", not "${identity.environmentId}".`);
  }
}

export class SessionService {
  public constructor(private readonly store: SqliteRunStore) {}

  public async create(context: ExecutionContext, adapter: AgentAdapter, signal?: AbortSignal): Promise<Session> {
    const reference = isCapabilitySupported(adapter.manifest, "create_session") && adapter.createSession
      ? await adapter.createSession(signal)
      : { supported: false };
    return this.store.createSession({
      id: randomUUID(),
      ...(context.project ? { projectId: context.project.id } : {}),
      ...(context.agent ? { agentId: context.agent.id } : {}),
      engineId: context.engine.id,
      environmentId: context.agentEnvironment.id,
      resumable: reference.supported && reference.state !== "pending",
      ...(reference.runtimeSessionId ? { runtimeSessionId: reference.runtimeSessionId } : {}),
    });
  }

  public archive(id: string): Session {
    return this.store.updateSession(id, { status: "archived" });
  }
}
