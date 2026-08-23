import { describe, expect, it } from "vitest";
import { ConfigValidationError, validateConfig } from "../src/config/load.js";

describe("configuration", () => {
  it("applies safe defaults to a valid configuration", () => {
    const config = validateConfig({
      version: 1,
      runtimes: [{ id: "codex", adapter: "codex", enabled: true }],
      profiles: [],
      projects: [],
    });

    expect(config.runtimes[0]?.args).toEqual([]);
    expect(config.runtimes[0]?.capabilities).toEqual([]);
    expect(config.policies).toEqual([]);
  });

  it("reports paths for invalid values", () => {
    expect(() => validateConfig({
      version: 2,
      runtimes: [{ id: "Codex", adapter: "", enabled: "yes" }],
    })).toThrow(ConfigValidationError);

    try {
      validateConfig({ version: 2, runtimes: [{ id: "Codex", adapter: "", enabled: "yes" }] });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect((error as ConfigValidationError).issues.map((issue) => issue.path)).toEqual(
        expect.arrayContaining(["version", "runtimes.0.id", "runtimes.0.adapter", "runtimes.0.enabled"]),
      );
    }
  });

  it("validates references between configuration entities", () => {
    expect(() => validateConfig({
      version: 1,
      runtimes: [{ id: "codex", adapter: "codex" }],
      policies: [{
        id: "readonly",
        filesystem: { roots: ["." ] },
        environment: {},
      }],
      profiles: [{ id: "review", runtimeId: "missing", policyId: "readonly" }],
      projects: [{ id: "app", rootDir: ".", profileIds: ["review"], defaultProfileId: "other" }],
    })).toThrow(ConfigValidationError);

    try {
      validateConfig({
        version: 1,
        runtimes: [{ id: "codex", adapter: "codex" }],
        policies: [{ id: "readonly", filesystem: { roots: ["."] }, environment: {} }],
        profiles: [{ id: "review", runtimeId: "codex", policyId: "readonly" }],
        projects: [{ id: "app", rootDir: ".", profileIds: ["review"], defaultProfileId: "other" }],
      });
    } catch (error) {
      expect(error).toMatchObject({
        name: "ConfigValidationError",
        issues: expect.arrayContaining([
          { path: "projects.0.defaultProfileId", message: "must be included in profileIds." },
        ]),
      });
    }
  });

  it("rejects indirect profile inheritance cycles", () => {
    expect(() => validateConfig({
      version: 1,
      runtimes: [{ id: "codex", adapter: "codex" }],
      policies: [{ id: "readonly", filesystem: { roots: ["."] }, environment: {} }],
      profiles: [
        { id: "a", runtimeId: "codex", policyId: "readonly", extends: "b" },
        { id: "b", runtimeId: "codex", policyId: "readonly", extends: "a" },
      ],
      projects: [],
    })).toThrow("Configuration is invalid");
  });
});
