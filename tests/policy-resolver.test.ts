import { describe, expect, it } from "vitest";
import { formatDryRun, resolveExecutionContext } from "../src/policy/resolver.js";
import { validateConfig } from "../src/config/load.js";

describe("execution context", () => {
  it("resolves project defaults and only exposes allowed environment keys", () => {
    const config = validateConfig({
      version: 1,
      runtimes: [{ id: "codex", adapter: "codex", capabilities: ["execute"] }],
      policies: [{ id: "readonly", filesystem: { roots: ["."] }, environment: { allow: ["PATH", "SECRET_NOT_ALLOWED"] } }],
      profiles: [{ id: "review", runtimeId: "codex", policyId: "readonly" }],
      projects: [{ id: "app", rootDir: ".", profileIds: ["review"], defaultProfileId: "review" }],
    });
    const context = resolveExecutionContext({
      config,
      baseDirectory: "C:/workspace",
      environment: { PATH: "safe", SECRET_NOT_ALLOWED: "not-secret" },
    });
    expect(context.workingDirectory).toBe("C:\\workspace");
    expect(context.environment).toEqual({ PATH: "safe", SECRET_NOT_ALLOWED: "not-secret" });
    expect(formatDryRun(context, "inspect")).toMatchObject({ executes: false, task: "inspect" });
  });

  it("merges inherited profile settings", () => {
    const config = validateConfig({
      version: 1,
      runtimes: [{ id: "codex", adapter: "codex" }],
      policies: [{ id: "readonly", filesystem: { roots: ["."] }, environment: {} }],
      profiles: [
        { id: "base", runtimeId: "codex", policyId: "readonly", settings: { sandbox: "read-only", model: "a" } },
        { id: "child", runtimeId: "codex", policyId: "readonly", extends: "base", settings: { model: "b" } },
      ],
      projects: [{ id: "app", rootDir: ".", profileIds: ["child"], defaultProfileId: "child" }],
    });
    const context = resolveExecutionContext({ config, baseDirectory: process.cwd() });
    expect(context.profile.settings).toEqual({ sandbox: "read-only", model: "b" });
  });
});
