import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateConfig } from "../src/config/load.js";
import { ConfigEditor } from "../src/config/editor.js";
import { EnvironmentDirectoryManager, environmentManifestPath, resolveEnvironmentDirectories } from "../src/environment/manager.js";

function fixture() {
  const baseDirectory = mkdtempSync(join(tmpdir(), "agentdock-environment-manager-"));
  const config = validateConfig({
    version: 1,
    engines: [{ id: "echo", adapter: "echo", capabilities: ["execute"] }],
    environmentPermissions: [{ id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: [] }, network: "deny" }],
    environments: [
      { id: "managed", engineId: "echo", permissionId: "readonly", directoryMode: "managed" },
      { id: "managed-copy", engineId: "echo", permissionId: "readonly", directoryMode: "managed" },
    ],
    projects: [],
  });
  return { baseDirectory, config, manager: new EnvironmentDirectoryManager(config, baseDirectory) };
}

describe("EnvironmentDirectoryManager", () => {
  it("resolves managed directories for a Windows-configured base path", () => {
    const config = validateConfig({
      version: 1,
      engines: [{ id: "codex", adapter: "codex", capabilities: ["execute"] }],
      environmentPermissions: [{ id: "readonly", filesystem: { roots: ["."] }, environment: { allow: [] } }],
      environments: [{ id: "review", engineId: "codex", permissionId: "readonly" }],
      projects: [],
    });

    const directories = resolveEnvironmentDirectories(config, "C:/workspace", config.environments[0]!);
    expect(directories).toEqual({
      configDir: "C:\\workspace\\.agentdock\\environments\\review\\config",
      stateDir: "C:\\workspace\\.agentdock\\environments\\review\\state",
      cacheDir: "C:\\workspace\\.agentdock\\environments\\review\\cache",
    });
    expect(environmentManifestPath(config, "C:/workspace", "review")).toBe("C:\\workspace\\.agentdock\\environments\\review\\manifest.json");
  });

  it("keeps native paths on the host path style", () => {
    const config = validateConfig({
      version: 1,
      engines: [{ id: "codex", adapter: "codex", capabilities: ["execute"] }],
      environmentPermissions: [{ id: "readonly", filesystem: { roots: ["."] }, environment: { allow: [] } }],
      environments: [{ id: "review", engineId: "codex", permissionId: "readonly" }],
      projects: [],
    });
    const baseDirectory = join(tmpdir(), "agentdock-native-path");

    expect(resolveEnvironmentDirectories(config, baseDirectory, config.environments[0]!)).toEqual({
      configDir: join(baseDirectory, ".agentdock", "environments", "review", "config"),
      stateDir: join(baseDirectory, ".agentdock", "environments", "review", "state"),
      cacheDir: join(baseDirectory, ".agentdock", "environments", "review", "cache"),
    });
  });

  it("creates managed directories and tracks config hash drift", async () => {
    const f = fixture();
    try {
      const manifest = await f.manager.rescan("managed");
      expect(existsSync(manifest.configDir)).toBe(true);
      expect(existsSync(manifest.stateDir)).toBe(true);
      expect(existsSync(manifest.cacheDir)).toBe(true);
      const clean = await f.manager.inspect("managed");
      expect(clean.healthy).toBe(true);
      expect(clean.drifted).toBe(false);
      writeFileSync(join(manifest.configDir, "models_cache.json"), "runtime-cache\n");
      expect((await f.manager.inspect("managed")).drifted).toBe(false);
      writeFileSync(join(manifest.configDir, "settings.json"), "{}\n");
      const drifted = await f.manager.inspect("managed");
      expect(drifted.drifted).toBe(true);
      const rescanned = await f.manager.rescan("managed");
      expect(rescanned.configHash).toBe(drifted.currentHash);
      expect((await f.manager.inspect("managed")).drifted).toBe(false);
      await Promise.all(Array.from({ length: 8 }, () => f.manager.rescan("managed")));
      expect(JSON.parse(readFileSync(environmentManifestPath(f.config, f.baseDirectory, "managed"), "utf8"))).toMatchObject({
        manifestVersion: 1,
        environmentId: "managed",
      });
    } finally {
      rmSync(f.baseDirectory, { recursive: true, force: true });
    }
  });

  it("requires an accessible external configDir and imports existing config", async () => {
    const f = fixture();
    try {
      const source = join(f.baseDirectory, "existing-agent-config");
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "settings.json"), "imported\n");
      const externalConfig = validateConfig({
        ...f.config,
        environments: [{ id: "external", engineId: "echo", permissionId: "readonly", directoryMode: "external", configDir: source }],
      });
      const external = new EnvironmentDirectoryManager(externalConfig, f.baseDirectory);
      expect((await external.rescan("external")).configDir).toBe(source);

      const missingConfig = validateConfig({
        ...f.config,
        environments: [{ id: "external", engineId: "echo", permissionId: "readonly", directoryMode: "external", configDir: join(f.baseDirectory, "missing") }],
      });
      await expect(new EnvironmentDirectoryManager(missingConfig, f.baseDirectory).rescan("external")).rejects.toThrow(/not an accessible directory/);

      await f.manager.importConfig(source, "managed");
      const target = resolveEnvironmentDirectories(f.config, f.baseDirectory, f.config.environments[0]!);
      expect(readFileSync(join(target.configDir, "settings.json"), "utf8")).toBe("imported\n");
    } finally {
      rmSync(f.baseDirectory, { recursive: true, force: true });
    }
  });

  it("copies and backs up only config data, preserving state and cache", async () => {
    const f = fixture();
    try {
      const source = await f.manager.rescan("managed");
      writeFileSync(join(source.configDir, "agent.json"), "source\n");
      writeFileSync(join(source.configDir, "auth.json"), "token=must-not-copy\n");
      writeFileSync(join(source.stateDir, "session.json"), "state\n");
      writeFileSync(join(source.cacheDir, "index"), "cache\n");
      await f.manager.rescan("managed");
      await f.manager.copyConfig("managed", "managed-copy");
      const target = resolveEnvironmentDirectories(f.config, f.baseDirectory, f.config.environments[1]!);
      expect(readFileSync(join(target.configDir, "agent.json"), "utf8")).toBe("source\n");
      expect(existsSync(join(target.configDir, "auth.json"))).toBe(false);
      expect(existsSync(join(target.stateDir, "session.json"))).toBe(false);
      expect(existsSync(join(target.cacheDir, "index"))).toBe(false);
      const backup = await f.manager.backup("managed");
      expect(existsSync(join(backup.path, "config", "auth.json"))).toBe(false);
      writeFileSync(join(source.configDir, "agent.json"), "changed\n");
      await f.manager.rescan("managed");
      await f.manager.restore("managed", backup.id);
      expect(readFileSync(join(source.configDir, "agent.json"), "utf8")).toBe("source\n");
      expect(existsSync(join(source.stateDir, "session.json"))).toBe(true);
      expect(existsSync(join(source.cacheDir, "index"))).toBe(true);
    } finally {
      rmSync(f.baseDirectory, { recursive: true, force: true });
    }
  });

  it("never removes environment directories when configuration entities are deleted", async () => {
    const f = fixture();
    try {
      const manifest = await f.manager.rescan("managed");
      writeFileSync(join(manifest.configDir, "keep.txt"), "keep\n");
      const configPath = join(f.baseDirectory, "config.json");
      writeFileSync(configPath, JSON.stringify(f.config));
      const editor = new ConfigEditor(configPath, f.config);
      const snapshot = await editor.snapshot();
      const candidate = structuredClone(snapshot.config);
      candidate.environments = candidate.environments.filter((environment) => environment.id !== "managed");
      await editor.save(candidate, snapshot.revision, snapshot.hash, false);
      expect(existsSync(manifest.configDir)).toBe(true);
      expect(readFileSync(join(manifest.configDir, "keep.txt"), "utf8")).toBe("keep\n");
    } finally {
      rmSync(f.baseDirectory, { recursive: true, force: true });
    }
  });
});
