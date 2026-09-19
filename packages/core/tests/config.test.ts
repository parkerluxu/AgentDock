import { describe, expect, it } from "vitest";
import { ConfigValidationError, validateConfig } from "../src/config/load.js";

describe("configuration", () => {
  it("rejects the discarded Runtime/Profile/Policy configuration model", () => {
    expect(() => validateConfig({
      version: 1,
      runtimes: [],
      profiles: [],
      policies: [],
    })).toThrow(ConfigValidationError);
  });

  it("applies safe defaults to a valid configuration", () => {
    const config = validateConfig({
      version: 1,
      engines: [{ id: "codex", adapter: "codex", enabled: true }],
      environments: [],
      projects: [],
    });

    expect(config.engines[0]?.args).toEqual([]);
    expect(config.engines[0]?.capabilities).toEqual([]);
    expect(config.environmentPermissions).toEqual([]);
    expect(config.storage).toEqual({ saveOutput: true });
    expect(config.logging).toEqual({ level: "warn" });
    expect(config.redaction).toEqual({ additionalKeys: [] });
  });

  it("reports paths for invalid values", () => {
    expect(() => validateConfig({
      version: 2,
      engines: [{ id: "Codex", adapter: "", enabled: "yes" }],
    })).toThrow(ConfigValidationError);

    try {
      validateConfig({ version: 2, engines: [{ id: "Codex", adapter: "", enabled: "yes" }] });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect((error as ConfigValidationError).issues.map((issue) => issue.path)).toEqual(
        expect.arrayContaining(["version", "engines.0.id", "engines.0.adapter", "engines.0.enabled"]),
      );
    }
  });

  it("validates references between configuration entities", () => {
    expect(() => validateConfig({
      version: 1,
      engines: [{ id: "codex", adapter: "codex" }],
      environmentPermissions: [{
        id: "readonly",
        filesystem: { roots: ["." ] },
        environment: {},
      }],
      environments: [{ id: "review", engineId: "missing", permissionId: "readonly" }],
      projects: [{ id: "app", rootDir: ".", environmentIds: ["review"], defaultEnvironmentId: "other" }],
    })).toThrow(ConfigValidationError);

    try {
      validateConfig({
        version: 1,
        engines: [{ id: "codex", adapter: "codex" }],
        environmentPermissions: [{ id: "readonly", filesystem: { roots: ["."] }, environment: {} }],
        environments: [{ id: "review", engineId: "codex", permissionId: "readonly" }],
        projects: [{ id: "app", rootDir: ".", environmentIds: ["review"], defaultEnvironmentId: "other" }],
      });
    } catch (error) {
      expect(error).toMatchObject({
        name: "ConfigValidationError",
        issues: expect.arrayContaining([
          { path: "projects.0.defaultEnvironmentId", message: "must be included in environmentIds." },
        ]),
      });
    }
  });

  it("rejects indirect profile inheritance cycles", () => {
    expect(() => validateConfig({
      version: 1,
      engines: [{ id: "codex", adapter: "codex" }],
      environmentPermissions: [{ id: "readonly", filesystem: { roots: ["."] }, environment: {} }],
      environments: [
        { id: "a", engineId: "codex", permissionId: "readonly", extends: "b" },
        { id: "b", engineId: "codex", permissionId: "readonly", extends: "a" },
      ],
      projects: [],
    })).toThrow("Configuration is invalid");
  });
});
