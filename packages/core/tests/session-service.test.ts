import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AdapterHealth, AdapterManifest, AdapterSessionReference, AdapterTaskRequest, AgentAdapter } from "../src/adapter-contract/index.js";
import type { ExecutionContext, RunEvent } from "../src/core/types.js";
import { SessionService } from "../src/runtime/session-service.js";
import { SqliteRunStore } from "../src/storage/sqlite-run-store.js";

const context: ExecutionContext = {
  engine: { id: "claude-code", adapter: "claude-code", args: [], enabled: true, capabilities: ["create_session"] },
  agent: { id: "reviewer", engineId: "claude-code", environmentId: "review", permissionId: "readonly", enabled: true, processEnv: {}, settings: {} },
  agentEnvironment: { id: "review", engineId: "claude-code", permissionId: "readonly", directoryMode: "managed", launchArgs: [], settings: {} },
  environmentPermission: { id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: [] }, network: "deny" },
  project: { id: "app", rootDir: process.cwd(), environmentIds: ["review"] },
  workingDirectory: process.cwd(),
  allowedEnvironmentKeys: [],
  environment: {},
  secretReferences: {},
};

class SessionAdapter implements AgentAdapter {
  public readonly manifest: AdapterManifest = { name: "session", version: "0.1.0", entry: "./session-adapter.js", agentDockApi: "v1", runtime: { id: "claude-code" }, capabilities: ["create_session"], requiredPermissions: [] };
  public async healthCheck(): Promise<AdapterHealth> { return { healthy: true }; }
  public async *execute(): AsyncIterable<RunEvent> { return; }
  public async cancel(): Promise<void> {}
  public async createSession(): Promise<AdapterSessionReference> { return { supported: true, runtimeSessionId: "native-123" }; }
}

describe("SessionService", () => {
  it("creates and archives a mapped native session", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-session-"));
    const store = new SqliteRunStore(join(directory, "agentdock.db"));
    try {
      const service = new SessionService(store);
      const session = await service.create(context, new SessionAdapter());
      expect(session).toMatchObject({ agentId: "reviewer", engineId: "claude-code", environmentId: "review", runtimeSessionId: "native-123", resumable: true, status: "active" });
      expect(service.archive(session.id)).toMatchObject({ id: session.id, status: "archived" });
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
