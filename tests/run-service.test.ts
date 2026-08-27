import { describe, expect, it } from "vitest";
import type { AgentAdapter, AdapterManifest, AdapterTaskRequest } from "../src/adapter-contract/index.js";
import type { AdapterHealth, AdapterSessionReference } from "../src/adapter-contract/index.js";
import type { ExecutionContext, RunEvent } from "../src/core/types.js";
import { RunService } from "../src/runtime/run-service.js";
import { SqliteRunStore } from "../src/storage/sqlite-run-store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const context: ExecutionContext = {
  runtime: { id: "fake", adapter: "fake", args: [], enabled: true, capabilities: ["execute"] },
  profile: { id: "default", runtimeId: "fake", policyId: "readonly", settings: {} },
  policy: { id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: [] }, network: "deny" },
  workingDirectory: process.cwd(),
  allowedEnvironmentKeys: [],
  environment: {},
  secretReferences: {},
};

class FakeAdapter implements AgentAdapter {
  public readonly manifest: AdapterManifest = { name: "fake", version: "0.1.0", entry: "./fake-adapter.js", agentDockApi: "v1", runtime: { id: "fake" }, capabilities: ["execute", "create_session"], requiredPermissions: [] };
  public lastRequest: AdapterTaskRequest | undefined;

  public async healthCheck(): Promise<AdapterHealth> { return { healthy: true, runtime: context.runtime }; }
  public async *execute(request: AdapterTaskRequest): AsyncIterable<RunEvent> {
    this.lastRequest = request;
    yield { runId: request.runId, sequence: 0, timestamp: new Date().toISOString(), type: "status", payload: { status: "running" } };
    yield { runId: request.runId, sequence: 1, timestamp: new Date().toISOString(), type: "message", payload: { text: request.task } };
    yield { runId: request.runId, sequence: 2, timestamp: new Date().toISOString(), type: "status", payload: { status: "succeeded", exitCode: 0 } };
  }
  public async cancel(): Promise<void> {}
  public async createSession(): Promise<AdapterSessionReference> { return { supported: true, runtimeSessionId: "native-session-1", state: "pending" }; }
  public async resumeSession(runtimeSessionId: string): Promise<AdapterSessionReference> { return { supported: true, runtimeSessionId }; }
}

class FailingAdapter extends FakeAdapter {
  public override async *execute(_request: AdapterTaskRequest): AsyncIterable<RunEvent> {
    throw new Error("adapter startup failed");
  }
}

class NoTerminalAdapter extends FakeAdapter {
  public override async *execute(request: AdapterTaskRequest): AsyncIterable<RunEvent> {
    yield { runId: request.runId, sequence: 0, timestamp: new Date().toISOString(), type: "status", payload: { status: "running" } };
  }
}

describe("RunService", () => {
  it("persists adapter events and final status", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-run-service-"));
    const store = new SqliteRunStore(join(directory, "agentdock.db"));
    try {
      const service = new RunService(store);
      const adapter = new FakeAdapter();
      const results = [];
      for await (const result of service.execute({ context, task: "inspect", adapter })) results.push(result);
      expect(results.map((result) => result.event.type)).toEqual(["status", "status", "message", "status"]);
      expect(results[0]?.event.payload).toEqual({ status: "queued" });
      expect(results.at(-1)?.run.status).toBe("succeeded");
      expect(store.listRuns()[0]?.status).toBe("succeeded");
      expect(store.listEvents(results[0]?.run.id ?? "")).toHaveLength(4);
      expect(adapter.lastRequest).toMatchObject({ runtimeSessionId: "native-session-1", sessionMode: "create" });
      expect(store.getSession(results[0]?.run.sessionId ?? "")?.resumable).toBe(true);
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("marks a Run failed when the Adapter throws before its first event", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-run-service-failure-"));
    const store = new SqliteRunStore(join(directory, "agentdock.db"));
    try {
      const results = [];
      for await (const result of new RunService(store).execute({ context, task: "fail", adapter: new FailingAdapter() })) results.push(result);
      expect(results.at(-1)?.run.status).toBe("failed");
      expect(results.at(-1)?.event).toMatchObject({ type: "error", payload: { status: "failed", errorCode: "ADAPTER_EXECUTION_ERROR" } });
      expect(store.getRun(results[0]?.run.id ?? "")?.status).toBe("failed");
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("persists and yields a terminal error when an Adapter omits a terminal event", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-run-service-no-terminal-"));
    const store = new SqliteRunStore(join(directory, "agentdock.db"));
    try {
      const results = [];
      for await (const result of new RunService(store).execute({ context, task: "incomplete", adapter: new NoTerminalAdapter() })) results.push(result);
      expect(results.at(-1)?.event).toMatchObject({ type: "error", payload: { status: "failed", errorCode: "NO_TERMINAL_EVENT" } });
      expect(store.listEvents(results[0]?.run.id ?? "").at(-1)).toMatchObject({ type: "error", payload: { errorCode: "NO_TERMINAL_EVENT" } });
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
