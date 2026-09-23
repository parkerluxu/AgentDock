import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AdapterHealth, AdapterManifest, AdapterTaskRequest, AgentAdapter } from "../src/adapter-contract/index.js";
import { validateConfig } from "../src/config/load.js";
import type { RunEvent, RuntimeDescriptor } from "../src/core/types.js";
import { EnvironmentDirectoryManager } from "../src/environment/manager.js";
import { AgentHealthReadModel } from "../src/runtime/agent-health.js";
import { RuntimeRegistry } from "../src/runtime/registry.js";
import { SqliteRunStore } from "../src/storage/sqlite-run-store.js";

class CountingAdapter implements AgentAdapter {
  public healthChecks = 0;
  public readonly manifest: AdapterManifest = {
    name: "counting",
    version: "0.1.0",
    entry: "./counting.js",
    agentDockApi: "v1",
    runtime: { id: "counting" },
    capabilities: ["execute", "healthcheck"],
    requiredPermissions: [],
  };

  public constructor(private readonly runtime: RuntimeDescriptor) {}
  public async healthCheck(): Promise<AdapterHealth> { this.healthChecks += 1; return { healthy: true, runtime: this.runtime }; }
  public async *execute(_request: AdapterTaskRequest): AsyncIterable<RunEvent> { /* Dashboard health never executes a Runtime. */ }
  public async cancel(): Promise<void> {}
}

describe("AgentHealthReadModel", () => {
  it("caches a non-invasive Agent/Environment/Project read model and exposes drift without secret values", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-agent-health-"));
    const configPath = join(directory, "config.json");
    const config = validateConfig({
      version: 1,
      dataDir: "data",
      engines: [{ id: "counting", adapter: "counting", binary: "counting", version: "1.2.3", capabilities: ["execute", "healthcheck"] }],
      environmentPermissions: [{ id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: ["LANG"], secretRefs: { API_KEY: { provider: "env", key: "AGENTDOCK_AGENT_HEALTH_SECRET" } } }, network: "deny" }],
      environments: [{ id: "review", engineId: "counting", permissionId: "readonly", directoryMode: "managed", settings: {} }],
      agents: [{ id: "reviewer", engineId: "counting", environmentId: "review", permissionId: "readonly", enabled: true, processEnv: {}, settings: {} }],
      projects: [{ id: "workspace", rootDir: ".", agentIds: ["reviewer"], defaultAgentId: "reviewer" }],
    });
    const store = new SqliteRunStore(join(directory, "runs.db"));
    const registry = new RuntimeRegistry();
    let adapter: CountingAdapter | undefined;
    registry.register("counting", (runtime) => {
      adapter = new CountingAdapter(runtime);
      return adapter;
    });
    try {
      const manager = new EnvironmentDirectoryManager(config, directory);
      const manifest = await manager.rescan("review");
      const model = new AgentHealthReadModel({ cacheTtlMs: 60_000 });
      const first = await model.read({ config, configPath, registry, store });
      const firstAgent = first.agents[0];
      expect(first).toMatchObject({ readOnly: true, isSecuritySandbox: false });
      expect(firstAgent).toMatchObject({
        agentId: "reviewer",
        status: "unknown",
        engine: { id: "counting", configuredVersion: "1.2.3", adapterRegistered: true, runtimeHealth: "unknown", status: "unknown" },
        environment: { id: "review", readiness: "ready", status: "healthy", manifestConfigHash: manifest.configHash },
        permission: { allowedEnvironmentKeys: ["LANG"], secretReferenceNames: ["API_KEY"], isSecuritySandbox: false },
        projects: { status: "healthy", bindings: [{ id: "workspace", isDefault: true, rootExists: true }] },
      });
      expect(adapter).toBeUndefined();
      expect(JSON.stringify(first)).not.toContain("AGENTDOCK_AGENT_HEALTH_SECRET");

      writeFileSync(join(manifest.configDir, "settings.json"), "outside change\n");
      const cached = await model.read({ config, configPath, registry, store });
      expect(cached.checkedAt).toBe(first.checkedAt);
      expect(cached.agents[0]?.environment.readiness).toBe("ready");

      model.invalidate();
      const drifted = await model.read({ config, configPath, registry, store });
      expect(drifted.agents[0]).toMatchObject({ environment: { readiness: "drifted", status: "unhealthy" }, status: "unhealthy" });
      expect(drifted.agents[0]?.recommendedActions).toContain('Repair Environment "review" and run environment rescan.');
      expect(adapter).toBeUndefined();
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
