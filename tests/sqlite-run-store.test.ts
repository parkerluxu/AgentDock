import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEngine, AgentEnvironment, EnvironmentPermission, Project } from "../src/core/types.js";
import { SqliteRunStore } from "../src/storage/sqlite-run-store.js";

const engine: AgentEngine = {
  id: "codex",
  adapter: "codex",
  binary: "codex",
  args: [],
  enabled: true,
  capabilities: ["execute"],
};
const environment: AgentEnvironment = { id: "review", engineId: "codex", permissionId: "readonly", directoryMode: "managed", launchArgs: [], settings: { sandbox: "read-only" } };
const environmentPermission: EnvironmentPermission = { id: "readonly", filesystem: { roots: ["."] , write: false }, environment: { allow: ["PATH"] }, network: "deny" };
const project: Project = { id: "app", rootDir: "C:/workspace", environmentIds: ["review"], defaultEnvironmentId: "review" };

const databases: SqliteRunStore[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of databases.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createStore(): SqliteRunStore {
  const directory = mkdtempSync(join(tmpdir(), "agentdock-test-"));
  directories.push(directory);
  const store = new SqliteRunStore(join(directory, "data", "agentdock.db"));
  databases.push(store);
  return store;
}

describe("SqliteRunStore", () => {
  it("persists sessions, runs, snapshots and ordered events", () => {
    const store = createStore();
    store.createSession({ id: "ses-1", projectId: "app", engineId: "codex", resumable: false });
    store.createRun({
      id: "run-1",
      engineId: "codex",
      environmentId: "review",
      projectId: "app",
      sessionId: "ses-1",
      task: "inspect",
      snapshot: { engine, environment, environmentPermission, project },
    });
    store.appendEvent({ runId: "run-1", sequence: 0, timestamp: "2026-08-22T00:00:00.000Z", type: "status", payload: { status: "running" } });
    store.appendEvent({ runId: "run-1", sequence: 1, timestamp: "2026-08-22T00:00:01.000Z", type: "status", payload: { status: "succeeded", exitCode: 0 } });
    store.updateRun("run-1", { status: "succeeded", exitCode: 0, finishedAt: "2026-08-22T00:00:01.000Z" });

    expect(store.getSession("ses-1")?.engineId).toBe("codex");
    expect(store.getRun("run-1")).toMatchObject({ id: "run-1", status: "succeeded", snapshot: { environmentPermission: { network: "deny" } } });
    expect(store.listEvents("run-1").map((event) => event.sequence)).toEqual([0, 1]);
  });

  it("marks non-active runs as failed after a restart", () => {
    const store = createStore();
    store.createRun({ id: "orphan", engineId: "codex", environmentId: "review", task: "inspect", snapshot: { engine, environment, environmentPermission } });
    store.updateRun("orphan", { status: "running", startedAt: new Date().toISOString() });
    const recovered = store.recoverStaleRuns();
    expect(recovered[0]).toMatchObject({ id: "orphan", status: "failed", errorCode: "PROCESS_NOT_ACTIVE_AFTER_RESTART" });
    expect(store.listEvents("orphan")[0]?.payload).toMatchObject({ status: "failed" });
  });

  it("recovers queued and running Runs after reopening the database", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-restart-recovery-"));
    directories.push(directory);
    const path = join(directory, "agentdock.db");
    const first = new SqliteRunStore(path);
    first.createRun({ id: "queued-after-restart", engineId: "codex", environmentId: "review", task: "queued", snapshot: { engine, environment, environmentPermission }, ownerPid: 999999 });
    first.appendEvent({ runId: "queued-after-restart", sequence: 0, timestamp: "2026-08-26T00:00:00.000Z", type: "status", payload: { status: "queued" } });
    first.createRun({ id: "running-after-restart", engineId: "codex", environmentId: "review", task: "running", snapshot: { engine, environment, environmentPermission }, ownerPid: 999999 });
    first.appendEvent({ runId: "running-after-restart", sequence: 0, timestamp: "2026-08-26T00:00:00.000Z", type: "status", payload: { status: "queued" } });
    first.updateRun("running-after-restart", { status: "running", startedAt: "2026-08-26T00:00:01.000Z" });
    first.appendEvent({ runId: "running-after-restart", sequence: 1, timestamp: "2026-08-26T00:00:01.000Z", type: "status", payload: { status: "running" } });
    first.close();

    const reopened = new SqliteRunStore(path);
    databases.push(reopened);
    const recovered = reopened.recoverStaleRuns();

    expect(recovered.map((run) => run.id).sort()).toEqual(["queued-after-restart", "running-after-restart"]);
    expect(reopened.getRun("queued-after-restart")).toMatchObject({ status: "failed", errorCode: "PROCESS_NOT_ACTIVE_AFTER_RESTART" });
    expect(reopened.getRun("running-after-restart")).toMatchObject({ status: "failed", errorCode: "PROCESS_NOT_ACTIVE_AFTER_RESTART" });
    expect(reopened.listEvents("queued-after-restart").map((event) => event.sequence)).toEqual([0, 1]);
    expect(reopened.listEvents("running-after-restart").map((event) => event.sequence)).toEqual([0, 1, 2]);
    expect(reopened.listEvents("running-after-restart").at(-1)).toMatchObject({
      type: "error",
      payload: { status: "failed", errorCode: "PROCESS_NOT_ACTIVE_AFTER_RESTART" },
    });
    expect(reopened.recoverStaleRuns()).toEqual([]);
  });

  it("does not append a duplicate recovery event when two stores inspect the same Run", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-recovery-race-"));
    directories.push(directory);
    const path = join(directory, "agentdock.db");
    const first = new SqliteRunStore(path);
    const second = new SqliteRunStore(path);
    databases.push(first, second);
    first.createRun({ id: "recovery-race", engineId: "codex", environmentId: "review", task: "race", snapshot: { engine, environment, environmentPermission }, ownerPid: 999999 });
    first.appendEvent({ runId: "recovery-race", sequence: 0, timestamp: "2026-08-26T00:00:00.000Z", type: "status", payload: { status: "running" } });
    first.updateRun("recovery-race", { status: "running", startedAt: "2026-08-26T00:00:00.000Z" });

    expect(first.recoverStaleRuns()).toHaveLength(1);
    expect(second.recoverStaleRuns()).toEqual([]);
    expect(second.listEvents("recovery-race").map((event) => event.sequence)).toEqual([0, 1]);
  });

  it("does not recover a Run owned by a live AgentDock process", () => {
    const store = createStore();
    store.createRun({ id: "live", engineId: "codex", environmentId: "review", task: "inspect", snapshot: { engine, environment, environmentPermission }, ownerPid: process.pid });
    store.updateRun("live", { status: "running", startedAt: new Date().toISOString() });
    expect(store.recoverStaleRuns()).toEqual([]);
    expect(store.getRun("live")?.status).toBe("running");
  });

  it("keeps idempotency reservations in SQLite across store reopen", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-idempotency-"));
    directories.push(directory);
    const path = join(directory, "agentdock.db");
    const first = new SqliteRunStore(path);
    first.createRun({ id: "run-1", engineId: "codex", environmentId: "review", task: "inspect", snapshot: { engine, environment, environmentPermission } });
    expect(first.reserveIdempotencyKey("request-1", "hash-1", "run-1")).toEqual({ status: "created" });
    first.close();

    const reopened = new SqliteRunStore(path);
    databases.push(reopened);
    expect(reopened.reserveIdempotencyKey("request-1", "hash-1", "run-2")).toEqual({ status: "existing", runId: "run-1" });
    expect(reopened.reserveIdempotencyKey("request-1", "different", "run-3")).toEqual({ status: "conflict" });
  });

  it("prunes only expired terminal Runs and can omit output payloads", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-retention-"));
    directories.push(directory);
    const path = join(directory, "agentdock.db");
    const store = new SqliteRunStore(path, { saveOutput: false });
    databases.push(store);
    const old = "2025-01-01T00:00:00.000Z";
    store.createRun({ id: "old", engineId: "codex", environmentId: "review", task: "inspect", snapshot: { engine, environment, environmentPermission }, createdAt: old });
    store.updateRun("old", { status: "succeeded", finishedAt: old });
    store.appendEvent({ runId: "old", sequence: 0, timestamp: old, type: "message", payload: { text: "large output", adapter: "fake" } });
    store.createRun({ id: "active", engineId: "codex", environmentId: "review", task: "keep", snapshot: { engine, environment, environmentPermission }, createdAt: old });
    store.updateRun("active", { status: "running", startedAt: old });
    store.appendEvent({ runId: "active", sequence: 0, timestamp: old, type: "tool_result", payload: { output: "keep this only in memory" } });

    expect(store.listEvents("old")[0]?.payload).toEqual({ adapter: "fake", outputSaved: false });
    expect(store.listEvents("active")[0]?.payload).toEqual({ outputSaved: false });
    expect(store.pruneExpired(30, new Date("2026-01-01T00:00:00.000Z"))).toMatchObject({ runs: 1, events: 1 });
    expect(store.getRun("old")).toBeUndefined();
    expect(store.getRun("active")?.status).toBe("running");
  });

  it("applies retentionDays when a database is opened", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-retention-open-"));
    directories.push(directory);
    const path = join(directory, "agentdock.db");
    const old = "2025-01-01T00:00:00.000Z";
    const first = new SqliteRunStore(path);
    first.createRun({ id: "expired", engineId: "codex", environmentId: "review", task: "old", snapshot: { engine, environment, environmentPermission }, createdAt: old });
    first.updateRun("expired", { status: "succeeded", finishedAt: old });
    first.close();
    const reopened = new SqliteRunStore(path, { retentionDays: 30 });
    databases.push(reopened);
    // The default clock is intentionally after the fixture's 2025 completion time.
    expect(reopened.getRun("expired")).toBeUndefined();
  });
});
