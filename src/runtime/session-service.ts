import { randomUUID } from "node:crypto";
import { isCapabilitySupported, type AgentAdapter } from "../adapter-contract/index.js";
import type { ExecutionContext, Session } from "../core/types.js";
import { SqliteRunStore } from "../storage/sqlite-run-store.js";

export class SessionService {
  public constructor(private readonly store: SqliteRunStore) {}

  public async create(context: ExecutionContext, adapter: AgentAdapter, signal?: AbortSignal): Promise<Session> {
    const reference = isCapabilitySupported(adapter.manifest, "create_session") && adapter.createSession
      ? await adapter.createSession(signal)
      : { supported: false };
    return this.store.createSession({
      id: randomUUID(),
      ...(context.project ? { projectId: context.project.id } : {}),
      runtimeId: context.runtime.id,
      resumable: reference.supported && reference.state !== "pending",
      ...(reference.runtimeSessionId ? { runtimeSessionId: reference.runtimeSessionId } : {}),
    });
  }

  public archive(id: string): Session {
    return this.store.updateSession(id, { status: "archived" });
  }
}
