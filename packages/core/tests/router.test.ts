import { describe, expect, it } from "vitest";
import { validateConfig } from "../src/config/load.js";
import { explainRoute, resolveRoute, RouteResolutionError } from "../src/runtime/router.js";

function createConfig() {
  return validateConfig({
    version: 1,
    engines: [
      { id: "fast", adapter: "fake", capabilities: ["execute", "cancel"] },
      { id: "network", adapter: "fake", capabilities: ["execute", "stream_events"] },
      { id: "disabled", adapter: "fake", enabled: false, capabilities: ["execute"] },
    ],
    environmentPermissions: [
      { id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: [] }, network: "deny" },
      { id: "network", filesystem: { roots: ["."], write: true }, environment: { allow: [] }, network: "allow" },
    ],
    environments: [
      { id: "fast-readonly", engineId: "fast", permissionId: "readonly" },
      { id: "network-write", engineId: "network", permissionId: "network" },
      { id: "disabled-profile", engineId: "disabled", permissionId: "readonly" },
    ],
    projects: [{ id: "app", rootDir: ".", environmentIds: ["fast-readonly", "network-write"], defaultEnvironmentId: "fast-readonly" }],
  });
}

describe("deterministic route resolver", () => {
  it("prefers an explicit Environment and records candidate reasons", () => {
    const decision = resolveRoute(createConfig(), {
      environmentId: "network-write",
      requirements: { requiredCapabilities: ["stream_events"], network: "allow", filesystemWrite: true },
      engineHealth: { network: "healthy" },
    });
    expect(decision).toMatchObject({ mode: "explicit_environment", environmentId: "network-write", engineId: "network" });
    expect(decision.candidates).toEqual([{ agentId: "network-write", environmentId: "network-write", engineId: "network", health: "healthy", accepted: true, reasons: [] }]);
  });

  it("uses a Project default before considering other candidates", () => {
    const decision = resolveRoute(createConfig(), { projectId: "app" });
    expect(decision).toMatchObject({ mode: "project_default", environmentId: "fast-readonly", engineId: "fast" });
  });

  it("rejects a default Environment when its Permission conflicts with requirements", () => {
    expect(() => resolveRoute(createConfig(), { projectId: "app", requirements: { network: "allow" } })).toThrow(RouteResolutionError);
    try {
      resolveRoute(createConfig(), { projectId: "app", requirements: { network: "allow" } });
    } catch (error) {
      expect(error).toMatchObject({ code: "NO_ROUTE_CANDIDATE" });
      expect((error as RouteResolutionError).candidates.find((candidate) => candidate.environmentId === "fast-readonly")?.reasons).toContain("Network permission does not match");
    }
  });

  it("selects a unique candidate and rejects ambiguous routing", () => {
    expect(resolveRoute(createConfig(), { requirements: { network: "allow" } })).toMatchObject({ mode: "unique_candidate", environmentId: "network-write" });
    expect(() => resolveRoute(createConfig(), {})).toThrow(/Multiple Environments/);
  });

  it("rejects unhealthy, disabled and capability-incompatible candidates with explanations", () => {
    expect(() => resolveRoute(createConfig(), { environmentId: "fast-readonly", engineHealth: { fast: "unhealthy" } })).toThrow(/unhealthy/);
    expect(() => resolveRoute(createConfig(), { environmentId: "disabled-profile" })).toThrow(/disabled/);
    expect(() => resolveRoute(createConfig(), { environmentId: "fast-readonly", requirements: { requiredCapabilities: ["stream_events"] } })).toThrow(/stream_events/);
  });

  it("returns a non-throwing route explanation with Agent identities and rejection reasons", () => {
    const explanation = explainRoute(createConfig(), { projectId: "app", requirements: { network: "allow" } });
    expect(explanation).toMatchObject({
      resolved: false,
      error: { code: "NO_ROUTE_CANDIDATE" },
      candidates: expect.arrayContaining([
        expect.objectContaining({ agentId: "fast-readonly", environmentId: "fast-readonly", accepted: false, reasons: ["Network permission does not match"] }),
      ]),
    });
  });
});
