import { describe, expect, it } from "vitest";
import { AdapterManifestValidationError, isCapabilitySupported, validateAdapterManifest, type AdapterManifest } from "../src/adapter-contract/index.js";

describe("Adapter contract", () => {
  it("uses explicit capability declarations", () => {
    const manifest: AdapterManifest = {
      name: "example",
      version: "0.1.0",
      entry: "./example-adapter.js",
      agentDockApi: "v1",
      runtime: { id: "example" },
      capabilities: ["execute", "healthcheck"],
      requiredPermissions: ["filesystem.read"],
    };

    expect(isCapabilitySupported(manifest, "execute")).toBe(true);
    expect(isCapabilitySupported(manifest, "resume_session")).toBe(false);
  });

  it("validates the optional native-home contract without breaking older manifests", () => {
    expect(() => validateAdapterManifest({
      name: "native-home",
      version: "0.1.0",
      entry: "./native-home.js",
      agentDockApi: "v1",
      runtime: { id: "native-home" },
      capabilities: ["execute"],
      requiredPermissions: [],
      nativeHome: {
        contractVersion: 1,
        homeEnvironmentVariables: ["NATIVE_HOME"],
        configEnvironmentVariables: ["NATIVE_HOME"],
        stateEnvironmentVariables: [],
        cacheEnvironmentVariables: [],
        mutableDirectories: ["config", "session"],
        verification: "declared",
      },
    })).not.toThrow();
    expect(() => validateAdapterManifest({
      name: "invalid-native-home",
      version: "0.1.0",
      entry: "./invalid-native-home.js",
      agentDockApi: "v1",
      runtime: { id: "native-home" },
      capabilities: ["execute"],
      requiredPermissions: [],
      nativeHome: {
        contractVersion: 1,
        homeEnvironmentVariables: ["lowercase"],
        configEnvironmentVariables: [],
        stateEnvironmentVariables: [],
        cacheEnvironmentVariables: [],
        mutableDirectories: ["unknown"],
        verification: "unknown",
      },
    })).toThrow(AdapterManifestValidationError);
  });
});
