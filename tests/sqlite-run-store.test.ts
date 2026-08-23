import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Policy, Profile, Project, RuntimeDescriptor } from "../src/core/types.js";
import { SqliteRunStore } from "../src/storage/sqlite-run-store.js";

const runtime: RuntimeDescriptor = {
  id: "codex",
  adapter: "codex",
  binary: "codex",
  args: [],
  enabled: true,
  capabilities: ["execute"],
};
const profile: Profile = { id: "review", runtimeId: "codex", policyId: "readonly", settings: { sandbox: "read-only" } };
const policy: Policy = { id: "readonly", filesystem: { roots: ["."] , write: false }, environment: { allow: ["PATH"] }, network: "deny" };
const project: Project = { id: "app", rootDir: "C:/workspace", profileIds: ["review"], defaultProfileId: "review" };

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
    store.createSession({ id: "ses-1", projectId: "app", runtimeId: "codex", resumable: false });
    store.createRun({
      id: "run-1",
      runtimeId: "codex",
      profileId: "review",
      projectId: "app",
      sessionId: "ses-1",
      task: "inspect",
      snapshot: { runtime, profile, policy, project },
    });
    store.appendEvent({ runId: "run-1", sequence: 0, timestamp: "2026-08-22T00:00:00.000Z", type: "status", payload: { status: "running" } });
    store.appendEvent({ runId: "run-1", sequence: 1, timestamp: "2026-08-22T00:00:01.000Z", type: "status", payload: { status: "succeeded", exitCode: 0 } });
    store.updateRun("run-1", { status: "succeeded", exitCode: 0, finishedAt: "2026-08-22T00:00:01.000Z" });

    expect(store.getSession("ses-1")?.runtimeId).toBe("codex");
    expect(store.getRun("run-1")).toMatchObject({ id: "run-1", status: "succeeded", snapshot: { policy: { network: "deny" } } });
    expect(store.listEvents("run-1").map((event) => event.sequence)).toEqual([0, 1]);
  });

  it("marks non-active runs as failed after a restart", () => {
    const store = createStore();
    store.createRun({ id: "orphan", runtimeId: "codex", profileId: "review", task: "inspect", snapshot: { runtime, profile, policy } });
    store.updateRun("orphan", { status: "running", startedAt: new Date().toISOString() });
    const recovered = store.recoverStaleRuns();
    expect(recovered[0]).toMatchObject({ id: "orphan", status: "failed", errorCode: "PROCESS_NOT_ACTIVE_AFTER_RESTART" });
    expect(store.listEvents("orphan")[0]?.payload).toMatchObject({ status: "failed" });
  });

  it("does not recover a Run owned by a live AgentDock process", () => {
    const store = createStore();
    store.createRun({ id: "live", runtimeId: "codex", profileId: "review", task: "inspect", snapshot: { runtime, profile, policy }, ownerPid: process.pid });
    store.updateRun("live", { status: "running", startedAt: new Date().toISOString() });
    expect(store.recoverStaleRuns()).toEqual([]);
    expect(store.getRun("live")?.status).toBe("running");
  });

  it("keeps idempotency reservations in SQLite across store reopen", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-idempotency-"));
    directories.push(directory);
    const path = join(directory, "agentdock.db");
    const first = new SqliteRunStore(path);
    first.createRun({ id: "run-1", runtimeId: "codex", profileId: "review", task: "inspect", snapshot: { runtime, profile, policy } });
    expect(first.reserveIdempotencyKey("request-1", "hash-1", "run-1")).toEqual({ status: "created" });
    first.close();

    const reopened = new SqliteRunStore(path);
    databases.push(reopened);
    expect(reopened.reserveIdempotencyKey("request-1", "hash-1", "run-2")).toEqual({ status: "existing", runId: "run-1" });
    expect(reopened.reserveIdempotencyKey("request-1", "different", "run-3")).toEqual({ status: "conflict" });
  });
});
