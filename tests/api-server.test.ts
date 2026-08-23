import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

function createFixture(delayMs: number, createSessionDelayMs = 0) {
  const directory = mkdtempSync(join(tmpdir(), "agentdock-api-"));
  const store = new SqliteRunStore(join(directory, "agentdock.db"));
  const config = validateConfig({
    version: 1,
    dataDir: "data",
    runtimes: [{ id: "fake", adapter: "fake", capabilities: ["execute", "cancel"] }],
    policies: [{ id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: [] }, network: "deny" }],
    profiles: [{ id: "default", runtimeId: "fake", policyId: "readonly", settings: {} }],
    projects: [{ id: "workspace", rootDir: process.cwd(), profileIds: ["default"], defaultProfileId: "default" }],
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
      expect((await fetch(`${baseUrl}/health`, { headers: authHeaders(fixture.token) })).status).toBe(200);
      const openapi = await fetch(`${baseUrl}/openapi.json`, { headers: authHeaders(fixture.token) });
      const openapiBody = await openapi.json() as { openapi: string; paths: Record<string, unknown> };
      expect(openapi.status).toBe(200);
      expect(openapiBody.openapi).toBe("3.0.3");
      expect(openapiBody.paths["/runs/{runId}/events"]).toBeDefined();

      const created = await fetch(`${baseUrl}/runs`, {
        method: "POST",
        headers: authHeaders(fixture.token, { "content-type": "application/json", "idempotency-key": "request-1" }),
        body: JSON.stringify({ task: "inspect", projectId: "workspace" }),
      });
      const createdBody = await created.json() as { run: { id: string }; eventsUrl: string };
      expect(created.status, JSON.stringify(createdBody)).toBe(202);
      expect(createdBody.run).toMatchObject({ snapshot: { routing: { mode: "project_default", profileId: "default", runtimeId: "fake" } } });

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
          runtimes: [{ id: "fake", adapter: "fake", capabilities: ["execute", "cancel"] }],
          policies: [{ id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: [] }, network: "deny" }],
          profiles: [{ id: "default", runtimeId: "fake", policyId: "readonly", settings: {} }],
          projects: [{ id: "workspace", rootDir: process.cwd(), profileIds: ["default"], defaultProfileId: "default" }],
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
    const config = validateConfig({ version: 1, dataDir: "data", runtimes: [], profiles: [], projects: [], policies: [] });
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
        runtimes: [{ id: "fake", adapter: "fake", capabilities: ["execute", "cancel"] }],
        policies: [{ id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: [] }, network: "deny" }],
        profiles: [{ id: "default", runtimeId: "fake", policyId: "readonly", settings: {} }],
        projects: [{ id: "workspace", rootDir: process.cwd(), profileIds: ["default"], defaultProfileId: "default" }],
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
        runtimes: [{ id: "fake", adapter: "fake", capabilities: ["execute", "cancel"] }],
        policies: [{ id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: [] }, network: "deny" }],
        profiles: [{ id: "default", runtimeId: "fake", policyId: "readonly", settings: {} }],
        projects: [{ id: "workspace", rootDir: process.cwd(), profileIds: ["default"], defaultProfileId: "default" }],
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
      runtimes: [
        { id: "fake", adapter: "fake", capabilities: ["execute", "cancel"] },
        { id: "other", adapter: "fake", capabilities: ["execute", "cancel"] },
      ],
      policies: [{ id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: [] }, network: "deny" }],
      profiles: [
        { id: "default", runtimeId: "fake", policyId: "readonly", settings: {} },
        { id: "other-profile", runtimeId: "other", policyId: "readonly", settings: {} },
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
