import { describe, expect, it } from "vitest";
import { formatDryRun, resolveExecutionContext } from "../src/policy/resolver.js";
import { validateConfig } from "../src/config/load.js";

describe("execution context", () => {
  it("resolves project defaults and only exposes allowed environment keys", () => {
    const config = validateConfig({
      version: 1,
      engines: [{ id: "codex", adapter: "codex", capabilities: ["execute"] }],
      environmentPermissions: [{ id: "readonly", filesystem: { roots: ["."] }, environment: { allow: ["PATH", "SECRET_NOT_ALLOWED"] } }],
      environments: [{ id: "review", engineId: "codex", permissionId: "readonly" }],
      projects: [{ id: "app", rootDir: ".", environmentIds: ["review"], defaultEnvironmentId: "review" }],
    });
    const context = resolveExecutionContext({
      config,
      baseDirectory: "C:/workspace",
      environment: { PATH: "safe", SECRET_NOT_ALLOWED: "not-secret" },
    });
    expect(context.workingDirectory).toBe("C:\\workspace");
    expect(context.environment).toMatchObject({
      PATH: "safe",
      SECRET_NOT_ALLOWED: "not-secret",
      AGENTDOCK_CONFIG_DIR: "C:\\workspace\\.agentdock\\environments\\review\\config",
      AGENTDOCK_STATE_DIR: "C:\\workspace\\.agentdock\\environments\\review\\state",
      AGENTDOCK_CACHE_DIR: "C:\\workspace\\.agentdock\\environments\\review\\cache",
      CODEX_HOME: "C:\\workspace\\.agentdock\\environments\\review\\config",
    });
    expect(formatDryRun(context, "inspect")).toMatchObject({ executes: false, task: "inspect" });
  });

  it("resolves Windows-configured paths consistently when running on Linux", () => {
    const config = validateConfig({
      version: 1,
      engines: [{ id: "codex", adapter: "codex", capabilities: ["execute"] }],
      environmentPermissions: [{ id: "readonly", filesystem: { roots: ["C:/workspace"] }, environment: {} }],
      environments: [{ id: "review", engineId: "codex", permissionId: "readonly" }],
      projects: [{ id: "app", rootDir: ".", environmentIds: ["review"], defaultEnvironmentId: "review" }],
    });

    const context = resolveExecutionContext({
      config,
      baseDirectory: "C:/workspace",
      environmentId: "review",
    });

    expect(context.workingDirectory).toBe("C:\\workspace");
    expect(context.project?.rootDir).toBe("C:\\workspace");
  });

  it("merges inherited profile settings", () => {
    const config = validateConfig({
      version: 1,
      engines: [{ id: "codex", adapter: "codex" }],
      environmentPermissions: [{ id: "readonly", filesystem: { roots: ["."] }, environment: {} }],
      environments: [
        { id: "base", engineId: "codex", permissionId: "readonly", settings: { sandbox: "read-only", model: "a" } },
        { id: "child", engineId: "codex", permissionId: "readonly", extends: "base", settings: { model: "b" } },
      ],
      projects: [{ id: "app", rootDir: ".", environmentIds: ["child"], defaultEnvironmentId: "child" }],
    });
    const context = resolveExecutionContext({ config, baseDirectory: process.cwd() });
    expect(context.agentEnvironment.settings).toEqual({ sandbox: "read-only", model: "b" });
  });

  it("applies Agent process environment overrides after permission inheritance", () => {
    const config = validateConfig({
      version: 1,
      engines: [{ id: "echo", adapter: "echo" }],
      environmentPermissions: [{ id: "readonly", filesystem: { roots: ["."] }, environment: { allow: ["PATH"] } }],
      environments: [{ id: "home", directoryMode: "managed" }],
      agents: [{ id: "reviewer", engineId: "echo", environmentId: "home", permissionId: "readonly", processEnv: { PATH: "agent-path", LANG: "en_US.UTF-8" } }],
      projects: [{ id: "app", rootDir: ".", agentIds: ["reviewer"], defaultAgentId: "reviewer" }],
    });
    const context = resolveExecutionContext({ config, baseDirectory: "C:/workspace", projectId: "app", environment: { PATH: "parent-path" } });
    expect(context.environment).toMatchObject({ PATH: "agent-path", LANG: "en_US.UTF-8" });
    expect(context.agent?.id).toBe("reviewer");
  });
});
