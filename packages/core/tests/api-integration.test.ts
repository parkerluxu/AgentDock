import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { AdapterHealth, AdapterManifest, AdapterTaskRequest, AgentAdapter } from "../src/adapter-contract/index.js";
import { createAgentDockApiServer } from "../src/api/server.js";
import { validateConfig } from "../src/config/load.js";
import type { RunEvent, RuntimeDescriptor } from "../src/core/types.js";
import { createBuiltinRuntimeRegistry, createConfiguredRuntimeRegistry, RuntimeRegistry } from "../src/runtime/registry.js";
import { ProcessRunner, type ProcessExecution, type ProcessOutput, type ProcessRequest } from "../src/runtime/process-runner.js";
import { LocalAdapterStore, localAdapterDirectory } from "../src/runtime/local-adapters.js";
import { SqliteRunStore } from "../src/storage/sqlite-run-store.js";
import { EnvironmentDirectoryManager } from "../src/environment/manager.js";

const token = "api-integration-token-1234567890";
const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

class ScriptedProcessRunner extends ProcessRunner {
  public readonly requests: ProcessRequest[] = [];

  public override execute(request: ProcessRequest): ProcessExecution {
    this.requests.push({ ...request, args: [...request.args] });
    const isClaude = request.command === "claude";
    const output: ProcessOutput[] = request.args.includes("--version")
      ? [{ type: "stdout", data: isClaude ? "2.1.201\n" : "0.147.0\n" }, { type: "exit", code: 0 }]
      : [
        { type: "stdout", data: '{"type":"status","status":"succeeded","exitCode":0}\n' },
        { type: "exit", code: 0 },
      ];
    return {
      pid: undefined,
      output: (async function* (): AsyncIterable<ProcessOutput> {
        for (const item of output) yield item;
      })(),
      cancel: async () => undefined,
    };
  }
}

class CrashAdapter implements AgentAdapter {
  public readonly manifest: AdapterManifest = {
    name: "crash",
    version: "0.1.0",
    entry: "./crash-adapter.js",
    agentDockApi: "v1",
    runtime: { id: "crash", versionRange: "*" },
    capabilities: ["execute", "cancel", "healthcheck"],
    requiredPermissions: [],
  };

  public constructor(private readonly runtime: RuntimeDescriptor) {}

  public async healthCheck(): Promise<AdapterHealth> {
    return { healthy: true, runtime: this.runtime };
  }

  public async *execute(request: AdapterTaskRequest): AsyncIterable<RunEvent> {
    yield { runId: request.runId, sequence: 0, timestamp: new Date().toISOString(), type: "status", payload: { status: "running" } };
    throw new Error("simulated adapter crash");
  }

  public async cancel(): Promise<void> {}
}

class CancellableAdapter implements AgentAdapter {
  public readonly manifest: AdapterManifest = {
    name: "cancellable",
    version: "0.1.0",
    entry: "./cancellable-adapter.js",
    agentDockApi: "v1",
    runtime: { id: "cancellable", versionRange: "*" },
    capabilities: ["execute", "cancel", "healthcheck"],
    requiredPermissions: [],
  };

  public constructor(private readonly runtime: RuntimeDescriptor) {}

  public async healthCheck(): Promise<AdapterHealth> {
    return { healthy: true, runtime: this.runtime };
  }

  public async *execute(request: AdapterTaskRequest): AsyncIterable<RunEvent> {
    yield { runId: request.runId, sequence: 0, timestamp: new Date().toISOString(), type: "status", payload: { status: "running" } };
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      request.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
    yield { runId: request.runId, sequence: 1, timestamp: new Date().toISOString(), type: "status", payload: { status: request.signal.aborted ? "cancelled" : "succeeded" } };
  }

  public async cancel(): Promise<void> {}
}

class MutatingEnvironmentAdapter implements AgentAdapter {
  public readonly manifest: AdapterManifest = {
    name: "mutating-environment",
    version: "0.1.0",
    entry: "./mutating-environment-adapter.js",
    agentDockApi: "v1",
    runtime: { id: "mutating-environment", versionRange: "*" },
    capabilities: ["execute", "cancel", "healthcheck"],
    requiredPermissions: [],
  };

