import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AdapterHealth, AdapterManifest, AdapterSessionReference, AdapterTaskRequest, AgentAdapter } from "../src/adapter-contract/index.js";
import { createAgentDockApiServer } from "../src/api/server.js";
import { validateConfig } from "../src/config/load.js";
import type { RunEvent, RuntimeDescriptor } from "../src/core/types.js";
import { RuntimeRegistry } from "../src/runtime/registry.js";
import { SqliteRunStore } from "../src/storage/sqlite-run-store.js";

class DelayedAdapter implements AgentAdapter {
  public readonly manifest: AdapterManifest = {
    name: "delayed",
    version: "0.1.0",
    entry: "./delayed-adapter.js",
    agentDockApi: "v1",
    runtime: { id: "fake" },
    capabilities: ["execute", "cancel", "create_session"],
    requiredPermissions: [],
  };

  public constructor(private readonly runtime: RuntimeDescriptor, private readonly delayMs: number, private readonly createSessionDelayMs = 0) {}

  public async healthCheck(): Promise<AdapterHealth> {
    return { healthy: true, runtime: this.runtime };
  }

  public async *execute(request: AdapterTaskRequest): AsyncIterable<RunEvent> {
    yield { runId: request.runId, sequence: 0, timestamp: new Date().toISOString(), type: "status", payload: { status: "running" } };
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.delayMs);
      request.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
    if (request.signal.aborted) {
      yield { runId: request.runId, sequence: 1, timestamp: new Date().toISOString(), type: "status", payload: { status: "cancelled" } };
      return;
    }
    yield { runId: request.runId, sequence: 1, timestamp: new Date().toISOString(), type: "message", payload: { text: request.task } };
    yield { runId: request.runId, sequence: 2, timestamp: new Date().toISOString(), type: "status", payload: { status: "succeeded", exitCode: 0 } };
  }

  public async cancel(): Promise<void> {}
  public async createSession(signal?: AbortSignal): Promise<AdapterSessionReference> {
    if (this.createSessionDelayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.createSessionDelayMs);
        const abort = (): void => {
          clearTimeout(timer);
          reject(new Error("session initialization aborted"));
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
    }
    return { supported: false };
  }
}

async function waitFor(check: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out while waiting for the expected API state.");
}

async function waitForAsync(check: () => Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out while waiting for the expected asynchronous API state.");
}

function createFixture(delayMs: number, createSessionDelayMs = 0) {
  const directory = mkdtempSync(join(tmpdir(), "agentdock-api-"));
  const store = new SqliteRunStore(join(directory, "agentdock.db"));
  const config = validateConfig({
    version: 1,
    dataDir: "data",
    engines: [{ id: "fake", adapter: "fake", capabilities: ["execute", "cancel"] }],
    environmentPermissions: [{ id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: [] }, network: "deny" }],
    environments: [{ id: "default", engineId: "fake", permissionId: "readonly", settings: {} }],
    projects: [{ id: "workspace", rootDir: process.cwd(), environmentIds: ["default"], defaultEnvironmentId: "default" }],
  });
  const registry = new RuntimeRegistry();
  registry.register("fake", (runtime) => new DelayedAdapter(runtime, delayMs, createSessionDelayMs));
  const token = "test-api-token-1234567890";
  const api = createAgentDockApiServer({ config, configPath: join(directory, "config.json"), store, registry, apiToken: token });
  return { api, directory, store, token };
}

function authHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${token}`, ...extra };
}

describe("AgentDock local API server", () => {
  it("submits, queries and streams a Run with a process-local idempotency key", async () => {
    const fixture = createFixture(30);
    try {
      const address = await fixture.api.listen();
      const baseUrl = `http://${address.host}:${address.port}/api/v1`;
      const ui = await fetch(`http://${address.host}:${address.port}/`);
      expect(ui.status).toBe(200);
      expect(ui.headers.get("content-type")).toContain("text/html");
      const uiHtml = await ui.text();
      expect(uiHtml).toContain("AgentDock Control Center");
      expect(uiHtml).toContain(".token-screen[hidden]");
      expect(uiHtml).toContain('data-locale="zh"');
      expect(uiHtml).toContain('data-locale="en"');
      expect(uiHtml).toContain("agentdock.locale");
      expect(uiHtml).toContain("集中查看 Agent Engine 状态与执行历史。");
      expect(uiHtml).toContain('data-view="configuration"');
      expect(uiHtml).not.toContain('data-view="engines"');
      expect(uiHtml).not.toContain('data-view="environments"');
      expect(uiHtml).toContain("entityNames = ['agents','engines','environments','projects','environmentPermissions']");
      expect(uiHtml).toContain("建议按顺序配置");
      expect(uiHtml).toContain("data-project-environment");
      expect(uiHtml).toContain("fields.environmentIdsHelp");
      expect((await fetch(`${baseUrl}/health`, { headers: authHeaders(fixture.token) })).status).toBe(200);
      const projects = await fetch(`${baseUrl}/projects`, { headers: authHeaders(fixture.token) });
      expect(projects.status).toBe(200);
      expect((await projects.json() as { projects: Array<{ id: string }> }).projects[0]?.id).toBe("workspace");
      const agents = await fetch(`${baseUrl}/agents`, { headers: authHeaders(fixture.token) });
      expect(agents.status).toBe(200);
      expect((await agents.json() as { agents: Array<{ id: string }> }).agents[0]?.id).toBe("default");
      const openapi = await fetch(`${baseUrl}/openapi.json`, { headers: authHeaders(fixture.token) });
      const openapiBody = await openapi.json() as { openapi: string; paths: Record<string, unknown> };
      expect(openapi.status).toBe(200);
      expect(openapiBody.openapi).toBe("3.0.3");
      expect(openapiBody.paths["/runs/{runId}/events"]).toBeDefined();
      expect(openapiBody.paths["/agents/{agentId}/invoke"]).toBeDefined();
      expect(openapiBody.paths["/projects/{projectId}/agents"]).toBeDefined();

      const created = await fetch(`${baseUrl}/runs`, {
        method: "POST",
        headers: authHeaders(fixture.token, { "content-type": "application/json", "idempotency-key": "request-1" }),
        body: JSON.stringify({ task: "inspect", projectId: "workspace" }),
      });
      const createdBody = await created.json() as { run: { id: string }; eventsUrl: string };
      expect(created.status, JSON.stringify(createdBody)).toBe(202);
      expect(createdBody.run).toMatchObject({ snapshot: { routing: { mode: "project_default", environmentId: "default", engineId: "fake" } } });

      await waitFor(() => fixture.store.getRun(createdBody.run.id)?.status === "succeeded");
      const retry = await fetch(`${baseUrl}/runs`, {
        method: "POST",
        headers: authHeaders(fixture.token, { "content-type": "application/json", "idempotency-key": "request-1" }),
        body: JSON.stringify({ task: "inspect", projectId: "workspace" }),
      });
      expect(retry.status).toBe(200);
      expect((await retry.json() as { run: { id: string }; created: boolean })).toMatchObject({ run: { id: createdBody.run.id }, created: false });

      const run = await fetch(`${baseUrl}/runs/${createdBody.run.id}`, { headers: authHeaders(fixture.token) });
      expect((await run.json() as { run: { status: string } }).run.status).toBe("succeeded");
      const sse = await fetch(`http://${address.host}:${address.port}${createdBody.eventsUrl}?after=0`, { headers: authHeaders(fixture.token, { accept: "text/event-stream" }) });
      expect(sse.headers.get("content-type")).toContain("text/event-stream");
      const stream = await sse.text();
      expect(stream).not.toContain("id: 0");
      expect(stream).toContain("id: 1");
      expect(stream).toContain("id: 3");
    } finally {
      await fixture.api.close();
      fixture.store.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("invokes an Agent through one SSE request and preserves the Run replay path", async () => {
    const fixture = createFixture(20);
    try {
      const address = await fixture.api.listen();
      const baseUrl = `http://${address.host}:${address.port}/api/v1`;
      const invoked = await fetch(`${baseUrl}/agents/default/invoke`, {
        method: "POST",
        headers: authHeaders(fixture.token, {
          "content-type": "application/json",
          accept: "text/event-stream",
          "idempotency-key": "agent-invocation-1",
        }),
        body: JSON.stringify({ task: "inspect", projectId: "workspace" }),
      });
      expect(invoked.status).toBe(200);
      expect(invoked.headers.get("content-type")).toContain("text/event-stream");
      const stream = await invoked.text();
      expect(stream).toContain("event: accepted");
      expect(stream).toContain('"created":true');
      expect(stream).toContain('"eventsUrl":"/api/v1/runs/');
      expect(stream).toContain("id: 0");
      expect(stream).toContain('"status":"succeeded"');
      expect(fixture.store.listSessions()[0]).toMatchObject({ agentId: "default", environmentId: "default" });

      const withoutSse = await fetch(`${baseUrl}/agents/default/invoke`, {
        method: "POST",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ task: "missing-stream", projectId: "workspace" }),
      });
      expect(withoutSse.status).toBe(406);
    } finally {
      await fixture.api.close();
      fixture.store.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("registers, updates and removes an Agent without editing the full configuration", async () => {
    const fixture = createFixture(10);
    try {
      const address = await fixture.api.listen();
      const baseUrl = `http://${address.host}:${address.port}/api/v1`;
      const current = await fetch(`${baseUrl}/config`, { headers: authHeaders(fixture.token) });
      const snapshot = await current.json() as { config: unknown; revision: string; hash: string };
      const agent = { id: "reviewer", engineId: "fake", environmentId: "default", permissionId: "readonly", enabled: true, processEnv: {}, settings: {} };
      const created = await fetch(`${baseUrl}/agents`, {
        method: "POST",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ agent, revision: snapshot.revision, hash: snapshot.hash }),
      });
      expect(created.status).toBe(201);
      expect((await created.json() as { agent: { id: string } }).agent.id).toBe("reviewer");
      const listed = await fetch(`${baseUrl}/agents`, { headers: authHeaders(fixture.token) });
      expect((await listed.json() as { agents: Array<{ id: string }> }).agents.map((item) => item.id)).toContain("reviewer");

      const afterCreate = await fetch(`${baseUrl}/config`, { headers: authHeaders(fixture.token) });
      const afterCreateBody = await afterCreate.json() as { revision: string; hash: string };
      const updated = await fetch(`${baseUrl}/agents/reviewer`, {
        method: "PUT",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ agent: { ...agent, settings: { mode: "review" } }, revision: afterCreateBody.revision, hash: afterCreateBody.hash }),
      });
      expect(updated.status).toBe(200);

      const afterUpdate = await fetch(`${baseUrl}/config`, { headers: authHeaders(fixture.token) });
      const afterUpdateBody = await afterUpdate.json() as { revision: string; hash: string };
      const bound = await fetch(`${baseUrl}/projects/workspace/agents`, {
        method: "PUT",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ agentIds: ["reviewer"], defaultAgentId: "reviewer", revision: afterUpdateBody.revision, hash: afterUpdateBody.hash }),
      });
      expect(bound.status).toBe(200);
      expect((await bound.json() as { project: { agentIds: string[]; defaultAgentId: string } }).project).toMatchObject({ agentIds: ["reviewer"], defaultAgentId: "reviewer" });

      const afterBinding = await fetch(`${baseUrl}/config`, { headers: authHeaders(fixture.token) });
      const afterBindingBody = await afterBinding.json() as { revision: string; hash: string };
      const removed = await fetch(`${baseUrl}/agents/reviewer`, {
        method: "DELETE",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ revision: afterBindingBody.revision, hash: afterBindingBody.hash }),
      });
      expect(removed.status).toBe(200);
      expect((await fetch(`${baseUrl}/agents/reviewer`, { headers: authHeaders(fixture.token) })).status).toBe(404);
    } finally {
      await fixture.api.close();
      fixture.store.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("previews and saves configuration atomically with conflict and risk checks", async () => {
    const fixture = createFixture(10);
    try {
      const address = await fixture.api.listen();
      const baseUrl = `http://${address.host}:${address.port}/api/v1`;
      const snapshotResponse = await fetch(`${baseUrl}/config`, { headers: authHeaders(fixture.token) });
      const snapshot = await snapshotResponse.json() as { config: Record<string, unknown>; revision: string; hash: string };
      expect(snapshotResponse.status).toBe(200);

      const runResponse = await fetch(`${baseUrl}/runs`, {
        method: "POST",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ task: "before-config-save", projectId: "workspace" }),
      });
      const runBody = await runResponse.json() as { run: { id: string; snapshot: unknown } };
      await waitFor(() => fixture.store.getRun(runBody.run.id)?.status === "succeeded");

      const candidate = structuredClone(snapshot.config) as { engines: Array<Record<string, unknown>> };
      candidate.engines[0] = { ...candidate.engines[0], version: "1.0.1" };
      const preview = await fetch(`${baseUrl}/config/preview`, {
        method: "POST",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ config: candidate, dryRun: { task: "configuration-preview", projectId: "workspace" } }),
      });
      const previewBody = await preview.json() as { valid: boolean; diff: Array<{ path: string }>; dryRun: { executes: boolean } };
      expect(preview.status).toBe(200);
      expect(previewBody).toMatchObject({ valid: true, dryRun: { executes: false } });
      expect(previewBody.diff.some((entry) => entry.path === "engines[0].version")).toBe(true);

      const plaintextSecret = structuredClone(candidate) as { environments: Array<Record<string, unknown>> };
      plaintextSecret.environments[0] = { ...plaintextSecret.environments[0], settings: { accessToken: "never-store-this" } };
      const secretResponse = await fetch(`${baseUrl}/config/preview`, {
        method: "POST",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ config: plaintextSecret }),
      });
      const secretBody = await secretResponse.json() as { error: { code: string; details: { issues: Array<{ path: string }> } } };
      expect(secretResponse.status).toBe(422);
      expect(secretBody.error).toMatchObject({ code: "CONFIG_VALIDATION_FAILED", details: { issues: [{ path: "environments[0].settings.accessToken" }] } });
      expect(JSON.stringify(secretBody)).not.toContain("never-store-this");

      const saved = await fetch(`${baseUrl}/config`, {
        method: "PUT",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ config: candidate, revision: snapshot.revision, hash: snapshot.hash }),
      });
      const savedBody = await saved.json() as { restartRequired: boolean; backupId: string; auditId: string; revision: string };
      expect(saved.status, JSON.stringify(savedBody)).toBe(200);
      expect(savedBody).toMatchObject({ restartRequired: false });
      expect(savedBody.backupId).toContain("config.json.backup.");
      expect(savedBody.auditId).toEqual(expect.any(String));
      expect(JSON.parse(readFileSync(join(fixture.directory, "config.json"), "utf8"))).toMatchObject({ engines: [{ version: "1.0.1" }] });
      expect(fixture.store.getRun(runBody.run.id)?.snapshot).toEqual(runBody.run.snapshot);

      const afterSaveRun = await fetch(`${baseUrl}/runs`, {
        method: "POST",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ task: "after-config-save", projectId: "workspace" }),
      });
      const afterSaveRunBody = await afterSaveRun.json() as { run: { id: string } };
      expect(afterSaveRun.status).toBe(202);
      await waitFor(() => fixture.store.getRun(afterSaveRunBody.run.id)?.status === "succeeded");
      expect((fixture.store.getRun(afterSaveRunBody.run.id)?.snapshot as { engine?: { version?: string } }).engine?.version).toBe("1.0.1");

      const conflict = await fetch(`${baseUrl}/config`, {
        method: "PUT",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ config: snapshot.config, revision: snapshot.revision, hash: snapshot.hash }),
      });
      const conflictBody = await conflict.json() as { error: { code: string } };
      expect(conflict.status).toBe(409);
      expect(conflictBody.error.code).toBe("CONFIG_CONFLICT");

      const risky = structuredClone(candidate) as { environmentPermissions: Array<Record<string, unknown>> };
      risky.environmentPermissions[0] = { ...risky.environmentPermissions[0], filesystem: { roots: ["."], write: true } };
      const riskyPreview = await fetch(`${baseUrl}/config/preview`, {
        method: "POST",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ config: risky }),
      });
      const riskyPreviewBody = await riskyPreview.json() as { valid: boolean; highRisk: { required: boolean } };
      expect(riskyPreviewBody).toMatchObject({ valid: true, highRisk: { required: true } });
      const denied = await fetch(`${baseUrl}/config`, {
        method: "PUT",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ config: risky, revision: savedBody.revision, hash: savedBody.revision }),
      });
      expect(denied.status).toBe(409);
      expect((await denied.json() as { error: { code: string } }).error.code).toBe("CONFIG_CONFIRMATION_REQUIRED");

      const backups = await fetch(`${baseUrl}/config/backups`, { headers: authHeaders(fixture.token) });
      const backupBody = await backups.json() as { backups: Array<{ id: string }> };
      expect(backups.status).toBe(200);
      expect(backupBody.backups.some((backup) => backup.id === savedBody.backupId)).toBe(true);
      const restored = await fetch(`${baseUrl}/config/restore`, {
        method: "POST",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ backupId: savedBody.backupId, revision: savedBody.revision, hash: savedBody.revision, confirmHighRisk: true }),
      });
      expect(restored.status).toBe(200);
      expect(JSON.parse(readFileSync(join(fixture.directory, "config.json"), "utf8"))).toMatchObject({ engines: [{ args: [] }] });
    } finally {
      await fixture.api.close();
      fixture.store.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("hot reloads a valid external config change and keeps the previous runtime on invalid input", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-api-hot-reload-"));
    const configPath = join(directory, "config.json");
    const config = validateConfig({
      version: 1,
      dataDir: "data",
      engines: [{ id: "fake", adapter: "fake", capabilities: ["execute", "cancel"] }],
      environmentPermissions: [{ id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: [] }, network: "deny" }],
      environments: [{ id: "default", engineId: "fake", permissionId: "readonly", settings: {} }],
      projects: [{ id: "workspace", rootDir: process.cwd(), environmentIds: ["default"], defaultEnvironmentId: "default" }],
    });
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    const store = new SqliteRunStore(join(directory, "data", "agentdock.db"));
    const registry = new RuntimeRegistry();
    registry.register("fake", (runtime) => new DelayedAdapter(runtime, 10));
    const api = createAgentDockApiServer({ config, configPath, store, registry, apiToken: "hot-reload-api-token-1234567890", configWatchDebounceMs: 20 });
    try {
      const address = await api.listen();
      const baseUrl = `http://${address.host}:${address.port}/api/v1`;
      const changed = validateConfig({
        ...config,
        environments: [...config.environments, { id: "alternate", engineId: "fake", permissionId: "readonly", settings: {} }],
        projects: [{ ...config.projects[0]!, environmentIds: ["default", "alternate"] }],
      });
      writeFileSync(configPath, JSON.stringify(changed, null, 2));
      await waitForAsync(async () => {
        const response = await fetch(`${baseUrl}/environments`, { headers: authHeaders("hot-reload-api-token-1234567890") });
        const body = await response.json() as { environments: Array<{ environment: { id: string } }> };
        return response.status === 200 && body.environments.some((item) => item.environment.id === "alternate");
      });

      const runResponse = await fetch(`${baseUrl}/runs`, {
        method: "POST",
        headers: authHeaders("hot-reload-api-token-1234567890", { "content-type": "application/json" }),
        body: JSON.stringify({ task: "hot reload", projectId: "workspace", environmentId: "alternate" }),
      });
      const runBody = await runResponse.json() as { run: { id: string } };
      expect(runResponse.status).toBe(202);
      await waitFor(() => store.getRun(runBody.run.id)?.status === "succeeded");
      expect(store.getRun(runBody.run.id)?.environmentId).toBe("alternate");

      writeFileSync(configPath, "{ invalid json");
      await new Promise((resolve) => setTimeout(resolve, 100));
      const afterInvalid = await fetch(`${baseUrl}/environments`, { headers: authHeaders("hot-reload-api-token-1234567890") });
      const afterInvalidBody = await afterInvalid.json() as { environments: Array<{ environment: { id: string } }> };
      expect(afterInvalidBody.environments.some((item) => item.environment.id === "alternate")).toBe(true);
    } finally {
      await api.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reuses a persisted idempotency key from a new API server instance", async () => {
    const fixture = createFixture(10);
    try {
      const address = await fixture.api.listen();
      const baseUrl = `http://${address.host}:${address.port}/api/v1`;
      const created = await fetch(`${baseUrl}/runs`, {
        method: "POST",
        headers: authHeaders(fixture.token, { "content-type": "application/json", "idempotency-key": "restart-request" }),
        body: JSON.stringify({ task: "persist", projectId: "workspace" }),
      });
      const body = await created.json() as { run: { id: string } };
      await waitFor(() => fixture.store.getRun(body.run.id)?.status === "succeeded");
      await fixture.api.close();
      fixture.store.close();

      const reopenedStore = new SqliteRunStore(join(fixture.directory, "agentdock.db"));
      const registry = new RuntimeRegistry();
      registry.register("fake", (runtime) => new DelayedAdapter(runtime, 10));
      const reopenedApi = createAgentDockApiServer({
        config: validateConfig({
          version: 1,
          dataDir: "data",
          engines: [{ id: "fake", adapter: "fake", capabilities: ["execute", "cancel"] }],
          environmentPermissions: [{ id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: [] }, network: "deny" }],
          environments: [{ id: "default", engineId: "fake", permissionId: "readonly", settings: {} }],
          projects: [{ id: "workspace", rootDir: process.cwd(), environmentIds: ["default"], defaultEnvironmentId: "default" }],
        }),
        configPath: join(fixture.directory, "config.json"),
        store: reopenedStore,
        registry,
        apiToken: fixture.token,
      });
      try {
        const reopenedAddress = await reopenedApi.listen();
        const retry = await fetch(`http://${reopenedAddress.host}:${reopenedAddress.port}/api/v1/runs`, {
          method: "POST",
          headers: authHeaders(fixture.token, { "content-type": "application/json", "idempotency-key": "restart-request" }),
          body: JSON.stringify({ task: "persist", projectId: "workspace" }),
        });
        expect(retry.status).toBe(200);
        expect((await retry.json() as { run: { id: string }; created: boolean })).toMatchObject({ run: { id: body.run.id }, created: false });
      } finally {
        await reopenedApi.close();
        reopenedStore.close();
      }
    } finally {
      try { await fixture.api.close(); } catch { /* Already closed in the successful path. */ }
      try { fixture.store.close(); } catch { /* Already closed in the successful path. */ }
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("cancels an active Run without exposing a remote listener", async () => {
    const fixture = createFixture(500);
    try {
      const address = await fixture.api.listen();
      expect(address.host).toBe("127.0.0.1");
      const baseUrl = `http://${address.host}:${address.port}/api/v1`;
      const created = await fetch(`${baseUrl}/runs`, {
        method: "POST",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ task: "wait", projectId: "workspace" }),
      });
      const body = await created.json() as { run: { id: string } };
      expect(created.status, JSON.stringify(body)).toBe(202);
      const cancelled = await fetch(`${baseUrl}/runs/${body.run.id}/cancel`, { method: "POST", headers: authHeaders(fixture.token) });
      expect(cancelled.status).toBe(202);
      await waitFor(() => fixture.store.getRun(body.run.id)?.status === "cancelled");
      expect(fixture.store.getRun(body.run.id)?.status).toBe("cancelled");
    } finally {
      await fixture.api.close();
      fixture.store.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("cancels a Run during Session initialization and makes close idempotent", async () => {
    const fixture = createFixture(10, 500);
    try {
      const address = await fixture.api.listen();
      const request = fetch(`http://${address.host}:${address.port}/api/v1/runs`, {
        method: "POST",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ task: "initializing", projectId: "workspace" }),
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      await Promise.all([fixture.api.close(), fixture.api.close()]);
      const response = await request;
      expect(response.status).toBe(500);
      expect(fixture.store.listRuns()).toEqual([]);
    } finally {
      try { await fixture.api.close(); } catch { /* Already closed in the successful path. */ }
      fixture.store.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("requires Bearer authentication without echoing the token", async () => {
    const fixture = createFixture(10);
    try {
      const address = await fixture.api.listen();
      const response = await fetch(`http://${address.host}:${address.port}/api/v1/health`, {
        headers: { authorization: "Bearer wrong-token-that-is-not-valid" },
      });
      const body = await response.text();
      expect(response.status).toBe(401);
      expect(body).not.toContain("wrong-token-that-is-not-valid");
      expect(body).not.toContain(fixture.token);
    } finally {
      await fixture.api.close();
      fixture.store.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("creates and reuses the default local token file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-token-"));
    const databasePath = join(directory, "data", "agentdock.db");
    const config = validateConfig({ version: 1, dataDir: "data", engines: [], environments: [], projects: [], environmentPermissions: [] });
    const tokenPath = join(directory, "data", "api-token");
    const firstStore = new SqliteRunStore(databasePath);
    const firstApi = createAgentDockApiServer({ config, configPath: join(directory, "config.json"), store: firstStore });
    try {
      const address = await firstApi.listen();
      const token = readFileSync(tokenPath, "utf8").trim();
      expect(token.length).toBeGreaterThanOrEqual(43);
      expect((await fetch(`http://${address.host}:${address.port}/api/v1/health`, { headers: authHeaders(token) })).status).toBe(200);
      await firstApi.close();
      firstStore.close();

      const secondStore = new SqliteRunStore(databasePath);
      const secondApi = createAgentDockApiServer({ config, configPath: join(directory, "config.json"), store: secondStore });
      try {
        const secondAddress = await secondApi.listen();
        expect((await fetch(`http://${secondAddress.host}:${secondAddress.port}/api/v1/health`, { headers: authHeaders(token) })).status).toBe(200);
      } finally {
        await secondApi.close();
        secondStore.close();
      }
    } finally {
      try { await firstApi.close(); } catch { /* Already closed in the successful path. */ }
      try { firstStore.close(); } catch { /* Already closed in the successful path. */ }
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("redacts the API token from Run responses and events", async () => {
    const fixture = createFixture(10);
    try {
      const address = await fixture.api.listen();
      const baseUrl = `http://${address.host}:${address.port}/api/v1`;
      const response = await fetch(`${baseUrl}/runs`, {
        method: "POST",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ task: `echo ${fixture.token}`, projectId: "workspace" }),
      });
      expect(response.status).toBe(202);
      const body = await response.json() as { run: { id: string; task: string } };
      expect(body.run.task).not.toContain(fixture.token);
      await waitFor(() => fixture.store.getRun(body.run.id)?.status === "succeeded");
      const events = await fetch(`${baseUrl}/runs/${body.run.id}/events`, { headers: authHeaders(fixture.token) });
      expect(await events.text()).not.toContain(fixture.token);
    } finally {
      await fixture.api.close();
      fixture.store.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("releases an HTTP request slot when an SSE client closes", async () => {
    const fixture = createFixture(500);
    const limitedApi = createAgentDockApiServer({
      config: validateConfig({
        version: 1,
        dataDir: "data",
        engines: [{ id: "fake", adapter: "fake", capabilities: ["execute", "cancel"] }],
        environmentPermissions: [{ id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: [] }, network: "deny" }],
        environments: [{ id: "default", engineId: "fake", permissionId: "readonly", settings: {} }],
        projects: [{ id: "workspace", rootDir: process.cwd(), environmentIds: ["default"], defaultEnvironmentId: "default" }],
      }),
      configPath: join(fixture.directory, "config.json"),
      store: fixture.store,
      registry: (() => {
        const registry = new RuntimeRegistry();
        registry.register("fake", (runtime) => new DelayedAdapter(runtime, 500));
        return registry;
      })(),
      apiToken: fixture.token,
      maxConcurrentRequests: 1,
    });
    try {
      const address = await limitedApi.listen();
      const baseUrl = `http://${address.host}:${address.port}/api/v1`;
      const created = await fetch(`${baseUrl}/runs`, {
        method: "POST",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ task: "stream", projectId: "workspace" }),
      });
      const body = await created.json() as { run: { id: string } };
      const stream = await fetch(`${baseUrl}/runs/${body.run.id}/events?stream=sse`, { headers: authHeaders(fixture.token) });
      expect(stream.status).toBe(200);
      await stream.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect((await fetch(`${baseUrl}/health`, { headers: authHeaders(fixture.token) })).status).toBe(200);
    } finally {
      await limitedApi.close();
      await fixture.api.close();
      fixture.store.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("enforces request body and Run concurrency limits", async () => {
    const fixture = createFixture(200);
    const limitedApi = createAgentDockApiServer({
      config: validateConfig({
        version: 1,
        dataDir: "data",
        engines: [{ id: "fake", adapter: "fake", capabilities: ["execute", "cancel"] }],
        environmentPermissions: [{ id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: [] }, network: "deny" }],
        environments: [{ id: "default", engineId: "fake", permissionId: "readonly", settings: {} }],
        projects: [{ id: "workspace", rootDir: process.cwd(), environmentIds: ["default"], defaultEnvironmentId: "default" }],
      }),
      configPath: join(fixture.directory, "config.json"),
      store: fixture.store,
      registry: (() => {
        const registry = new RuntimeRegistry();
        registry.register("fake", (runtime) => new DelayedAdapter(runtime, 200));
        return registry;
      })(),
      apiToken: fixture.token,
      maxRequestBodyBytes: 64,
      maxConcurrentRuns: 1,
    });
    try {
      const address = await limitedApi.listen();
      const baseUrl = `http://${address.host}:${address.port}/api/v1`;
      const first = await fetch(`${baseUrl}/runs`, {
        method: "POST",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ task: "first", projectId: "workspace" }),
      });
      expect(first.status).toBe(202);
      const second = await fetch(`${baseUrl}/runs`, {
        method: "POST",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ task: "second", projectId: "workspace" }),
      });
      expect(second.status).toBe(429);
      const oversized = await fetch(`${baseUrl}/runs`, {
        method: "POST",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ task: "x".repeat(100), projectId: "workspace" }),
      });
      expect(oversized.status).toBe(413);
    } finally {
      await limitedApi.close();
      await fixture.api.close();
      fixture.store.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("returns an explainable route conflict when automatic routing is ambiguous", async () => {
    const fixture = createFixture(10);
    const ambiguousConfig = validateConfig({
      version: 1,
      dataDir: "data",
      engines: [
        { id: "fake", adapter: "fake", capabilities: ["execute", "cancel"] },
        { id: "other", adapter: "fake", capabilities: ["execute", "cancel"] },
      ],
      environmentPermissions: [{ id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: [] }, network: "deny" }],
      environments: [
        { id: "default", engineId: "fake", permissionId: "readonly", settings: {} },
        { id: "other-profile", engineId: "other", permissionId: "readonly", settings: {} },
      ],
      projects: [],
    });
    const api = createAgentDockApiServer({ config: ambiguousConfig, configPath: join(fixture.directory, "config.json"), store: fixture.store, apiToken: fixture.token });
    try {
      const address = await api.listen();
      const response = await fetch(`http://${address.host}:${address.port}/api/v1/runs`, {
        method: "POST",
        headers: authHeaders(fixture.token, { "content-type": "application/json" }),
        body: JSON.stringify({ task: "ambiguous" }),
      });
      const body = await response.json() as { error: { code: string; message: string } };
      expect(response.status).toBe(409);
      expect(body.error).toMatchObject({ code: "AMBIGUOUS_ROUTE" });
      expect(body.error.message).toContain("other-profile");
    } finally {
      await api.close();
      await fixture.api.close();
      fixture.store.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });
});
