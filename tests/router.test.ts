import { describe, expect, it } from "vitest";
import { validateConfig } from "../src/config/load.js";
import { resolveRoute, RouteResolutionError } from "../src/runtime/router.js";

function createConfig() {
  return validateConfig({
    version: 1,
    runtimes: [
      { id: "fast", adapter: "fake", capabilities: ["execute", "cancel"] },
      { id: "network", adapter: "fake", capabilities: ["execute", "stream_events"] },
      { id: "disabled", adapter: "fake", enabled: false, capabilities: ["execute"] },
    ],
    policies: [
      { id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: [] }, network: "deny" },
      { id: "network", filesystem: { roots: ["."], write: true }, environment: { allow: [] }, network: "allow" },
    ],
    profiles: [
      { id: "fast-readonly", runtimeId: "fast", policyId: "readonly" },
      { id: "network-write", runtimeId: "network", policyId: "network" },
      { id: "disabled-profile", runtimeId: "disabled", policyId: "readonly" },
    ],
    projects: [{ id: "app", rootDir: ".", profileIds: ["fast-readonly", "network-write"], defaultProfileId: "fast-readonly" }],
  });
}

describe("deterministic route resolver", () => {
  it("prefers an explicit Profile and records candidate reasons", () => {
    const decision = resolveRoute(createConfig(), {
      profileId: "network-write",
      requirements: { requiredCapabilities: ["stream_events"], network: "allow", filesystemWrite: true },
      runtimeHealth: { network: "healthy" },
    });
    expect(decision).toMatchObject({ mode: "explicit_profile", profileId: "network-write", runtimeId: "network" });
    expect(decision.candidates).toEqual([{ profileId: "network-write", runtimeId: "network", health: "healthy", accepted: true, reasons: [] }]);
  });

  it("uses a Project default before considering other candidates", () => {
    const decision = resolveRoute(createConfig(), { projectId: "app" });
    expect(decision).toMatchObject({ mode: "project_default", profileId: "fast-readonly", runtimeId: "fast" });
  });

  it("rejects a default Profile when its Policy conflicts with requirements", () => {
    expect(() => resolveRoute(createConfig(), { projectId: "app", requirements: { network: "allow" } })).toThrow(RouteResolutionError);
    try {
      resolveRoute(createConfig(), { projectId: "app", requirements: { network: "allow" } });
    } catch (error) {
      expect(error).toMatchObject({ code: "NO_ROUTE_CANDIDATE" });
      expect((error as RouteResolutionError).candidates.find((candidate) => candidate.profileId === "fast-readonly")?.reasons).toContain("Policy \"readonly\" does not match requested network policy \"allow\"");
    }
  });

  it("selects a unique candidate and rejects ambiguous routing", () => {
    expect(resolveRoute(createConfig(), { requirements: { network: "allow" } })).toMatchObject({ mode: "unique_candidate", profileId: "network-write" });
    expect(() => resolveRoute(createConfig(), {})).toThrow(/Multiple Profiles/);
  });

  it("rejects unhealthy, disabled and capability-incompatible candidates with explanations", () => {
    expect(() => resolveRoute(createConfig(), { profileId: "fast-readonly", runtimeHealth: { fast: "unhealthy" } })).toThrow(/unhealthy/);
    expect(() => resolveRoute(createConfig(), { profileId: "disabled-profile" })).toThrow(/disabled/);
    expect(() => resolveRoute(createConfig(), { profileId: "fast-readonly", requirements: { requiredCapabilities: ["stream_events"] } })).toThrow(/stream_events/);
  });
});
