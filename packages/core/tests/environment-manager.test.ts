import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateConfig } from "../src/config/load.js";
import { ConfigEditor } from "../src/config/editor.js";
import { EnvironmentDirectoryManager, environmentAuditLogPath, environmentManifestPath, environmentTemplateRoot, resolveEnvironmentDirectories } from "../src/environment/manager.js";

function fixture() {
  const baseDirectory = mkdtempSync(join(tmpdir(), "agentdock-environment-manager-"));
  const config = validateConfig({
    version: 1,
    engines: [{ id: "echo", adapter: "echo", capabilities: ["execute"] }],
    environmentPermissions: [{ id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: [] }, network: "deny" }],
    environments: [
      { id: "managed", engineId: "echo", permissionId: "readonly", directoryMode: "managed" },
      { id: "managed-copy", engineId: "echo", permissionId: "readonly", directoryMode: "managed" },
      { id: "managed-template-a", engineId: "echo", permissionId: "readonly", directoryMode: "managed" },
      { id: "managed-template-b", engineId: "echo", permissionId: "readonly", directoryMode: "managed" },
      { id: "managed-template-tampered", engineId: "echo", permissionId: "readonly", directoryMode: "managed" },
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
      expect(drifted.readiness).toBe("drifted");
      await expect(f.manager.prepareForRun("managed")).rejects.toMatchObject({
        code: "ENVIRONMENT_RESCAN_REQUIRED",
        details: expect.objectContaining({ manifestConfigHash: manifest.configHash, currentConfigHash: expect.any(String) }),
      });
      const rescanned = await f.manager.rescan("managed");
      expect(rescanned.configHash).toBe(drifted.currentHash);
      expect((await f.manager.inspect("managed")).readiness).toBe("ready");
      await expect(f.manager.prepareForRun("managed")).resolves.toMatchObject({ configHash: rescanned.configHash });
      const lock = f.manager.acquireRunLock("managed", "run-one", rescanned.configHash);
      const concurrentLock = f.manager.acquireRunLock("managed", "run-two", rescanned.configHash);
      await expect(f.manager.reconcileAfterRun("managed", rescanned.configHash, lock.runId)).resolves.toBe(false);
      concurrentLock.release();
      lock.release();
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
      writeFileSync(join(source, "credentials.json"), "import-token-must-not-copy\n");
      mkdirSync(join(source, "sessions"), { recursive: true });
      writeFileSync(join(source, "sessions", "native.json"), "history-must-not-copy\n");
      const externalConfig = validateConfig({
        ...f.config,
        environments: [{ id: "external", engineId: "echo", permissionId: "readonly", directoryMode: "external", configDir: source }],
      });
      const external = new EnvironmentDirectoryManager(externalConfig, f.baseDirectory);
      expect((await external.rescan("external")).configDir).toBe(source);
      await expect(external.importConfig(source, "external")).rejects.toThrow(/requires managed directories/);

      const missingConfig = validateConfig({
        ...f.config,
        environments: [{ id: "external", engineId: "echo", permissionId: "readonly", directoryMode: "external", configDir: join(f.baseDirectory, "missing") }],
      });
      await expect(new EnvironmentDirectoryManager(missingConfig, f.baseDirectory).rescan("external")).rejects.toThrow(/not an accessible directory/);

      await f.manager.importConfig(source, "managed");
      const target = resolveEnvironmentDirectories(f.config, f.baseDirectory, f.config.environments[0]!);
      expect(readFileSync(join(target.configDir, "settings.json"), "utf8")).toBe("imported\n");
      expect(existsSync(join(target.configDir, "credentials.json"))).toBe(false);
      expect(existsSync(join(target.configDir, "sessions", "native.json"))).toBe(false);
    } finally {
      rmSync(f.baseDirectory, { recursive: true, force: true });
    }
  });

  it("uses one config-only policy for copy, import, backup, and restore without exposing sensitive paths", async () => {
    const f = fixture();
    try {
      const source = await f.manager.rescan("managed");
      writeFileSync(join(source.configDir, "agent.json"), "source\n");
      mkdirSync(join(source.configDir, "skills"), { recursive: true });
      mkdirSync(join(source.configDir, "plugins", "custom"), { recursive: true });
      mkdirSync(join(source.configDir, "commands"), { recursive: true });
      writeFileSync(join(source.configDir, "skills", "review.md"), "skill\n");
      writeFileSync(join(source.configDir, "plugins", "custom", "plugin.json"), "plugin\n");
      writeFileSync(join(source.configDir, "commands", "review.md"), "command\n");
      writeFileSync(join(source.configDir, "auth.json"), "token=must-not-copy\n");
      writeFileSync(join(source.configDir, ".env.local"), "TOKEN=must-not-copy\n");
      writeFileSync(join(source.configDir, "super-secret-token.json"), "must-not-copy\n");
      writeFileSync(join(source.configDir, "profile.sqlite-wal"), "database-must-not-copy\n");
      mkdirSync(join(source.configDir, "sessions"), { recursive: true });
      mkdirSync(join(source.configDir, "state"), { recursive: true });
      mkdirSync(join(source.configDir, "cache"), { recursive: true });
      mkdirSync(join(source.configDir, "logs"), { recursive: true });
      writeFileSync(join(source.configDir, "sessions", "native.json"), "session-must-not-copy\n");
      writeFileSync(join(source.configDir, "state", "runtime.json"), "state-must-not-copy\n");
      writeFileSync(join(source.configDir, "cache", "index"), "cache-must-not-copy\n");
      writeFileSync(join(source.configDir, "logs", "runtime.log"), "log-must-not-copy\n");
      writeFileSync(join(source.stateDir, "session.json"), "state\n");
      writeFileSync(join(source.cacheDir, "index"), "cache\n");
      await f.manager.rescan("managed");
      await f.manager.copyConfig("managed", "managed-copy");
      const target = resolveEnvironmentDirectories(f.config, f.baseDirectory, f.config.environments[1]!);
      expect(readFileSync(join(target.configDir, "agent.json"), "utf8")).toBe("source\n");
      expect(readFileSync(join(target.configDir, "skills", "review.md"), "utf8")).toBe("skill\n");
      expect(readFileSync(join(target.configDir, "plugins", "custom", "plugin.json"), "utf8")).toBe("plugin\n");
      expect(readFileSync(join(target.configDir, "commands", "review.md"), "utf8")).toBe("command\n");
      for (const relativePath of ["auth.json", ".env.local", "super-secret-token.json", "profile.sqlite-wal", "sessions/native.json", "state/runtime.json", "cache/index", "logs/runtime.log"]) {
        expect(existsSync(join(target.configDir, relativePath))).toBe(false);
      }
      expect(existsSync(join(target.stateDir, "session.json"))).toBe(false);
      expect(existsSync(join(target.cacheDir, "index"))).toBe(false);
      const backup = await f.manager.backup("managed");
      for (const relativePath of ["auth.json", ".env.local", "super-secret-token.json", "profile.sqlite-wal", "sessions/native.json", "state/runtime.json", "cache/index", "logs/runtime.log"]) {
        expect(existsSync(join(backup.path, "config", relativePath))).toBe(false);
      }
      // Treat a manually modified or legacy backup as untrusted input too.
      writeFileSync(join(backup.path, "config", "auth.json"), "backup-token-must-not-restore\n");
      writeFileSync(join(source.configDir, "agent.json"), "changed\n");
      await f.manager.rescan("managed");
      await f.manager.restore("managed", backup.id);
      expect(readFileSync(join(source.configDir, "agent.json"), "utf8")).toBe("source\n");
      expect(existsSync(join(source.configDir, "auth.json"))).toBe(false);
      expect(existsSync(join(source.stateDir, "session.json"))).toBe(true);
      expect(existsSync(join(source.cacheDir, "index"))).toBe(true);
      const audit = readFileSync(environmentAuditLogPath(f.config, f.baseDirectory), "utf8");
      expect(audit).not.toContain("must-not-copy");
      expect(audit).not.toContain("auth.json");
      const entries = audit.trim().split(/\r?\n/).map((line) => JSON.parse(line) as { operation: string; skipped: Record<string, number> });
      expect(entries.find((entry) => entry.operation === "copy")?.skipped).toMatchObject({ secret: expect.any(Number), database: expect.any(Number), session: expect.any(Number), runtime_state: expect.any(Number), cache: expect.any(Number), log: expect.any(Number) });
      expect(entries.some((entry) => entry.operation === "restore" && entry.skipped.secret > 0)).toBe(true);
    } finally {
      rmSync(f.baseDirectory, { recursive: true, force: true });
    }
  });

  it("creates immutable config-only templates and derives multiple empty-state managed Environments", async () => {
    const f = fixture();
    try {
      const source = await f.manager.rescan("managed");
      writeFileSync(join(source.configDir, "agent.json"), "template-source\n");
      mkdirSync(join(source.configDir, "skills"), { recursive: true });
      mkdirSync(join(source.configDir, "plugins", "custom"), { recursive: true });
      writeFileSync(join(source.configDir, "skills", "review.md"), "skill\n");
      writeFileSync(join(source.configDir, "plugins", "custom", "plugin.json"), "plugin\n");
      writeFileSync(join(source.configDir, "auth.json"), "template-token-must-not-copy\n");
      mkdirSync(join(source.configDir, "sessions"), { recursive: true });
      mkdirSync(join(source.configDir, "cache"), { recursive: true });
      writeFileSync(join(source.configDir, "sessions", "native.json"), "session-must-not-copy\n");
      writeFileSync(join(source.configDir, "cache", "index"), "cache-must-not-copy\n");

      await expect(f.manager.createTemplate("review-template", "managed")).rejects.toMatchObject({ code: "ENVIRONMENT_RESCAN_REQUIRED" });
      const confirmed = await f.manager.rescan("managed");
      const template = await f.manager.createTemplate("review-template", "managed");
      expect(template).toMatchObject({
        templateVersion: 1,
        id: "review-template",
        sourceEnvironmentId: "managed",
        engineId: "echo",
        configHash: confirmed.configHash,
        skipped: { secret: expect.any(Number), session: expect.any(Number), cache: expect.any(Number) },
      });
      expect(await f.manager.templates()).toEqual([template]);
      const templateRoot = join(environmentTemplateRoot(f.config, f.baseDirectory), "review-template");
      const metadata = readFileSync(join(templateRoot, "template.json"), "utf8");
      expect(metadata).not.toContain("template-token-must-not-copy");
      expect(metadata).not.toContain(source.configDir);
      for (const relativePath of ["auth.json", "sessions/native.json", "cache/index"]) {
        expect(existsSync(join(templateRoot, "config", relativePath))).toBe(false);
      }

      const first = await f.manager.applyTemplate("review-template", "managed-template-a");
      const second = await f.manager.applyTemplate("review-template", "managed-template-b");
      expect(first.configHash).toBe(template.configHash);
      expect(second.configHash).toBe(template.configHash);
      for (const environmentId of ["managed-template-a", "managed-template-b"]) {
        const environment = f.config.environments.find((item) => item.id === environmentId)!;
        const target = resolveEnvironmentDirectories(f.config, f.baseDirectory, environment);
        expect(readFileSync(join(target.configDir, "agent.json"), "utf8")).toBe("template-source\n");
        expect(readFileSync(join(target.configDir, "skills", "review.md"), "utf8")).toBe("skill\n");
        expect(readFileSync(join(target.configDir, "plugins", "custom", "plugin.json"), "utf8")).toBe("plugin\n");
        expect(existsSync(join(target.configDir, "auth.json"))).toBe(false);
        expect(existsSync(join(target.configDir, "sessions", "native.json"))).toBe(false);
        expect(existsSync(join(target.configDir, "cache", "index"))).toBe(false);
        expect(existsSync(target.stateDir)).toBe(true);
        expect(existsSync(target.cacheDir)).toBe(true);
      }

      // A template is immutable after creation. Treat even a manually injected
      // excluded file as corrupt rather than silently filtering and applying it.
      writeFileSync(join(templateRoot, "config", "auth.json"), "tampered-secret\n");
      await expect(f.manager.applyTemplate("review-template", "managed-template-tampered")).rejects.toMatchObject({
        code: "ENVIRONMENT_TEMPLATE_INTEGRITY_FAILED",
        details: { categories: ["secret"] },
      });
      const audit = readFileSync(environmentAuditLogPath(f.config, f.baseDirectory), "utf8");
      expect(audit).not.toContain("template-token-must-not-copy");
      expect(audit).not.toContain("tampered-secret");
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