  public constructor(private readonly runtime: RuntimeDescriptor) {}

  public async healthCheck(): Promise<AdapterHealth> {
    return { healthy: true, runtime: this.runtime };
  }

  public async *execute(request: AdapterTaskRequest): AsyncIterable<RunEvent> {
    const configDir = request.environment.AGENTDOCK_CONFIG_DIR;
    if (!configDir) throw new Error("AGENTDOCK_CONFIG_DIR was not provided.");
    writeFileSync(join(configDir, "runtime-state.json"), `${Date.now()}\n`);
    yield { runId: request.runId, sequence: 0, timestamp: new Date().toISOString(), type: "status", payload: { status: "running" } };
    yield { runId: request.runId, sequence: 1, timestamp: new Date().toISOString(), type: "status", payload: { status: "succeeded" } };
  }

  public async cancel(): Promise<void> {}
}

function configFor(engineId: string, adapter: string, capabilities: RuntimeDescriptor["capabilities"] = ["execute", "cancel"]): ReturnType<typeof validateConfig> {
  return validateConfig({
    version: 1,
    dataDir: "data",
    engines: [{ id: engineId, adapter, capabilities }],
    environmentPermissions: [{ id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: [] }, network: "deny" }],
    environments: [{ id: "default", engineId, permissionId: "readonly", settings: {} }],
    projects: [{ id: "workspace", rootDir: process.cwd(), environmentIds: ["default"], defaultEnvironmentId: "default" }],
  });
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${token}`, ...extra };
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

function isTerminal(status: string | undefined): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "timed_out";
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, marker: string): Promise<string> {
  const decoder = new TextDecoder();
  let output = "";
  while (!output.includes(marker)) {
    const next = await reader.read();
    if (next.done) break;
    output += decoder.decode(next.value, { stream: true });
  }
  return output;
}

function createConfigFile(directory: string, config: ReturnType<typeof validateConfig>): string {
  const configPath = join(directory, "config.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

function runIdFromBody(body: unknown): string {
  const run = (body as { run?: { id?: unknown } }).run;
  if (!run || typeof run.id !== "string") throw new Error("API response did not contain a Run id.");
  return run.id;
}

describe("AgentDock API and Adapter integration", () => {
  it("executes both built-in CLI Adapters through the HTTP API with a scripted runner", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-api-builtins-"));
    const store = new SqliteRunStore(join(directory, "agentdock.db"));
    const config = validateConfig({
      version: 1,
      dataDir: "data",
      engines: [
        { id: "claude-code", adapter: "claude-code", binary: "claude", capabilities: ["execute", "stream_events", "cancel", "create_session", "resume_session", "healthcheck"] },
        { id: "codex", adapter: "codex", binary: "codex", capabilities: ["execute", "stream_events", "cancel", "resume_session", "healthcheck"] },
      ],
      environmentPermissions: [{ id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: [] }, network: "deny" }],
      environments: [
        { id: "claude", engineId: "claude-code", permissionId: "readonly", settings: { outputFormat: "stream-json" } },
        { id: "codex", engineId: "codex", permissionId: "readonly", settings: { skipGitRepoCheck: true } },
      ],
      projects: [{ id: "workspace", rootDir: process.cwd(), environmentIds: ["claude", "codex"], defaultEnvironmentId: "claude" }],
    });
    const runner = new ScriptedProcessRunner();
    const api = createAgentDockApiServer({ config, configPath: join(directory, "config.json"), store, registry: createBuiltinRuntimeRegistry(runner), apiToken: token });
    try {
      const address = await api.listen();
      const url = `http://${address.host}:${address.port}/api/v1/runs`;
      for (const [environmentId, task] of [["claude", "claude integration"], ["codex", "codex integration"]] as const) {
        const response = await fetch(url, {
          method: "POST",
          headers: authHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({ task, projectId: "workspace", environmentId }),
        });
        expect(response.status).toBe(202);
        const runId = runIdFromBody(await response.json());
        await waitFor(() => store.getRun(runId)?.status === "succeeded");
      }
      expect(runner.requests.map((request) => request.command)).toEqual(["claude", "codex"]);
      expect(runner.requests[0]?.args).toEqual(expect.arrayContaining(["--print", "--output-format", "stream-json", "--verbose"]));
      expect(runner.requests[1]?.args.slice(0, 3)).toEqual(["exec", "--json", "--skip-git-repo-check"]);
    } finally {
      await api.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("executes the built-in Echo Adapter through the HTTP API", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-api-echo-"));
    const store = new SqliteRunStore(join(directory, "agentdock.db"));
    const config = configFor("echo", "echo", ["execute", "stream_events", "cancel"]);
    const api = createAgentDockApiServer({ config, configPath: join(directory, "config.json"), store, apiToken: token });
    try {
      const address = await api.listen();
      const baseUrl = `http://${address.host}:${address.port}/api/v1`;
      const response = await fetch(`${baseUrl}/runs`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ task: "echo integration", projectId: "workspace" }),
      });
      expect(response.status).toBe(202);
      const runId = runIdFromBody(await response.json());
      await waitFor(() => isTerminal(store.getRun(runId)?.status));
      expect(store.getRun(runId)).toMatchObject({ status: "succeeded" });
      expect(store.listEvents(runId)).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "message", payload: expect.objectContaining({ text: "echo integration", echoed: true }) }),
      ]));
    } finally {
      await api.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reconciles Environment changes made during a Run before the next HTTP request", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-api-environment-reconcile-"));
    const store = new SqliteRunStore(join(directory, "agentdock.db"));
    const config = configFor("mutating-environment", "mutating-environment", ["execute", "cancel"]);
    const registry = new RuntimeRegistry();
    registry.register("mutating-environment", (runtime) => new MutatingEnvironmentAdapter(runtime));
    const api = createAgentDockApiServer({ config, configPath: join(directory, "config.json"), store, registry, apiToken: token });
    try {
      const address = await api.listen();
      const baseUrl = `http://${address.host}:${address.port}/api/v1`;
      const submit = (): Promise<Response> => fetch(`${baseUrl}/runs`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ task: "runtime mutation", projectId: "workspace" }),
      });
      const first = await submit();
      expect(first.status).toBe(202);
      const firstRunId = runIdFromBody(await first.json());
      await waitFor(() => store.getRun(firstRunId)?.status === "succeeded");
      const manager = new EnvironmentDirectoryManager(config, directory);
      await waitForAsync(async () => !(await manager.inspect("default")).drifted);

      const second = await submit();
      expect(second.status).toBe(202);
      const secondRunId = runIdFromBody(await second.json());
      await waitFor(() => store.getRun(secondRunId)?.status === "succeeded");
    } finally {
      await api.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("runs the documented local API client example against the Echo Adapter", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-api-client-example-"));
    const store = new SqliteRunStore(join(directory, "agentdock.db"));
    const config = configFor("echo", "echo", ["execute", "stream_events", "cancel"]);
    const api = createAgentDockApiServer({ config, configPath: join(directory, "config.json"), store, apiToken: token });
    try {
      const address = await api.listen();
      const clientPath = join(process.cwd(), "examples", "api-client", "client.mjs");
      const result = await execFileAsync(process.execPath, [clientPath, "client example"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          AGENTDOCK_API_BASE_URL: `http://${address.host}:${address.port}/api/v1`,
          AGENTDOCK_API_TOKEN: token,
          AGENTDOCK_PROJECT_ID: "workspace",
          AGENTDOCK_AGENT_ID: "default",
        },
      });
      const lines = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(lines[0]).toMatchObject({ created: true });
      expect(lines).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "message", payload: expect.objectContaining({ text: "client example" }) }),
        expect.objectContaining({ type: "status", payload: expect.objectContaining({ status: "succeeded" }) }),
      ]));
    } finally {
      await api.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not log authentication values embedded in a rejected URL", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-api-log-"));
    const store = new SqliteRunStore(join(directory, "agentdock.db"));
    const logs: string[] = [];
    const config = configFor("echo", "echo", ["execute", "stream_events", "cancel"]);
    const api = createAgentDockApiServer({
      config,
      configPath: join(directory, "config.json"),
      store,
      apiToken: token,
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: (_message, fields) => logs.push(JSON.stringify(fields)),
        error: () => undefined,
      },
    });
    try {
      const address = await api.listen();
      const response = await fetch(`http://${address.host}:${address.port}/api/v1/health?token=${encodeURIComponent(token)}`);
      expect(response.status).toBe(401);
      expect(logs.join("\n")).not.toContain(token);
      expect(logs.join("\n")).not.toContain("?token=");
    } finally {
      await api.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("executes an enabled local Adapter through the HTTP API", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-api-local-"));
    const configPath = join(directory, "config.json");
    const config = configFor("example-echo", "example-echo", ["execute", "stream_events", "cancel"]);
    const adapterSource = join(process.cwd(), "examples", "adapter-echo");
    const localStore = new LocalAdapterStore(localAdapterDirectory(config, configPath));
    localStore.install(adapterSource);
    localStore.enable("example-echo");
    const registry = await createConfiguredRuntimeRegistry(config, configPath);
    const store = new SqliteRunStore(join(directory, "agentdock.db"));
    const api = createAgentDockApiServer({ config, configPath, store, registry, apiToken: token });
    try {
      const address = await api.listen();
      const response = await fetch(`http://${address.host}:${address.port}/api/v1/runs`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ task: "third-party", projectId: "workspace" }),
      });
      expect(response.status).toBe(202);
      const runId = runIdFromBody(await response.json());
      await waitFor(() => store.getRun(runId)?.status === "succeeded");
      expect(store.listEvents(runId)).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "message", payload: { text: "example:third-party" } }),
      ]));
    } finally {
      await api.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reconnects SSE after a client disconnect and never duplicates the cursor", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-api-sse-"));
    const store = new SqliteRunStore(join(directory, "agentdock.db"));
    const config = configFor("echo", "echo", ["execute", "stream_events", "cancel"]);
    const api = createAgentDockApiServer({ config, configPath: join(directory, "config.json"), store, apiToken: token });
    try {
      const address = await api.listen();
      const baseUrl = `http://${address.host}:${address.port}/api/v1`;
      const created = await fetch(`${baseUrl}/runs`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ task: "sse reconnect", projectId: "workspace" }),
      });
      const runId = runIdFromBody(await created.json());
      const stream = await fetch(`${baseUrl}/runs/${runId}/events?stream=sse`, { headers: authHeaders() });
      expect(stream.body).toBeDefined();
      const reader = stream.body!.getReader();
      const firstChunk = await readUntil(reader, "id: 0");
      expect(firstChunk).toContain("id: 0");
      const cursor = Number(/id: (\d+)/.exec(firstChunk)?.[1]);
      await reader.cancel();
      await waitFor(() => store.getRun(runId)?.status === "succeeded");

      const reconnected = await fetch(`${baseUrl}/runs/${runId}/events?stream=sse&after=${cursor}`, { headers: authHeaders() });
      const replay = await reconnected.text();
      expect(replay).not.toContain(`id: ${cursor}\n`);
      expect(replay).toContain("id: 2");
      expect(replay).toContain("id: 3");
    } finally {
      await api.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("coalesces concurrent equivalent Idempotency-Key requests", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-api-idempotency-"));
    const store = new SqliteRunStore(join(directory, "agentdock.db"));
    const config = configFor("echo", "echo", ["execute", "stream_events", "cancel"]);
    const api = createAgentDockApiServer({ config, configPath: join(directory, "config.json"), store, apiToken: token });
    try {
      const address = await api.listen();
      const url = `http://${address.host}:${address.port}/api/v1/runs`;
      const request = (): Promise<Response> => fetch(url, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json", "idempotency-key": "same-concurrent-request" }),
        body: JSON.stringify({ task: "same task", projectId: "workspace" }),
      });
      const responses = await Promise.all([request(), request(), request()]);
      const bodies = await Promise.all(responses.map(async (response) => ({ status: response.status, body: await response.json() as unknown })));
      expect(bodies.map((item) => item.status).sort()).toEqual([200, 200, 202]);
      expect(new Set(bodies.map((item) => runIdFromBody(item.body))).size).toBe(1);
      expect(store.listRuns()).toHaveLength(1);
    } finally {
      await api.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("handles a burst of independent API submissions without losing event order", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-api-burst-"));
    const store = new SqliteRunStore(join(directory, "agentdock.db"));
    const config = configFor("echo", "echo", ["execute", "stream_events", "cancel"]);
    const api = createAgentDockApiServer({ config, configPath: join(directory, "config.json"), store, apiToken: token, maxConcurrentRuns: 32 });
    try {
      const address = await api.listen();
      const url = `http://${address.host}:${address.port}/api/v1/runs`;
      const responses = await Promise.all(Array.from({ length: 24 }, (_, index) => fetch(url, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json", "idempotency-key": `burst-${index}` }),
        body: JSON.stringify({ task: `burst-${index}`, projectId: "workspace" }),
      })));
      expect(responses.every((response) => response.status === 202)).toBe(true);
      const runIds = await Promise.all(responses.map(async (response) => runIdFromBody(await response.json())));
      await waitFor(() => runIds.every((runId) => isTerminal(store.getRun(runId)?.status)), 3_000);
      expect(store.listRuns()).toHaveLength(24);
      for (const runId of runIds) {
        expect(store.getRun(runId)?.status).toBe("succeeded");
        expect(store.listEvents(runId).map((event) => event.sequence)).toEqual([0, 1, 2, 3]);
      }
    } finally {
      await api.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("turns an Adapter crash into a persisted failed Run and terminal SSE event", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-api-crash-"));
    const store = new SqliteRunStore(join(directory, "agentdock.db"));
    const config = configFor("crash", "crash", ["execute", "cancel"]);
    const registry = new RuntimeRegistry();
    registry.register("crash", (runtime) => new CrashAdapter(runtime));
    const api = createAgentDockApiServer({ config, configPath: join(directory, "config.json"), store, registry, apiToken: token });
    try {
      const address = await api.listen();
      const baseUrl = `http://${address.host}:${address.port}/api/v1`;
      const created = await fetch(`${baseUrl}/runs`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ task: "crash", projectId: "workspace" }),
      });
      const runId = runIdFromBody(await created.json());
      await waitFor(() => store.getRun(runId)?.status === "failed");
      expect(store.getRun(runId)).toMatchObject({ status: "failed", errorCode: "ADAPTER_EXECUTION_ERROR" });
      const events = await fetch(`${baseUrl}/runs/${runId}/events`, { headers: authHeaders() });
      expect(await events.json()).toMatchObject({ events: expect.arrayContaining([
        expect.objectContaining({ type: "error", payload: expect.objectContaining({ errorCode: "ADAPTER_EXECUTION_ERROR" }) }),
      ]) });
    } finally {
      await api.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("runs an enabled example Adapter through the CLI and emits JSONL events", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-cli-integration-"));
    const config = configFor("example-echo", "example-echo", ["execute", "stream_events", "cancel"]);
    const configPath = createConfigFile(directory, config);
    const source = join(process.cwd(), "examples", "adapter-echo");
    const cliPath = join(process.cwd(), "src", "cli.ts");
    const tsxPath = require.resolve("tsx/cli");
    try {
      await execFileAsync(process.execPath, [tsxPath, cliPath, "adapter", "install", source, "--config", configPath], { cwd: process.cwd() });
      await execFileAsync(process.execPath, [tsxPath, cliPath, "adapter", "enable", "example-echo", "--config", configPath], { cwd: process.cwd() });
      const dryRun = await execFileAsync(process.execPath, [tsxPath, cliPath, "agent", "run", "default", "--dry-run", "--project", "workspace", "--config", configPath, "inspect without running"], { cwd: process.cwd(), maxBuffer: 256 * 1024 });
      expect(JSON.parse(dryRun.stdout) as Record<string, unknown>).toMatchObject({
        task: "inspect without running",
        agent: { id: "default", environmentId: "default" },
        environment: { configHash: null, lastScannedAt: null },
        permission: { id: "readonly" },
        project: { id: "workspace" },
        routing: { mode: "explicit_agent", agentId: "default", environmentId: "default", candidates: [{ agentId: "default", accepted: true, reasons: [] }] },
        executes: false,
      });
      let result;
      try {
        result = await execFileAsync(process.execPath, [tsxPath, cliPath, "agent", "run", "default", "--project", "workspace", "--config", configPath, "cli integration"], { cwd: process.cwd(), maxBuffer: 256 * 1024 });
      } catch (error) {
        const details = error as { stderr?: string; stdout?: string };
        throw new Error(`CLI failed. stdout=${details.stdout ?? ""} stderr=${details.stderr ?? ""}`);
      }
      const records = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line) as { type: string; event?: { payload: Record<string, unknown> }; status?: string });
      expect(records[0]).toMatchObject({ type: "accepted", agent: { id: "default" }, project: { id: "workspace" }, session: { id: expect.any(String) }, recovery: { command: "run events" } });
      expect(records.at(-1)).toMatchObject({ type: "result", status: "succeeded" });
      expect(records.filter((record) => record.type === "event")).toEqual(expect.arrayContaining([expect.objectContaining({ event: expect.objectContaining({ payload: expect.objectContaining({ text: "example:cli integration" }) }) })]));

      const human = await execFileAsync(process.execPath, [tsxPath, cliPath, "agent", "run", "default", "--format", "human", "--project", "workspace", "--config", configPath, "human integration"], { cwd: process.cwd(), maxBuffer: 256 * 1024 });
      expect(human.stdout).toContain("accepted for Agent default");
      expect(human.stdout).toContain("example:human integration");
      expect(human.stdout).toMatch(/Run .+ succeeded\./u);

      const environment = await new EnvironmentDirectoryManager(config, directory).inspect("default");
      writeFileSync(join(environment.environment.configDir, "external-change.json"), "changed outside AgentDock\n");
      await expect(execFileAsync(process.execPath, [tsxPath, cliPath, "agent", "run", "default", "--project", "workspace", "--config", configPath, "must require rescan"], {
        cwd: process.cwd(),
        maxBuffer: 256 * 1024,
      })).rejects.toMatchObject({
        code: 2,
        stdout: expect.stringContaining('"code":"ENVIRONMENT_RESCAN_REQUIRED"'),
      });
      expect((await new EnvironmentDirectoryManager(config, directory).inspect("default")).readiness).toBe("drifted");
      const rescanned = await execFileAsync(process.execPath, [tsxPath, cliPath, "environment", "rescan", "default", "--config", configPath], { cwd: process.cwd(), maxBuffer: 256 * 1024 });
      expect(JSON.parse(rescanned.stdout) as Record<string, unknown>).toMatchObject({ environmentId: "default", configHash: expect.any(String) });
      const afterRescan = await execFileAsync(process.execPath, [tsxPath, cliPath, "agent", "run", "default", "--project", "workspace", "--config", configPath, "runs after explicit rescan"], { cwd: process.cwd(), maxBuffer: 256 * 1024 });
      expect(JSON.parse(afterRescan.stdout.trim().split(/\r?\n/u).at(-1) as string)).toMatchObject({ type: "result", status: "succeeded" });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("cancels several active Runs concurrently and persists cancellation for each", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-api-cancel-"));
    const store = new SqliteRunStore(join(directory, "agentdock.db"));
    const config = configFor("cancellable", "cancellable", ["execute", "cancel"]);
    const registry = new RuntimeRegistry();
    registry.register("cancellable", (runtime) => new CancellableAdapter(runtime));
    const api = createAgentDockApiServer({ config, configPath: join(directory, "config.json"), store, registry, apiToken: token, maxConcurrentRuns: 8 });
    try {
      const address = await api.listen();
      const baseUrl = `http://${address.host}:${address.port}/api/v1`;
      const created = await Promise.all(Array.from({ length: 6 }, (_, index) => fetch(`${baseUrl}/runs`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ task: `cancel-${index}`, projectId: "workspace" }),
      })));
      const runIds = await Promise.all(created.map(async (response) => runIdFromBody(await response.json())));
      await waitFor(() => runIds.every((runId) => store.getRun(runId)?.status === "running"));
      const cancellations = await Promise.all(runIds.map((runId) => fetch(`${baseUrl}/runs/${runId}/cancel`, { method: "POST", headers: authHeaders() })));
      expect(cancellations.every((response) => response.status === 202)).toBe(true);
      await waitFor(() => runIds.every((runId) => store.getRun(runId)?.status === "cancelled"));
      for (const runId of runIds) {
        expect(store.listEvents(runId).at(-1)).toMatchObject({ type: "status", payload: { status: "cancelled" } });
      }
    } finally {
      await api.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
