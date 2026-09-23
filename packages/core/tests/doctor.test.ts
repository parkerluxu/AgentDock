import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterHealth, AdapterManifest, AdapterTaskRequest, AgentAdapter } from "../src/adapter-contract/index.js";
import { validateConfig } from "../src/config/load.js";
import type { RunEvent, RuntimeDescriptor } from "../src/core/types.js";
import { EnvironmentDirectoryManager } from "../src/environment/manager.js";
import { doctor } from "../src/runtime/doctor.js";
import { RuntimeRegistry } from "../src/runtime/registry.js";

class ContractAdapter implements AgentAdapter {
  public readonly manifest: AdapterManifest = {
    name: "contract-adapter",
    version: "0.1.0",
    entry: "./contract-adapter.js",
    agentDockApi: "v1",
    runtime: { id: "contract-runtime", versionRange: ">=1.0.0" },
    capabilities: ["execute", "healthcheck"],
    requiredPermissions: ["filesystem.read"],
    nativeHome: {
      contractVersion: 1,
      homeEnvironmentVariables: ["CONTRACT_HOME"],
      configEnvironmentVariables: ["CONTRACT_HOME"],
      stateEnvironmentVariables: [],
      cacheEnvironmentVariables: [],
      mutableDirectories: ["config", "cache", "session"],
      session: { resumeArgument: "resume <id>" },
      verification: "declared",
    },
  };

  public constructor(private readonly runtime: RuntimeDescriptor) {}
  public async healthCheck(): Promise<AdapterHealth> { return { healthy: true, runtime: this.runtime }; }
  public async *execute(_request: AdapterTaskRequest): AsyncIterable<RunEvent> { /* Test adapter does not execute native work. */ }
  public async cancel(): Promise<void> {}
}

describe("doctor", () => {
  it("reports an unregistered Adapter without running a process", async () => {
    const config = validateConfig({
      version: 1,
      dataDir: ".agentdock-test-data",
      engines: [{ id: "unknown", adapter: "not-installed" }],
      environments: [],
      projects: [],
    });
    const report = await doctor({ config, configPath: process.cwd(), registry: new RuntimeRegistry(), checkStorage: false });
    expect(report.healthy).toBe(false);
    expect(report.diagnostics).toEqual(expect.arrayContaining([
      { scope: "runtime", id: "unknown", healthy: false, message: 'Adapter "not-installed" is not registered.' },
    ]));
  });

  it("reports Environment readiness, native-home contract, and non-sandbox Permission details without secret values", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-environment-doctor-"));
    const configPath = join(directory, "config.json");
    const config = validateConfig({
      version: 1,
      dataDir: "data",
      engines: [{ id: "contract-runtime", adapter: "contract", version: "1.2.3", capabilities: ["execute"] }],
      environmentPermissions: [{ id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: ["LANG"], secretRefs: { API_KEY: { provider: "env", key: "AGENTDOCK_DOCTOR_TEST_SECRET" } } }, network: "deny" }],
      environments: [{ id: "review", engineId: "contract-runtime", permissionId: "readonly", directoryMode: "managed" }],
      projects: [],
    });
    const registry = new RuntimeRegistry();
    registry.register("contract", (runtime) => new ContractAdapter(runtime));
    const secretResolver = {
      resolve: () => ({}),
      diagnose: () => [{ name: "API_KEY", provider: "env" as const, healthy: true }],
    };
    try {
      const manifest = await new EnvironmentDirectoryManager(config, directory).rescan("review");
      const report = await doctor({ config, configPath, registry, secretResolver, checkStorage: false, environmentId: "review" });
      expect(report).toMatchObject({ healthy: true, isSecuritySandbox: false });
      expect(report.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ scope: "environment", id: "review/directories", healthy: true, details: expect.objectContaining({ writable: { configDir: true, stateDir: true, cacheDir: true }, symbolicLinkEntries: 0 }) }),
        expect.objectContaining({ scope: "environment", id: "review/manifest", healthy: true, details: expect.objectContaining({ readiness: "ready", manifestConfigHash: manifest.configHash }) }),
        expect.objectContaining({ scope: "adapter", id: "review/review", healthy: true, severity: "warning", details: expect.objectContaining({ observedVersion: "1.2.3", nativeHome: expect.objectContaining({ homeEnvironmentVariables: ["CONTRACT_HOME"], verification: "declared" }) }) }),
        expect.objectContaining({ scope: "permission", id: "review/review", healthy: true, details: expect.objectContaining({ isSecuritySandbox: false, allowedEnvironmentKeys: ["LANG"], secretReferenceNames: ["API_KEY"] }) }),
      ]));
      expect(JSON.stringify(report)).not.toContain("AGENTDOCK_DOCTOR_TEST_SECRET");

      writeFileSync(join(manifest.configDir, "settings.json"), "changed outside AgentDock\n");
      const drifted = await doctor({ config, configPath, registry, secretResolver, checkStorage: false, environmentId: "review" });
      expect(drifted.healthy).toBe(false);
      expect(drifted.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ scope: "environment", id: "review/manifest", healthy: false, details: expect.objectContaining({ readiness: "drifted" }), recommendedAction: expect.stringContaining("rescan") }),
      ]));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
